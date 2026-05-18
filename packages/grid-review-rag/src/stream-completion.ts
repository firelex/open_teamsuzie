import type { LlmStream, CellChatMessage } from '@teamsuzie/grid-review';

export interface StreamCompletionOptions {
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  /** Merged into the request body — used for Qwen's enable_thinking flag etc. */
  extraBody?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}

interface OpenAiChunk {
  choices?: Array<{ delta?: { content?: string } }>;
}

/**
 * Minimal OpenAI-compatible streaming chat-completion call. Skips
 * agent-loop's tool machinery — cell runs are plain completions.
 *
 * Extracted from suzielaw 2026-05-18 alongside `buildRagRunCellAdapter`
 * so PE-vertical apps (diligence, et al.) can drive grid-review cells
 * against an OpenAI-compatible endpoint without inheriting suzielaw-
 * specific token-metering glue.
 */
export function makeStreamCompletion(opts: StreamCompletionOptions): LlmStream {
  return async function* ({ messages, signal }) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
    const response = await (opts.fetchImpl ?? fetch)(`${opts.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        messages: messages as CellChatMessage[],
        stream: true,
        stream_options: { include_usage: true },
        ...(opts.extraBody ?? {}),
      }),
      signal,
    });
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => '');
      throw new Error(`chat completions returned ${response.status}: ${text.slice(0, 200)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const event of events) {
        const line = event.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const chunk = JSON.parse(payload) as OpenAiChunk;
          const text = chunk.choices?.[0]?.delta?.content;
          if (typeof text === 'string' && text.length > 0) {
            yield text;
          }
        } catch {
          // ignore malformed chunks
        }
      }
    }
  };
}
