export interface ProviderConfig {
    apiBase: string;
    apiKeyEnv: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
    openai: {
        apiBase: 'https://api.openai.com/v1',
        apiKeyEnv: 'OPENAI_API_KEY',
    },
    anthropic: {
        apiBase: 'https://api.anthropic.com/v1',
        apiKeyEnv: 'ANTHROPIC_API_KEY',
    },
    dashscope: {
        apiBase: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        apiKeyEnv: 'DASHSCOPE_API_KEY',
    },
    minimax: {
        apiBase: 'https://api.minimax.io/v1',
        apiKeyEnv: 'MINIMAX_API_KEY',
    },
    kimi: {
        apiBase: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'KIMI_API_KEY',
    },
    local: {
        apiBase: 'http://localhost:8089/v1',
        apiKeyEnv: 'LOCAL_API_KEY',
    },
};

/** In-memory store for provider API keys, hot-reloadable via /admin/reload-keys */
const providerKeys: Record<string, string> = {};

function normalizeApiKey(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    let trimmed = value.trim();
    if (!trimmed) return undefined;
    // Handle accidentally pasted quoted values in config UIs.
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        const unquoted = trimmed.slice(1, -1).trim();
        trimmed = unquoted;
    }
    // Users sometimes paste "Bearer <key>" into key fields.
    trimmed = trimmed.replace(/^Bearer\s+/i, '').trim();
    if (!trimmed) return undefined;
    return trimmed;
}

/** Load provider keys from environment variables at startup */
export function loadKeysFromEnv(): void {
    for (const [name, config] of Object.entries(PROVIDERS)) {
        const val = normalizeApiKey(process.env[config.apiKeyEnv]);
        if (val) providerKeys[name] = val;
    }
    // DASHSCOPE_API_KEY can fall back to QWEN_API_KEY
    const qwenFallback = normalizeApiKey(process.env.QWEN_API_KEY);
    if (!providerKeys.dashscope && qwenFallback) {
        providerKeys.dashscope = qwenFallback;
    }
}

/** Replace all provider keys (called from /admin/reload-keys) */
export function setProviderKeys(keys: Record<string, string>): void {
    // Clear existing
    for (const k of Object.keys(providerKeys)) {
        delete providerKeys[k];
    }
    // Map env var names to provider names
    for (const [name, config] of Object.entries(PROVIDERS)) {
        const val = normalizeApiKey(keys[config.apiKeyEnv]);
        if (val) providerKeys[name] = val;
    }
    // DASHSCOPE_API_KEY fallback to QWEN_API_KEY
    const qwenFallback = normalizeApiKey(keys.QWEN_API_KEY);
    if (!providerKeys.dashscope && qwenFallback) {
        providerKeys.dashscope = qwenFallback;
    }
}

// ── Org-level provider key overrides ──

/** keyHash → orgId */
const agentOrgMap: Map<string, string> = new Map();

/** orgId → { providerName: apiKey } */
const orgProviderKeys: Map<string, Record<string, string>> = new Map();

/** Replace agent→org mappings (called from /admin/sync-org-keys) */
export function setAgentOrgMapping(mapping: Record<string, string>): void {
    agentOrgMap.clear();
    for (const [keyHash, orgId] of Object.entries(mapping)) {
        agentOrgMap.set(keyHash, orgId);
    }
}

/** Replace org provider key overrides (called from /admin/sync-org-keys) */
export function setOrgProviderKeys(keys: Record<string, Record<string, string>>): void {
    orgProviderKeys.clear();
    for (const [orgId, providerMap] of Object.entries(keys)) {
        const normalizedMap: Record<string, string> = {};
        for (const [provider, raw] of Object.entries(providerMap || {})) {
            const normalized = normalizeApiKey(raw);
            if (normalized) normalizedMap[provider] = normalized;
        }
        orgProviderKeys.set(orgId, normalizedMap);
    }
}

/**
 * Get the API key for a provider.
 * If keyHash is provided and maps to an org with an override, use the org key.
 */
export function getProviderKey(provider: string, keyHash?: string): string | undefined {
    // Local provider needs no API key — return a placeholder so the proxy doesn't reject the request
    if (provider === 'local') return providerKeys.local || 'no-key-needed';

    if (keyHash) {
        const orgId = agentOrgMap.get(keyHash);
        if (orgId) {
            const orgKeys = orgProviderKeys.get(orgId);
            if (orgKeys && orgKeys[provider]) {
                return orgKeys[provider];
            }
        }
    }
    return providerKeys[provider];
}

/**
 * Resolve a model string to { provider, model }.
 * Supports explicit prefix (e.g. "dashscope/qwen3.6-plus") or heuristic matching.
 */
/** Aliases for model names that differ between our config and upstream provider APIs */
const MODEL_ALIASES: Record<string, string> = {
};

export function resolveModel(model: string): { provider: string; model: string } | null {
    // Explicit prefix: "provider/model-name"
    const slashIdx = model.indexOf('/');
    if (slashIdx > 0) {
        const prefix = model.slice(0, slashIdx);
        if (PROVIDERS[prefix]) {
            const rawModel = model.slice(slashIdx + 1);
            return { provider: prefix, model: MODEL_ALIASES[rawModel] ?? rawModel };
        }
    }

    // Heuristic matching for bare model names
    const lower = model.toLowerCase();
    // Route OpenAI-style embedding model ids through Dashscope and alias to a Dashscope-supported embedding model.
    // OpenClaw defaults to "text-embedding-3-small"; Dashscope expects a "text-embedding-v*" id.
    if (
        lower === 'text-embedding-3-small' ||
        lower === 'text-embedding3-small' ||
        lower === 'text-embedding-3-large' ||
        lower === 'text-embedding-ada-002'
    ) {
        return { provider: 'dashscope', model: 'text-embedding-v4' };
    }
    if (lower.startsWith('text-embedding-v')) return { provider: 'dashscope', model };
    if (lower === 'qwen3.5-local') return { provider: 'local', model };
    if (lower.startsWith('qwen')) return { provider: 'dashscope', model: MODEL_ALIASES[model] ?? model };
    if (lower.startsWith('claude')) return { provider: 'anthropic', model };
    if (lower.startsWith('gpt-') || lower.startsWith('o1') || lower.startsWith('o3') || lower.startsWith('o4')) {
        return { provider: 'openai', model };
    }
    if (lower.startsWith('moonshot') || lower.startsWith('kimi')) return { provider: 'kimi', model };
    if (lower.startsWith('minimax')) return { provider: 'minimax', model };

    return null;
}

// ── Agent condensation config store ──

interface AgentCondensationConfig {
    condensation_model: string;
}

const agentConfigs: Map<string, AgentCondensationConfig> = new Map();

/** Replace all agent condensation configs (called from /admin/sync-agent-configs) */
export function setAgentConfigs(configs: Record<string, AgentCondensationConfig>): void {
    agentConfigs.clear();
    for (const [keyHash, config] of Object.entries(configs)) {
        agentConfigs.set(keyHash, config);
    }
}

/** Look up condensation config for a given key hash */
export function getAgentConfig(keyHash: string): AgentCondensationConfig | undefined {
    return agentConfigs.get(keyHash);
}
