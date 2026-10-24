import type { ChatMessage, ProviderId, ToolCall, ToolChatMessage, ToolDefinition } from './types.js';

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
  /** false turns thinking off; see ChatRequest.thinking. */
  thinking?: boolean;
  /** true asks for a JSON object reply; see ChatRequest.json. */
  json?: boolean;
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
  if (p.thinking === false && p.config.id === 'openai') {
    throw new Error('OpenAI models cannot turn thinking off; drop `thinking: false` or pick a Qwen or local model.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  return p.fetchImpl(`${p.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages,
      stream: true,
      ...(p.thinking === false ? { enable_thinking: false } : {}),
      ...(p.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
}

function openAiDelta(json: unknown): string {
  const choice = (json as { choices?: Array<{ delta?: { content?: unknown } }> }).choices?.[0];
  const content = choice?.delta?.content;
  return typeof content === 'string' ? content : '';
}

// --- Anthropic --------------------------------------------------------------

function postAnthropic(p: StreamChatParams): Promise<Response> {
  if (p.json) throw new Error('Anthropic has no JSON reply mode; ask for JSON in the prompt instead of passing `json: true`.');
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

// --- Tool calling (OpenAI format, non-streaming) -----------------------------

export interface ToolChatParams extends Omit<StreamChatParams, 'messages'> {
  messages: ToolChatMessage[];
  tools: ToolDefinition[];
}

function openAiMessage(m: ToolChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if ('toolCalls' in m) {
    // An assistant turn without calls goes as plain content: providers reject an empty tool_calls list or null content alone.
    if (!m.toolCalls.length) return { role: 'assistant', content: m.content ?? '' };
    return { role: 'assistant', content: m.content, tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })) };
  }
  return { role: m.role, content: m.content };
}

interface OpenAiCompletion {
  choices?: Array<{ finish_reason?: string; message?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/** One non-streaming turn with tools (OpenAI format only). Throws on a cut-off reply or a missing usage report. */
export async function chatWithTools(p: ToolChatParams): Promise<{ text: string; reasoning: string | null; toolCalls: ToolCall[]; usage: { inputTokens: number; outputTokens: number } }> {
  if (p.config.format !== 'openai') {
    throw new Error(`${p.config.id} does not support tool calls through this gateway; use an OpenAI-format provider (OpenAI, Qwen or a local runtime).`);
  }
  if (p.thinking === false && p.config.id === 'openai') {
    throw new Error('OpenAI models cannot turn thinking off; drop `thinking: false` or pick a Qwen or local model.');
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (p.apiKey) headers.authorization = `Bearer ${p.apiKey}`;
  const res = await p.fetchImpl(`${p.config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: p.signal,
    body: JSON.stringify({
      model: p.model,
      messages: p.messages.map(openAiMessage),
      max_tokens: p.maxTokens,
      stream: false,
      ...(p.tools.length ? { tools: p.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      ...(p.thinking === false ? { enable_thinking: false } : p.thinking === true ? { enable_thinking: true } : {}),
      ...(p.json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`${p.config.id} request failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const body = (await res.json()) as OpenAiCompletion;
  const choice = body.choices?.[0];
  if (!choice?.message) throw new Error(`${p.config.id} returned no message: ${JSON.stringify(body).slice(0, 300)}`);
  if (choice.finish_reason === 'length') throw new Error(`${p.config.id} stopped at the ${p.maxTokens}-token limit before finishing its reply`);
  if (!body.usage) throw new Error(`${p.config.id} reported no token usage`);
  return {
    text: choice.message.content ?? '',
    // Qwen and vLLM send a thinking model's reasoning as reasoning_content; some runtimes call it reasoning.
    reasoning: choice.message.reasoning_content ?? choice.message.reasoning ?? null,
    toolCalls: (choice.message.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, arguments: c.function.arguments })),
    usage: { inputTokens: body.usage.prompt_tokens, outputTokens: body.usage.completion_tokens },
  };
}
