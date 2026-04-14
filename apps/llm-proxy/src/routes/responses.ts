import { Router, type IRouter } from 'express';
import type { Request, Response } from 'express';
import crypto from 'crypto';
import { resolveModel, getProviderKey, PROVIDERS } from '../config.js';
import { injectDashScopeCacheControl } from '../services/cache-control.js';
import { publishUsage } from '../services/usage.js';
import { authMiddleware } from '../middleware/auth.js';

const router: IRouter = Router();

// ── Responses API → Chat Completions translation ──

/**
 * Convert Responses API `input` + `instructions` into Chat Completions `messages`.
 *
 * Handles:
 *  - string input (→ single user message)
 *  - array of message objects (role/content shorthand or typed items)
 *  - function_call / function_call_output items (tool use round-trips)
 *  - top-level `instructions` field (→ system message)
 */
function inputToMessages(input: any, instructions?: string): any[] {
    const messages: any[] = [];

    if (instructions) {
        messages.push({ role: 'system', content: instructions });
    }

    if (typeof input === 'string') {
        messages.push({ role: 'user', content: input });
        return messages;
    }

    if (!Array.isArray(input)) {
        return messages;
    }

    for (const item of input) {
        if (item.type === 'function_call') {
            // Tool call from a previous assistant turn
            messages.push({
                role: 'assistant',
                content: null,
                tool_calls: [{
                    id: item.call_id ?? item.id,
                    type: 'function',
                    function: { name: item.name, arguments: item.arguments ?? '' },
                }],
            });
        } else if (item.type === 'function_call_output') {
            messages.push({
                role: 'tool',
                tool_call_id: item.call_id,
                content: typeof item.output === 'string' ? item.output : JSON.stringify(item.output),
            });
        } else {
            // Regular message — with or without explicit `type: "message"`
            const role = item.role || 'user';
            messages.push({ role, content: item.content });
        }
    }

    return messages;
}

/**
 * Convert Responses API `tools` array to Chat Completions `tools` format.
 * Responses API tools have `{type: "function", name, description, parameters}` at the
 * top level, whereas Chat Completions nests under `.function`.
 */
function convertTools(tools: any[] | undefined): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map(t => {
        if (t.type === 'function') {
            // Already in Responses format — needs wrapping
            if (t.parameters !== undefined || t.name !== undefined) {
                return {
                    type: 'function',
                    function: {
                        name: t.name,
                        description: t.description,
                        parameters: t.parameters ?? t.input_schema,
                    },
                };
            }
            // Already in Chat Completions format (has .function)
            if (t.function) return t;
        }
        // Pass through unknown tool types as-is
        return t;
    });
}

/**
 * Build a full Responses API response object from a Chat Completions response.
 */
function completionToResponse(completion: any, responseId: string, model: string): any {
    const choice = completion.choices?.[0];
    const message = choice?.message;
    const output: any[] = [];

    if (message?.content) {
        output.push({
            type: 'message',
            id: `msg_${responseId.slice(5)}`,
            status: 'completed',
            role: 'assistant',
            content: [{
                type: 'output_text',
                text: message.content,
                annotations: [],
            }],
        });
    }

    if (message?.tool_calls) {
        for (const tc of message.tool_calls) {
            output.push({
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: tc.function.name,
                arguments: tc.function.arguments,
                status: 'completed',
            });
        }
    }

    const usage = completion.usage;

    return {
        id: responseId,
        object: 'response',
        created_at: completion.created ?? Math.floor(Date.now() / 1000),
        status: 'completed',
        model,
        output,
        usage: usage ? {
            input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
            output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
            total_tokens: (usage.prompt_tokens ?? usage.input_tokens ?? 0) + (usage.completion_tokens ?? usage.output_tokens ?? 0),
        } : undefined,
    };
}

// ── Route ──

router.post('/v1/responses', authMiddleware, async (req: Request, res: Response) => {
    const reqStartTime = Date.now();
    const reqId = `req-${reqStartTime}-${Math.random().toString(36).slice(2, 8)}`;
    const responseId = `resp_${crypto.randomBytes(12).toString('hex')}`;

    try {
        const body = req.body;
        const modelStr: string = body.model;

        if (!modelStr) {
            res.status(400).json({ error: 'Missing "model" field' });
            return;
        }

        const resolved = resolveModel(modelStr);
        if (!resolved) {
            console.error(`[LLM-PROXY] [${reqId}] [responses] Cannot resolve provider for model: ${modelStr}`);
            res.status(400).json({ error: `Cannot resolve provider for model: ${modelStr}` });
            return;
        }

        const { provider, model } = resolved;
        const apiKey = getProviderKey(provider, req.keyHash);

        console.log(`[LLM-PROXY] [${reqId}] ──── RESPONSES REQUEST ────
  model: ${modelStr} → ${provider}/${model}
  keyHash: ${req.keyHash?.slice(0, 12)}…
  stream: ${body.stream ?? false}
  tools: ${Array.isArray(body.tools) ? body.tools.length : 0}`);

        if (!apiKey) {
            console.error(`[LLM-PROXY] [${reqId}] [responses] No API key for provider: ${provider}`);
            res.status(502).json({ error: `No API key configured for provider: ${provider}` });
            return;
        }

        const providerConfig = PROVIDERS[provider];

        // ── Providers with native Responses API support: pass through directly ──
        if (provider === 'openai') {
            body.model = model;
            const upstreamUrl = `${providerConfig.apiBase}/responses`;
            const serialized = JSON.stringify(body);

            console.log(`[LLM-PROXY] [${reqId}] [responses] Passthrough → ${upstreamUrl} bodyLen=${serialized.length}`);

            const upstreamRes = await fetch(upstreamUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: serialized,
            });

            const fetchMs = Date.now() - reqStartTime;
            console.log(`[LLM-PROXY] [${reqId}] [responses] Passthrough status=${upstreamRes.status} fetchMs=${fetchMs}`);

            // Stream or forward the response as-is
            const contentType = upstreamRes.headers.get('content-type') || 'application/json';
            res.status(upstreamRes.status);
            res.setHeader('Content-Type', contentType);

            if (body.stream && upstreamRes.body) {
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');
                res.setHeader('X-Accel-Buffering', 'no');

                const reader = upstreamRes.body.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        res.write(value);
                    }
                } catch (err: any) {
                    if (err.name !== 'AbortError') {
                        console.error(`[LLM-PROXY] [${reqId}] [responses] Passthrough stream error: ${err.message}`);
                    }
                } finally {
                    reader.releaseLock();
                }
                res.end();
            } else {
                const responseBody = await upstreamRes.text();
                // Try to extract usage for tracking
                try {
                    const parsed = JSON.parse(responseBody);
                    if (parsed.usage) {
                        emitUsageEvent(req, { usage: {
                            prompt_tokens: parsed.usage.input_tokens,
                            completion_tokens: parsed.usage.output_tokens,
                        }, id: parsed.id }, provider, model);
                    }
                } catch { /* ignore */ }
                res.send(responseBody);
            }
            return;
        }

        // ── Other providers: translate Responses API → Chat Completions ──
        const messages = inputToMessages(body.input, body.instructions);
        const tools = convertTools(body.tools);

        const completionBody: any = {
            model,
            messages,
            stream: body.stream ?? false,
        };

        if (tools) completionBody.tools = tools;
        if (body.tool_choice !== undefined) completionBody.tool_choice = body.tool_choice;
        if (body.temperature !== undefined) completionBody.temperature = body.temperature;
        if (body.top_p !== undefined) completionBody.top_p = body.top_p;
        if (body.max_output_tokens !== undefined) completionBody.max_tokens = body.max_output_tokens;

        const isStreaming = completionBody.stream === true;
        if (isStreaming) {
            completionBody.stream_options = { include_usage: true };
        }

        // DashScope: disable prompt caching (testing enable_caching: false)
        // and default Qwen reasoning OFF unless the caller explicitly asked
        // for it. See apps/llm-proxy/src/routes/completions.ts for the
        // rationale — this route must stay consistent with that one.
        if (provider === 'dashscope') {
            completionBody.enable_caching = false;
            if (completionBody.enable_thinking === undefined) {
                completionBody.enable_thinking = false;
            }
        }

        const upstreamUrl = `${providerConfig.apiBase}/chat/completions`;
        const serialized = JSON.stringify(completionBody);

        console.log(`[LLM-PROXY] [${reqId}] [responses] Translate → ${upstreamUrl} bodyLen=${serialized.length}`);

        const upstreamRes = await fetch(upstreamUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: serialized,
        });

        const fetchMs = Date.now() - reqStartTime;
        console.log(`[LLM-PROXY] [${reqId}] [responses] Upstream status=${upstreamRes.status} fetchMs=${fetchMs}`);

        if (!upstreamRes.ok) {
            const errorBody = await upstreamRes.text();
            console.error(`[LLM-PROXY] [${reqId}] [responses] Upstream error: ${errorBody.slice(0, 500)}`);
            res.status(upstreamRes.status);
            res.setHeader('Content-Type', 'application/json');
            res.send(errorBody);
            return;
        }

        if (isStreaming) {
            await handleResponsesStreaming(req, res, upstreamRes, provider, model, responseId, reqId);
        } else {
            await handleResponsesNonStreaming(req, res, upstreamRes, provider, model, responseId);
        }
    } catch (err: any) {
        const totalMs = Date.now() - reqStartTime;
        console.error(`[LLM-PROXY] [${reqId}] [responses] ERROR (${totalMs}ms): ${err.message}`);
        if (!res.headersSent) {
            res.status(502).json({ error: 'Upstream request failed', message: err.message });
        }
    }
});

// ── Non-streaming handler ──

async function handleResponsesNonStreaming(
    req: Request,
    res: Response,
    upstreamRes: globalThis.Response,
    provider: string,
    model: string,
    responseId: string,
): Promise<void> {
    const text = await upstreamRes.text();
    let completion: any;
    try {
        completion = JSON.parse(text);
    } catch {
        res.status(502).json({ error: 'Invalid JSON from upstream' });
        return;
    }

    emitUsageEvent(req, completion, provider, model);

    const responseObj = completionToResponse(completion, responseId, model);
    res.status(200).json(responseObj);
}

// ── Streaming handler ──
// Translates Chat Completions SSE chunks into Responses API SSE events.

async function handleResponsesStreaming(
    req: Request,
    res: Response,
    upstreamRes: globalThis.Response,
    provider: string,
    model: string,
    responseId: string,
    reqId: string,
): Promise<void> {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const msgItemId = `msg_${responseId.slice(5)}`;
    const createdAt = Math.floor(Date.now() / 1000);

    // Emit initial Responses API events
    const baseResponse = {
        id: responseId,
        object: 'response',
        created_at: createdAt,
        model,
        output: [],
        status: 'in_progress',
    };

    sendEvent(res, 'response.created', baseResponse);

    // Track state across chunks
    let emittedOutputItem = false;
    let emittedContentPart = false;
    let fullText = '';
    // Tool call accumulators: index → { id, name, arguments }
    const toolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
    let emittedToolItems: Set<number> = new Set();
    let lastUsageChunk: any = null;
    let completionRequestId: string | undefined;

    const body = upstreamRes.body;
    if (!body) {
        sendEvent(res, 'response.completed', { ...baseResponse, status: 'completed' });
        res.end();
        return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') continue;

                let chunk: any;
                try {
                    chunk = JSON.parse(data);
                } catch {
                    continue;
                }

                if (chunk.id) completionRequestId = chunk.id;
                if (chunk.usage) lastUsageChunk = chunk;

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                // ── Text content ──
                if (delta.content) {
                    if (!emittedOutputItem) {
                        emittedOutputItem = true;
                        sendEvent(res, 'response.output_item.added', {
                            output_index: 0,
                            item: {
                                type: 'message',
                                id: msgItemId,
                                status: 'in_progress',
                                role: 'assistant',
                                content: [],
                            },
                        });
                    }
                    if (!emittedContentPart) {
                        emittedContentPart = true;
                        sendEvent(res, 'response.content_part.added', {
                            output_index: 0,
                            content_index: 0,
                            part: { type: 'output_text', text: '', annotations: [] },
                        });
                    }

                    fullText += delta.content;
                    sendEvent(res, 'response.output_text.delta', {
                        output_index: 0,
                        content_index: 0,
                        delta: delta.content,
                    });
                }

                // ── Tool calls ──
                if (delta.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index ?? 0;
                        if (!toolCalls.has(idx)) {
                            toolCalls.set(idx, { id: tc.id || '', name: '', arguments: '' });
                        }
                        const acc = toolCalls.get(idx)!;
                        if (tc.id) acc.id = tc.id;
                        if (tc.function?.name) acc.name += tc.function.name;
                        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
                    }
                }
            }
        }
    } catch (err: any) {
        if (err.name !== 'AbortError') {
            console.error(`[LLM-PROXY] [${reqId}] [responses] Stream read error: ${err.message}`);
        }
    } finally {
        reader.releaseLock();
    }

    // Process remaining buffer
    if (buffer.trim()) {
        for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith('data: ')) continue;
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
                const chunk = JSON.parse(data);
                if (chunk.id) completionRequestId = chunk.id;
                if (chunk.usage) lastUsageChunk = chunk;
            } catch { /* ignore */ }
        }
    }

    // ── Finalize text output item ──
    if (emittedContentPart) {
        sendEvent(res, 'response.output_text.done', {
            output_index: 0,
            content_index: 0,
            text: fullText,
        });
        sendEvent(res, 'response.content_part.done', {
            output_index: 0,
            content_index: 0,
            part: { type: 'output_text', text: fullText, annotations: [] },
        });
    }
    if (emittedOutputItem) {
        sendEvent(res, 'response.output_item.done', {
            output_index: 0,
            item: {
                type: 'message',
                id: msgItemId,
                status: 'completed',
                role: 'assistant',
                content: emittedContentPart
                    ? [{ type: 'output_text', text: fullText, annotations: [] }]
                    : [],
            },
        });
    }

    // ── Finalize tool call output items ──
    let outputIndex = emittedOutputItem ? 1 : 0;
    for (const [, tc] of toolCalls) {
        sendEvent(res, 'response.output_item.added', {
            output_index: outputIndex,
            item: {
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                status: 'completed',
            },
        });
        sendEvent(res, 'response.output_item.done', {
            output_index: outputIndex,
            item: {
                type: 'function_call',
                id: tc.id,
                call_id: tc.id,
                name: tc.name,
                arguments: tc.arguments,
                status: 'completed',
            },
        });
        outputIndex++;
    }

    // ── Build final output array ──
    const finalOutput: any[] = [];
    if (emittedOutputItem) {
        finalOutput.push({
            type: 'message',
            id: msgItemId,
            status: 'completed',
            role: 'assistant',
            content: emittedContentPart
                ? [{ type: 'output_text', text: fullText, annotations: [] }]
                : [],
        });
    }
    for (const [, tc] of toolCalls) {
        finalOutput.push({
            type: 'function_call',
            id: tc.id,
            call_id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
            status: 'completed',
        });
    }

    // ── Usage ──
    const usage = lastUsageChunk?.usage;
    const responsesUsage = usage ? {
        input_tokens: usage.prompt_tokens ?? usage.input_tokens ?? 0,
        output_tokens: usage.completion_tokens ?? usage.output_tokens ?? 0,
        total_tokens: (usage.prompt_tokens ?? usage.input_tokens ?? 0) + (usage.completion_tokens ?? usage.output_tokens ?? 0),
    } : undefined;

    // ── Completed event ──
    sendEvent(res, 'response.completed', {
        ...baseResponse,
        status: 'completed',
        output: finalOutput,
        usage: responsesUsage,
    });

    // Emit usage to Redis
    if (lastUsageChunk) {
        if (completionRequestId && !lastUsageChunk.id) {
            lastUsageChunk.id = completionRequestId;
        }
        emitUsageEvent(req, lastUsageChunk, provider, model);
    }

    res.end();
}

// ── Helpers ──

function sendEvent(res: Response, event: string, data: any): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

    console.log(`[LLM-PROXY] Usage (responses): ${provider}/${model} in=${inputTokens} cached=${cachedTokens} out=${outputTokens}`);

    publishUsage({
        service: provider,
        operation: 'responses',
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
        console.error('[LLM-PROXY] Failed to emit usage (responses):', err.message);
    });
}

export default router;
