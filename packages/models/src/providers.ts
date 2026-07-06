import type { ChatMessage, ProviderId } from './types.js';

/**
 * Provider adapters. The ONLY place that knows a provider's wire shape. Two
 * formats cover all four providers we support:
 *   - `openai`  — OpenAI /chat/completions (OpenAI, Qwen/DashScope, and any
 *                 reachable local OpenAI-compatible runtime)
 *   - `anthropic` — Anthropic /messages (system is top-level, not a message)
 *
 * No provider SDK is imported — plain `fetch` (injected for tests). Streaming is
 * the primitive: `streamChat` yields text deltas; a non-streaming caller just
 * concatenates them.
 */

export type WireFormat = 'openai' | 'anthropic';

export interface ProviderConfig {
  id: ProviderId;
  format: WireFormat;
  /** Base URL WITHOUT trailing slash, e.g. `https://api.anthropic.com/v1`. */
  baseUrl: string;
  /** Env var holding the API key (hosted providers). Omitted for local. */
  keyEnv?: string;
}

/** Hosted providers, with env-overridable base URLs (a provider moving hosts must not need a code change). */
export function hostedProviders(env: NodeJS.ProcessEnv): Record<'anthropic' | 'openai' | 'qwen', ProviderConfig> {
  return {
    anthropic: {
      id: 'anthropic',
      format: 'anthropic',
      baseUrl: env.MODELS_ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1',
      keyEnv: 'ANTHROPIC_API_KEY',
    },
    openai: {
      id: 'openai',
      format: 'openai',
      baseUrl: env.MODELS_OPENAI_BASE_URL || 'https://api.openai.com/v1',
      keyEnv: 'OPENAI_API_KEY',
    },
    qwen: {
      id: 'qwen',
      format: 'openai',
      baseUrl: env.MODELS_QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      keyEnv: 'DASHSCOPE_API_KEY',
    },
  };
}

export interface StreamChatParams {
  config: ProviderConfig;
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
  fetchImpl: typeof fetch;
  signal?: AbortSignal;
}

/** Stream text deltas from a provider. Throws a descriptive Error on a non-OK response. */
export async function* streamChat(p: StreamChatParams): AsyncIterable<string> {
  const res =
    p.config.format === 'anthropic'
      ? await postAnthropic(p)
      : await postOpenAi(p);

  if (!res.ok || !res.body) {
    const detail = await safeText(res);
    throw new Error(`${p.config.id} request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }

  for await (const data of sseData(res)) {
    if (data === '[DONE]') return;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      continue; // ignore keep-alives / non-JSON lines
    }
    const text = p.config.format === 'anthropic' ? anthropicDelta(json) : openAiDelta(json);
    if (text) yield text;
  }
}

/** Convenience: collect a full completion into one string. */
export async function chatOnce(p: StreamChatParams): Promise<string> {
  let out = '';
  for await (const delta of streamChat(p)) out += delta;
  return out;
}

// --- OpenAI-compatible ------------------------------------------------------

function postOpenAi(p: StreamChatParams): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  return p.fetchImpl(`${p.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({ model: p.model, messages: p.messages, stream: true }),
  });
}

function openAiDelta(json: unknown): string {
  const choice = (json as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.delta?.content;
  return typeof content === 'string' ? content : '';
}

// --- Anthropic --------------------------------------------------------------

function postAnthropic(p: StreamChatParams): Promise<Response> {
  // Anthropic takes `system` at the top level, not as a message role.
  const system = p.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = p.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (p.apiKey) headers['x-api-key'] = p.apiKey;
  return p.fetchImpl(`${p.config.baseUrl}/messages`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      max_tokens: p.maxTokens,
      ...(system ? { system } : {}),
      messages,
      stream: true,
    }),
  });
}

function anthropicDelta(json: unknown): string {
  const evt = json as { type?: string; delta?: { type?: string; text?: unknown } };
  if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && typeof evt.delta.text === 'string') {
    return evt.delta.text;
  }
  return '';
}

// --- SSE plumbing -----------------------------------------------------------

/** Yield each `data:` payload from an SSE response body (format-agnostic). */
async function* sseData(res: Response): AsyncIterable<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (line.startsWith('data:')) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}
