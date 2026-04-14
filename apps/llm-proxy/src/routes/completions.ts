import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { resolveModel, getProviderKey, PROVIDERS } from '../config.js';
import { injectDashScopeCacheControl } from '../services/cache-control.js';
import { publishUsage } from '../services/usage.js';
import { authMiddleware } from '../middleware/auth.js';

const router: IRouter = Router();
const LOG_KEY_FINGERPRINTS = /^(1|true|yes)$/i.test(process.env.LLM_PROXY_LOG_KEY_FINGERPRINTS || 'false');

router.post('/v1/chat/completions', authMiddleware, async (req: Request, res: Response) => {
    const reqStartTime = Date.now();
    const reqId = `req-${reqStartTime}-${Math.random().toString(36).slice(2, 8)}`;

    try {
        const body = req.body;
        const modelStr: string = body.model;

        if (!modelStr) {
            res.status(400).json({ error: 'Missing "model" field' });
            return;
        }

        const resolved = resolveModel(modelStr);
        if (!resolved) {
            console.error(`[LLM-PROXY] [${reqId}] Cannot resolve provider for model: ${modelStr}`);
            res.status(400).json({ error: `Cannot resolve provider for model: ${modelStr}` });
            return;
        }

        const { provider, model } = resolved;
        const providerConfig = PROVIDERS[provider];
        const apiKey = getProviderKey(provider, req.keyHash);
        const keyFingerprint = apiKey
            ? `${apiKey.length}:${crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 12)}`
            : 'missing';

        // Verbose request logging
        const messageCount = Array.isArray(body.messages) ? body.messages.length : 0;
        const messageSummary = Array.isArray(body.messages)
            ? body.messages.map((m: any, i: number) => {
                const contentLen = typeof m.content === 'string'
                    ? m.content.length
                    : Array.isArray(m.content)
                        ? JSON.stringify(m.content).length
                        : 0;
                const toolCallCount = Array.isArray(m.tool_calls) ? m.tool_calls.length : 0;
                return `  [${i}] role=${m.role} contentLen=${contentLen}${toolCallCount ? ` toolCalls=${toolCallCount}` : ''}`;
            }).join('\n')
            : '  (no messages)';
        const toolCount = Array.isArray(body.tools) ? body.tools.length : 0;

        console.log(`[LLM-PROXY] [${reqId}] ──── REQUEST ────
  model: ${modelStr} → ${provider}/${model}
  keyHash: ${req.keyHash?.slice(0, 12)}…
  keyFingerprint: ${LOG_KEY_FINGERPRINTS ? keyFingerprint : 'disabled'}
  stream: ${body.stream ?? false}
  temperature: ${body.temperature ?? 'default'}
  max_tokens: ${body.max_tokens ?? 'default'}
  tools: ${toolCount}
  messages (${messageCount}):\n${messageSummary}`);

        if (!apiKey) {
            console.error(`[LLM-PROXY] [${reqId}] No API key for provider: ${provider}`);
            res.status(502).json({
                error: `No API key configured for provider: ${provider}`,
                hint: `Reload provider keys via POST /admin/reload-keys and ensure ${provider.toUpperCase()}_API_KEY (or QWEN_API_KEY for dashscope) is set`,
            });
            return;
        }

        // Rewrite model name in the body (strip provider prefix)
        body.model = model;

        // DashScope: disable prompt caching (testing enable_caching: false)
        // and default Qwen reasoning OFF unless the caller explicitly asked
        // for it. Qwen3's "thinking" phase is pure latency tax for templated
        // generation, and most callers shouldn't have to know about it.
        // A caller can opt in by sending `enable_thinking: true` in the body.
        if (provider === 'dashscope') {
            body.enable_caching = false;
            if (body.enable_thinking === undefined) {
                body.enable_thinking = false;
            }
        }



        // For streaming requests, inject stream_options to get usage in the final chunk
        const isStreaming = body.stream === true;
        if (isStreaming) {
            body.stream_options = { ...(body.stream_options || {}), include_usage: true };
        }

        const upstreamUrl = `${providerConfig.apiBase}/chat/completions`;
        const upstreamPayload = body;
        const serialized = JSON.stringify(upstreamPayload);

        // Debug: verify cache_control survived serialization
        if (provider === 'dashscope') {
            const ccIdx = serialized.indexOf('cache_control');
            const sysMsg = body.messages?.find((m: any) => m.role === 'system');
            const firstBlockKeys = Array.isArray(sysMsg?.content) ? Object.keys(sysMsg.content[0]) : [];
            console.log(`[LLM-PROXY] [${reqId}] DashScope wire: cache_control_at=${ccIdx} bodyLen=${serialized.length} sysBlockKeys=${firstBlockKeys.join(',')}`);
        }

        console.log(`[LLM-PROXY] [${reqId}] Upstream: ${upstreamUrl} bodyLen=${serialized.length}`);
        const fetchStartTime = Date.now();

        const upstreamRes = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: serialized,
        });

        const fetchDurationMs = Date.now() - fetchStartTime;
        console.log(`[LLM-PROXY] [${reqId}] ──── RESPONSE ────
  status: ${upstreamRes.status} ${upstreamRes.statusText}
  fetchMs: ${fetchDurationMs}
  content-type: ${upstreamRes.headers.get('content-type')}
  x-request-id: ${upstreamRes.headers.get('x-request-id') || 'n/a'}`);

        if (isStreaming) {
            await handleStreaming(req, res, upstreamRes, provider, model);
        } else {
            await handleNonStreaming(req, res, upstreamRes, provider, model);
        }
    } catch (err: any) {
        const totalMs = Date.now() - reqStartTime;
        console.error(`[LLM-PROXY] [${reqId}] ──── ERROR (${totalMs}ms) ────
  message: ${err.message}
  code: ${err.code || 'n/a'}
  type: ${err.type || err.name || 'n/a'}
  cause: ${err.cause?.message || 'n/a'}`);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Upstream request failed', message: err.message });
        }
    }
});

async function handleNonStreaming(
    req: Request,
    res: Response,
    upstreamRes: globalThis.Response,
    provider: string,
    model: string
): Promise<void> {
    const contentType = upstreamRes.headers.get('content-type') || 'application/json';

    const responseBody = await upstreamRes.text();

    if (!upstreamRes.ok) {
        console.error(`[LLM-PROXY] Upstream error (non-streaming) ${provider}/${model}: status=${upstreamRes.status} body=${responseBody.slice(0, 500)}`);

        // Content moderation rejection — replace the last tool result with an error
        // message and retry so the agent can continue its tool-use loop.
        if (upstreamRes.status === 400 && responseBody.includes('DataInspectionFailed')) {
            const retryResult = await retryWithSanitizedContext(req, provider, model);
            if (retryResult) {
                res.status(200);
                res.setHeader('Content-Type', 'application/json');
                res.send(retryResult);
                return;
            }
        }
    }

    res.status(upstreamRes.status);
    res.setHeader('Content-Type', contentType);

    // Try to extract usage from the response
    try {
        const parsed = JSON.parse(responseBody);
        emitUsageEvent(req, parsed, provider, model);
    } catch {
        // Not JSON or parse error — just forward
    }

    res.send(responseBody);
}

async function handleStreaming(
    req: Request,
    res: Response,
    upstreamRes: globalThis.Response,
    provider: string,
    model: string
): Promise<void> {
    if (!upstreamRes.ok) {
        const errorBody = await upstreamRes.text();
        console.error(`[LLM-PROXY] Upstream error (streaming) ${provider}/${model}: status=${upstreamRes.status} body=${errorBody.slice(0, 500)}`);

        // Content moderation rejection — sanitize context and retry (non-streaming)
        if (upstreamRes.status === 400 && errorBody.includes('DataInspectionFailed')) {
            const retryResult = await retryWithSanitizedContext(req, provider, model);
            if (retryResult) {
                // Convert non-streaming response to SSE format
                res.status(200);
                res.setHeader('Content-Type', 'text/event-stream');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.write(`data: ${retryResult}\n\n`);
                res.write('data: [DONE]\n\n');
                res.end();
                return;
            }
        }

        res.status(upstreamRes.status);
        res.setHeader('Content-Type', upstreamRes.headers.get('content-type') || 'application/json');
        res.send(errorBody);
        return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const body = upstreamRes.body;
    if (!body) {
        res.end();
        return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastUsageChunk: any = null;
    let requestId: string | undefined;

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const text = decoder.decode(value, { stream: true });
            buffer += text;

            // Forward raw bytes to client immediately
            res.write(text);

            // Parse SSE lines to capture usage from the final chunk
            // Handle both \n and \r\n line endings
            const lines = buffer.split(/\r?\n/);
            // Keep the last potentially incomplete line in the buffer
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                try {
                    const parsed = JSON.parse(data);
                    if (parsed.id) requestId = parsed.id;
                    if (parsed.usage) {
                        lastUsageChunk = parsed;
                    }
                } catch {
                    // Ignore non-JSON SSE lines
                }
            }
        }
    } catch (err: any) {
        // Client disconnect or upstream error
        if (err.name !== 'AbortError') {
            console.error(`[LLM-PROXY] Stream read error: ${err.message} (code=${err.code || 'n/a'} type=${err.type || err.name || 'n/a'})`);
        }
    } finally {
        reader.releaseLock();
    }

    // Process any remaining data in the buffer (final chunk may not end with newline)
    if (buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
                const parsed = JSON.parse(data);
                if (parsed.id) requestId = parsed.id;
                if (parsed.usage) lastUsageChunk = parsed;
            } catch { /* ignore */ }
        }
    }

    // Emit usage event from the final chunk (which includes usage when stream_options.include_usage is set)
    if (lastUsageChunk) {
        if (requestId && !lastUsageChunk.id) {
            lastUsageChunk.id = requestId;
        }
        emitUsageEvent(req, lastUsageChunk, provider, model);
    }

    res.end();
}

function emitUsageEvent(req: Request, response: any, provider: string, model: string): void {
    const usage = response?.usage;
    if (!usage) return;

    const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
    const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
    const cachedTokens = usage.prompt_tokens_details?.cached_tokens
        ?? usage.prompt_cache_hit_tokens
        ?? 0;
    const cacheCreationTokens = usage.prompt_tokens_details?.cache_creation_input_tokens
        ?? usage.prompt_tokens_details?.cache_creation?.ephemeral_5m_input_tokens
        ?? 0;

    console.log(`[LLM-PROXY] Usage: ${provider}/${model} in=${inputTokens} cached=${cachedTokens} created=${cacheCreationTokens} out=${outputTokens}`);

    // Allow callers to label the operation via X-Operation header (default: 'chat')
    const operation = req.headers['x-operation'] as string || 'chat';

    publishUsage({
        service: provider,
        operation,
        model,
        input_units: inputTokens,
        output_units: outputTokens,
        timestamp: new Date().toISOString(),
        metadata: {
            request_id: response.id || undefined,
            user_api_key_hash: req.keyHash || '',
            cached_tokens: cachedTokens || undefined,
            cache_creation_tokens: cacheCreationTokens || undefined,
        },
    }).catch((err) => {
        console.error('[LLM-PROXY] Failed to emit usage:', err.message);
    });
}

/**
 * When Dashscope rejects a request due to content moderation, replace the last
 * tool result in the messages with an error notice and retry. The LLM sees
 * "this tool result was filtered" and can decide to skip/continue.
 */
async function retryWithSanitizedContext(
    req: Request,
    provider: string,
    model: string,
): Promise<string | null> {
    const body = req.body;
    const messages = body?.messages;
    if (!Array.isArray(messages)) return null;

    // Find the last tool-result message and replace its content
    let sanitized = false;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (msg.role === 'tool') {
            console.warn(`[LLM-PROXY] Content moderation: sanitizing tool result at index ${i} (was ${String(msg.content).length} chars)`);
            msg.content = '[Tool result omitted — content was flagged by the language model\'s safety filter. Skip this item and continue with your remaining tasks.]';
            sanitized = true;
            break;
        }
    }

    if (!sanitized) return null;

    const providerConfig = PROVIDERS[provider];
    const apiKey = getProviderKey(provider, req.keyHash);
    if (!apiKey) return null;

    const upstreamUrl = `${providerConfig.apiBase}/chat/completions`;
    // Force non-streaming for the retry
    body.stream = false;
    delete body.stream_options;

    console.log(`[LLM-PROXY] Content moderation: retrying with sanitized context`);

    try {
        const retryRes = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!retryRes.ok) {
            console.error(`[LLM-PROXY] Content moderation retry also failed: ${retryRes.status}`);
            return null;
        }

        const retryBody = await retryRes.text();
        try {
            const parsed = JSON.parse(retryBody);
            emitUsageEvent(req, parsed, provider, model);
        } catch { /* ignore */ }

        return retryBody;
    } catch (err: any) {
        console.error(`[LLM-PROXY] Content moderation retry error: ${err.message}`);
        return null;
    }
}

export default router;
