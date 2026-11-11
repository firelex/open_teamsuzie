import { describe, expect, it } from 'vitest';
import { runChatTurn, type ChatStreamEvent } from '../chat-provider.js';
import type { AnyToolDefinition, ToolContext } from '../tools/index.js';

/** A model that emits one scripted tool call per turn, then a final answer. */
function scriptedModel(argsPerCall: string[]): typeof fetch {
  let n = 0;
  return (async () => {
    const i = n++;
    const events =
      i < argsPerCall.length
        ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: `call_${i}`, function: { name: 'echo', arguments: argsPerCall[i] } }] } }] }]
        : [{ choices: [{ delta: { content: 'done' } }] }];
    const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    return new Response(new ReadableStream({ start: (c) => { c.enqueue(new TextEncoder().encode(text)); c.close(); } }), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as typeof fetch;
}

async function run(argsPerCall: string[]) {
  const executed: unknown[] = [];
  const echo: AnyToolDefinition = {
    name: 'echo',
    description: 'echo',
    parameters: { type: 'object' },
    execute: async (args) => {
      executed.push(args);
      return { ok: true };
    },
  };
  const events: ChatStreamEvent[] = [];
  for await (const e of runChatTurn({
    agent: { name: 't', description: '', baseUrl: 'http://m', apiKey: undefined, model: 'm' },
    messages: [{ role: 'user', content: 'go' }],
    tools: [echo],
    toolCtx: {} as ToolContext,
    fetchImpl: scriptedModel(argsPerCall),
    maxIterations: 10,
  })) {
    events.push(e);
  }
  return { executed, events };
}

describe('runChatTurn tool guards', () => {
  it('runs an identical call twice, then answers the third with a nudge instead of running it', async () => {
    const { executed, events } = await run(['{"x":1}', '{"x":1}', '{"x":1}', '{"x":2}']);
    expect(executed).toEqual([{ x: 1 }, { x: 1 }, { x: 2 }]);
    const errors = events.filter((e) => e.type === 'tool_error');
    expect(errors).toHaveLength(1);
    expect((errors[0] as { error: string }).error).toMatch(/already called echo with exactly these arguments 2 times/);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('does not run a tool whose arguments are not valid JSON, and tells the model why', async () => {
    const { executed, events } = await run(['{"x": 1', '{"x":1}']);
    expect(executed).toEqual([{ x: 1 }]);
    const err = events.find((e) => e.type === 'tool_error') as { error: string };
    expect(err.error).toMatch(/not valid JSON/);
  });
});
