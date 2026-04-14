import { resolveModel, getProviderKey, PROVIDERS } from '../config.js';
import { publishUsage } from './usage.js';

/** Minimum system prompt length (chars) to bother condensing */
const MIN_SYSTEM_LENGTH = 2000;
/** Reject condensed output if it's less than this fraction of the original */
const MIN_RATIO = 0.20;

const META_PROMPT = `You are a prompt optimizer. Given a system prompt and the user's current message, remove sections of the system prompt that are clearly irrelevant to this specific user message. Keep all personality traits, core instructions, and relevant context. Output ONLY the condensed system prompt — no explanations, no wrapping.`;

/**
 * Extract text content from a message (handles string and content-block formats).
 */
function getMessageText(msg: any): string {
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
        return msg.content
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text)
            .join('\n');
    }
    return '';
}

/**
 * Condense a system prompt by stripping sections irrelevant to the current user message.
 * Returns the condensed prompt text, or null if condensation fails or is skipped.
 */
async function condenseSystemPrompt(
    systemPrompt: string,
    userMessage: string,
    condensationModel: string,
    keyHash?: string
): Promise<string | null> {
    const resolved = resolveModel(condensationModel);
    if (!resolved) {
        console.warn(`[CONDENSATION] SKIP — cannot resolve model: ${condensationModel}`);
        return null;
    }

    const { provider, model } = resolved;
    const providerConfig = PROVIDERS[provider];
    const apiKey = getProviderKey(provider);

    if (!apiKey) {
        console.warn(`[CONDENSATION] SKIP — no API key for provider: ${provider}`);
        return null;
    }

    const inputText = `<system_prompt>\n${systemPrompt}\n</system_prompt>\n\n<user_message>\n${userMessage}\n</user_message>`;

    console.log(`[CONDENSATION] CALLING ${provider}/${model} at ${providerConfig.apiBase}/chat/completions`);
    const startTime = Date.now();

    try {
        const body = {
            model,
            messages: [
                { role: 'system', content: META_PROMPT },
                { role: 'user', content: inputText },
            ],
            temperature: 0,
            max_tokens: Math.ceil(systemPrompt.length / 2),
        };

        console.log(`[CONDENSATION] Request: model=${model} systemChars=${systemPrompt.length} userChars=${userMessage.length} payload=${JSON.stringify(body).length} bytes`);

        const response = await fetch(`${providerConfig.apiBase}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        const fetchElapsed = Date.now() - startTime;
        console.log(`[CONDENSATION] RESPONSE status=${response.status} after ${fetchElapsed}ms`);

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error(`[CONDENSATION] UPSTREAM ERROR ${response.status}: ${errText.slice(0, 300)}`);
            return null;
        }

        const data = await response.json() as {
            choices?: { message?: { content?: string } }[];
            usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
            };
        };

        const condensed = data.choices?.[0]?.message?.content?.trim();

        if (!condensed) {
            console.warn(`[CONDENSATION] EMPTY RESPONSE, skipping`);
            return null;
        }

        const elapsed = Date.now() - startTime;
        const inputTokens = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        const ratio = Math.round((1 - condensed.length / systemPrompt.length) * 100);

        console.log(`[CONDENSATION] DONE ${provider}/${model} ${elapsed}ms | ${systemPrompt.length} → ${condensed.length} chars (${ratio}% reduction) | in=${inputTokens} out=${outputTokens} tokens`);

        // Safety guard: reject if condensed is too short (model hallucinated or failed)
        if (condensed.length < systemPrompt.length * MIN_RATIO) {
            console.warn(`[CONDENSATION] REJECTED — condensed too short (${condensed.length} < ${Math.round(systemPrompt.length * MIN_RATIO)} min). Keeping original.`);
            return null;
        }

        // Publish usage event for the condensation call
        publishUsage({
            service: provider,
            operation: 'condensation',
            model,
            input_units: inputTokens,
            output_units: outputTokens,
            timestamp: new Date().toISOString(),
            metadata: {
                user_api_key_hash: keyHash || '',
            },
        }).catch((err) => {
            console.error('[CONDENSATION] Failed to emit usage:', err.message);
        });

        return condensed;
    } catch (err: any) {
        const elapsed = Date.now() - startTime;
        console.error(`[CONDENSATION] ERROR after ${elapsed}ms: ${err.message}`);
        return null;
    }
}

/**
 * If the request has a system prompt long enough, condense it in-place.
 *
 * Finds the system message and the last user message, calls the condensation
 * model to produce a shorter system prompt, and replaces the system message content.
 */
export async function condenseIfNeeded(
    body: { messages?: any[] },
    condensationModel: string,
    keyHash?: string
): Promise<void> {
    if (!body.messages || !Array.isArray(body.messages)) return;

    const systemMsg = body.messages.find((m: any) => m.role === 'system');
    if (!systemMsg) {
        console.log('[CONDENSATION] SKIP — no system message in request');
        return;
    }

    const systemText = getMessageText(systemMsg);
    if (systemText.length < MIN_SYSTEM_LENGTH) {
        console.log(`[CONDENSATION] SKIP — system prompt too short (${systemText.length} chars < ${MIN_SYSTEM_LENGTH})`);
        return;
    }

    // Find the last user message to provide context for condensation
    const lastUserMsg = [...body.messages].reverse().find((m: any) => m.role === 'user');
    const userText = lastUserMsg ? getMessageText(lastUserMsg) : '';

    if (!userText) {
        console.log('[CONDENSATION] SKIP — no user message found for context');
        return;
    }

    console.log(`[CONDENSATION] START — system=${systemText.length} chars, userMsg=${userText.length} chars, model=${condensationModel}, keyHash=${keyHash?.slice(0, 12) || 'none'}...`);

    const condensed = await condenseSystemPrompt(systemText, userText, condensationModel, keyHash);
    if (!condensed) return;

    // Replace system message content in-place
    if (typeof systemMsg.content === 'string') {
        systemMsg.content = condensed;
    } else if (Array.isArray(systemMsg.content)) {
        // Content blocks format — replace with single text block
        systemMsg.content = [{ type: 'text', text: condensed }];
    }

    console.log(`[CONDENSATION] REPLACED system prompt: ${systemText.length} → ${condensed.length} chars`);
}
