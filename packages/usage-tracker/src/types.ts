export type UsageService =
    | 'openai'
    | 'anthropic'
    | 'minimax'
    | 'dashscope'
    | 'kimi'
    | 'deepgram'
    | 'cartesia'
    | 'daily'
    | 'twilio'
    | 'brave';

export type UsageOperation =
    | 'chat'
    | 'embeddings'
    | 'vision'
    | 'tts'
    | 'stt'
    | 'call'
    | 'sms'
    | 'search'
    | 'room';

export interface UsageEvent {
    /** Organization ID */
    org_id: string;
    /** User ID */
    user_id: string;
    /** Agent ID (optional) */
    agent_id?: string;
    /** Service provider */
    service: UsageService;
    /** Type of operation */
    operation: UsageOperation;
    /** Model used (e.g., 'gpt-4o', 'claude-sonnet-4-5') */
    model?: string;
    /** Input units (tokens, characters, seconds, depending on service) */
    input_units?: number;
    /** Output units (tokens, characters, seconds, depending on service) */
    output_units?: number;
    /** Estimated cost in USD */
    cost_estimate?: number;
    /** When the usage occurred */
    timestamp?: Date;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

export interface UsageTrackerConfig {
    /** Redis connection URL */
    redisUrl: string;
    /** Redis channel for usage events */
    channel?: string;
    /** Key prefix for Redis */
    keyPrefix?: string;
}

// Cost per unit for different services/models (in USD)
export const COST_RATES: Record<string, {
    input: number;
    output: number;
    /** Cached input rate (if provider supports prompt caching) */
    cached_input?: number;
    /** Cache creation rate (first time a prefix is cached) */
    cache_creation?: number;
}> = {
    // OpenAI (per 1M tokens)
    'openai:gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
    'openai:gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
    'openai:embeddings': { input: 0.10 / 1_000_000, output: 0 },

    // Anthropic (per 1M tokens)
    'anthropic:claude-opus-4-6': { input: 15.00 / 1_000_000, output: 75.00 / 1_000_000 },
    'anthropic:claude-sonnet-4-5': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
    'anthropic:claude-haiku-4-5': { input: 0.25 / 1_000_000, output: 1.25 / 1_000_000 },

    // MiniMax (per 1M tokens)
    'minimax:MiniMax-M2.5-Lightning': { input: 0.14 / 1_000_000, output: 0.28 / 1_000_000 },

    // DashScope / Qwen (per 1M tokens)
    // Standard: $0.40/1M input, $2.00/1M output
    // Cached:   $0.04/1M (10% of standard input)
    // Cache creation: $0.50/1M (125% of standard input)
    'dashscope:qwen3.6-plus': {
        input: 0.40 / 1_000_000,
        output: 1.60 / 1_000_000,
        cached_input: 0.04 / 1_000_000,
        cache_creation: 0.50 / 1_000_000,
    },

    // DashScope / Qwen Embedding (per 1M tokens)
    'dashscope:text-embedding-v4': { input: 0.07 / 1_000_000, output: 0 },

    // DashScope / Qwen Turbo (per 1M tokens — used for prompt condensation)
    'dashscope:qwen-turbo': { input: 0.06 / 1_000_000, output: 0.20 / 1_000_000 },
    'dashscope:qwen-flash': { input: 0.01 / 1_000_000, output: 0.03 / 1_000_000 },

    // Kimi / Moonshot (per 1M tokens)
    'kimi:kimi-k2.5': { input: 1.00 / 1_000_000, output: 4.00 / 1_000_000 },

    // Deepgram (per minute)
    'deepgram:nova-2': { input: 0.0043, output: 0 },
    'deepgram:nova-3': { input: 0.0043, output: 0 },

    // Cartesia (per 1M characters)
    'cartesia:sonic-2': { input: 0, output: 15.00 / 1_000_000 },
    'cartesia:sonic-3': { input: 0, output: 15.00 / 1_000_000 },

    // Twilio
    'twilio:call': { input: 0.014, output: 0 }, // per minute
    'twilio:sms': { input: 0.0079, output: 0 }, // per message

    // Daily (per minute of room usage — free for 1:1 voice, placeholder rate)
    'daily:room': { input: 0, output: 0 },

    // Brave Search (per 1K queries)
    'brave:search': { input: 3.00 / 1000, output: 0 },
};

/**
 * Calculate estimated cost for a usage event.
 * Accounts for prompt caching when cached_tokens and/or cache_creation_tokens
 * are present in metadata.
 *
 * Cost breakdown for providers with caching:
 * - Cached tokens:         charged at cached_input rate (e.g. 10% of standard)
 * - Cache creation tokens:  charged at cache_creation rate (e.g. 125% of standard)
 * - Remaining input tokens: charged at standard input rate
 * - Output tokens:          always charged at standard output rate
 */
export function calculateCost(event: UsageEvent): number {
    const key = `${event.service}:${event.model || event.operation}`;
    const rates = COST_RATES[key];

    if (!rates) {
        return 0;
    }

    const totalInput = event.input_units || 0;
    const outputCost = (event.output_units || 0) * rates.output;

    // If provider supports caching and metadata has cache info, split input cost
    const metadata = (event.metadata || {}) as Record<string, unknown>;
    const cachedTokens = typeof metadata.cached_tokens === 'number' ? metadata.cached_tokens : 0;
    const cacheCreationTokens = typeof metadata.cache_creation_tokens === 'number' ? metadata.cache_creation_tokens : 0;

    if ((cachedTokens > 0 || cacheCreationTokens > 0) && (rates.cached_input || rates.cache_creation)) {
        const cachedCost = cachedTokens * (rates.cached_input || rates.input);
        const creationCost = cacheCreationTokens * (rates.cache_creation || rates.input);
        const uncachedInput = Math.max(0, totalInput - cachedTokens - cacheCreationTokens);
        const uncachedCost = uncachedInput * rates.input;
        return cachedCost + creationCost + uncachedCost + outputCost;
    }

    return totalInput * rates.input + outputCost;
}
