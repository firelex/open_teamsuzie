import { toOpenAITools } from './tools/index.js';
import type { AnyToolDefinition, OpenAITool, ToolContext } from './tools/index.js';

export type ChatMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatMessageRole;
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
}

export interface AgentTarget {
  baseUrl: string;
  apiKey?: string;
  model: string;
  /**
   * Provider-specific request-body extensions merged into every chat request.
   * Useful for knobs that aren't part of the OpenAI-compatible core spec but
   * are accepted by some providers — e.g. Dashscope/Qwen's `enable_thinking`,
   * `temperature`, `top_p`, `parallel_tool_calls`, etc. Apps own the contract;
   * the agent loop just passes it through.
   */
  extraBody?: Record<string, unknown>;
}

type RawStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_calls'; calls: { id: string; name: string; arguments: string }[] }
  | { type: 'finish'; reason: string };

export type ChatStreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'tool_error'; id: string; name: string; error: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface RunChatTurnOptions {
  agent: AgentTarget;
  messages: ChatMessage[];
  tools: AnyToolDefinition[];
  toolCtx: ToolContext;
  /** Optional system prompt prepended to messages (e.g. installed-skill markdown). */
  systemPrompt?: string;
  maxIterations?: number;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export async function streamChatCompletion(
  agent: AgentTarget,
  messages: ChatMessage[],
  tools: OpenAITool[] = [],
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (agent.apiKey) headers.Authorization = `Bearer ${agent.apiKey}`;

  const body: Record<string, unknown> = {
    ...(agent.extraBody ?? {}),
    model: agent.model,
    messages,
    stream: true,
  };
  if (tools.length > 0) body.tools = tools;

  const response = await fetchImpl(`${agent.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(180_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Agent returned ${response.status}: ${text.slice(0, 200)}`);
  }
  if (!response.body) throw new Error('Agent returned no response body');

  return response.body.getReader();
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

export async function* readChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<RawStreamEvent, void, unknown> {
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = new Map<number, ToolCallAccumulator>();
  let finishReason = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
            finish_reason?: string;
          }>;
        };
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        if (choice.delta?.content) {
          yield { type: 'text', text: choice.delta.content };
        }

        if (Array.isArray(choice.delta?.tool_calls)) {
          for (const tc of choice.delta.tool_calls) {
            const idx = tc.index ?? 0;
            const existing = calls.get(idx) ?? { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name = tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            calls.set(idx, existing);
          }
        }

        if (choice.finish_reason) {
          finishReason = choice.finish_reason;
        }
      }
    }

    if (calls.size > 0) {
      const sorted = [...calls.entries()].sort(([a], [b]) => a - b).map(([, v]) => v);
      yield { type: 'tool_calls', calls: sorted };
    }
    if (finishReason) {
      yield { type: 'finish', reason: finishReason };
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* runChatTurn(opts: RunChatTurnOptions): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const { agent, tools, toolCtx, signal, systemPrompt } = opts;
  const fetchImpl = opts.fetchImpl ?? toolCtx.fetchImpl ?? fetch;
  const messages: ChatMessage[] = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...opts.messages]
    : [...opts.messages];
  const openaiTools = toOpenAITools(tools);
  const maxIterations = opts.maxIterations ?? 6;

  for (let iter = 0; iter < maxIterations; iter++) {
    const reader = await streamChatCompletion(agent, messages, openaiTools, fetchImpl, signal);
    let bufferedText = '';
    let pendingCalls: { id: string; name: string; arguments: string }[] = [];

    for await (const event of readChatStream(reader)) {
      if (event.type === 'text') {
        bufferedText += event.text;
        yield { type: 'chunk', text: event.text };
      } else if (event.type === 'tool_calls') {
        pendingCalls = event.calls;
      }
    }

    if (pendingCalls.length === 0) {
      yield { type: 'done' };
      return;
    }

    messages.push({
      role: 'assistant',
      content: bufferedText || null,
      tool_calls: pendingCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        function: { name: c.name, arguments: c.arguments },
      })),
    });

    for (const call of pendingCalls) {
      let parsedArgs: unknown = {};
      try {
        parsedArgs = call.arguments ? JSON.parse(call.arguments) : {};
      } catch {
        parsedArgs = {};
      }

      yield { type: 'tool_call', id: call.id, name: call.name, args: parsedArgs };

      const tool = tools.find((t) => t.name === call.name);
      let resultPayload: unknown;

      if (!tool) {
        const errorMessage = `Unknown tool: ${call.name}`;
        yield { type: 'tool_error', id: call.id, name: call.name, error: errorMessage };
        resultPayload = { error: errorMessage };
      } else {
        try {
          const result = await tool.execute(parsedArgs as Record<string, unknown>, toolCtx);
          yield { type: 'tool_result', id: call.id, name: call.name, result };
          resultPayload = result;
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Tool execution failed';
          yield { type: 'tool_error', id: call.id, name: call.name, error: errorMessage };
          resultPayload = { error: errorMessage };
        }
      }

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(resultPayload),
      });
    }
  }

  yield {
    type: 'error',
    message: `Tool-use loop hit the iteration cap (${maxIterations}). The agent may be stuck calling tools — review the conversation and consider tightening the system prompt.`,
  };
}
