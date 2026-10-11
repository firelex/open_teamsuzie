import { describe, it, expect } from 'vitest';

import { ModelGateway } from './gateway.js';

/** Build an SSE response body from JSON payload lines. */
function sse(lines: string[]): Response {
  return new Response(lines.map((l) => `data: ${l}\n\n`).join(''), { status: 200 });
}

const notCalled = (async () => {
  throw new Error('fetch should not be called');
}) as unknown as typeof fetch;

describe('ModelGateway — availability', () => {
  it('availableProviders reflects which keys are present, with a reason when absent', () => {
    const g = new ModelGateway({ env: { ANTHROPIC_API_KEY: 'x' }, fetchImpl: notCalled });
    const a = g.availableProviders();
    expect(a.find((p) => p.provider === 'anthropic')?.available).toBe(true);
    const openai = a.find((p) => p.provider === 'openai');
    expect(openai?.available).toBe(false);
    expect(openai?.reason).toContain('OPENAI_API_KEY');
  });

  it('isConfigured is false with no keys, true with any key', () => {
    expect(new ModelGateway({ env: {}, fetchImpl: notCalled }).isConfigured()).toBe(false);
    expect(new ModelGateway({ env: { OPENAI_API_KEY: 'k' }, fetchImpl: notCalled }).isConfigured()).toBe(true);
  });

  it('describeSetup names the missing keys when unconfigured', () => {
    const g = new ModelGateway({ env: {}, fetchImpl: notCalled });
    expect(g.describeSetup()).toMatch(/ANTHROPIC_API_KEY/);
    expect(g.describeSetup()).toMatch(/no provider API keys/i);
  });
});

describe('ModelGateway — listModels', () => {
  it('marks curated hosted models available per key and honors env model override', async () => {
    const g = new ModelGateway({
      env: { ANTHROPIC_API_KEY: 'k', MODELS_OPENAI_MODEL: 'gpt-x' },
      fetchImpl: notCalled,
    });
    const models = await g.listModels();
    const anth = models.find((m) => m.provider === 'anthropic')!;
    expect(anth.available).toBe(true);
    expect(anth.id).toBe('anthropic/claude-sonnet-5');
    const oai = models.find((m) => m.provider === 'openai')!;
    expect(oai.available).toBe(false);
    expect(oai.model).toBe('gpt-x'); // env override respected
    expect(oai.reason).toContain('OPENAI_API_KEY');
  });

  it('includes reachable local runtimes as available openai-compatible models', async () => {
    const g = new ModelGateway({
      env: {},
      fetchImpl: notCalled,
      listLocalRuntimes: () => [
        { id: 'lm', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: ['llama-3'] },
      ],
    });
    const local = (await g.listModels()).find((m) => m.deployment === 'local')!;
    expect(local.id).toBe('openai-compatible/lm:llama-3');
    expect(local.available).toBe(true);
  });
});

describe('ModelGateway — chat', () => {
  it('streams OpenAI-compatible deltas into a full string, hitting the right URL + bearer auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return sse([
        '{"choices":[{"delta":{"content":"Hel"}}]}',
        '{"choices":[{"delta":{"content":"lo"}}]}',
        '[DONE]',
      ]);
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { OPENAI_API_KEY: 'sekret' }, fetchImpl });
    const res = await g.chat({ id: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('Hello');
    expect(res.provider).toBe('openai');
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer sekret');
  });

  it('maps the Anthropic Messages API (system top-level, x-api-key, text_delta events)', async () => {
    let captured!: { url: string; init: RequestInit };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      captured = { url: String(url), init };
      return sse([
        '{"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        '{"type":"message_stop"}',
      ]);
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { ANTHROPIC_API_KEY: 'ak' }, fetchImpl });
    const res = await g.chat({
      id: 'anthropic/claude-sonnet-5',
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hi' },
      ],
    });
    expect(res.text).toBe('Hi');
    expect(captured.url).toBe('https://api.anthropic.com/v1/messages');
    expect((captured.init.headers as Record<string, string>)['x-api-key']).toBe('ak');
    const body = JSON.parse(captured.init.body as string);
    expect(body.system).toBe('be terse');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('sends enable_thinking:false and a JSON reply format to Qwen when asked', async () => {
    let body!: Record<string, unknown>;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return sse(['{"choices":[{"delta":{"content":"{}"}}]}', '[DONE]']);
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl });
    await g.chat({ id: 'qwen/qwen3.8-max', messages: [{ role: 'user', content: 'hi' }], thinking: false, json: true });
    expect(body.enable_thinking).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('refuses thinking:false for OpenAI and json:true for Anthropic', async () => {
    const g = new ModelGateway({ env: { OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'a' }, fetchImpl: notCalled });
    const messages = [{ role: 'user' as const, content: 'hi' }];
    await expect(g.chat({ id: 'openai/gpt-5.5', messages, thinking: false })).rejects.toThrow(/cannot turn thinking off/);
    await expect(g.chat({ id: 'anthropic/claude-sonnet-5', messages, json: true })).rejects.toThrow(/no JSON reply mode/);
  });

  it('refuses a provider with no key, naming the env var', async () => {
    const g = new ModelGateway({ env: {}, fetchImpl: notCalled });
    await expect(
      g.chat({ id: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('surfaces a provider HTTP error (status + provider)', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { OPENAI_API_KEY: 'k' }, fetchImpl });
    await expect(
      g.chat({ id: 'openai/gpt-5.5', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow(/openai request failed \(429\)/);
  });

  it('getDefaultModelId returns the persisted default when available, else the first available', async () => {
    let stored: string | null = null;
    const store = { get: () => stored, set: (id: string) => { stored = id; } };
    const g = new ModelGateway({ env: { ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k' }, fetchImpl: notCalled, defaultModelStore: store });
    // No stored default → first available (anthropic curated is first).
    expect(await g.getDefaultModelId()).toBe('anthropic/claude-sonnet-5');
    // Set + read back.
    await g.setDefaultModelId('openai/gpt-5.5');
    expect(stored).toBe('openai/gpt-5.5');
    expect(await g.getDefaultModelId()).toBe('openai/gpt-5.5');
  });

  it('setDefaultModelId rejects a model that is not available (no key)', async () => {
    const g = new ModelGateway({ env: { ANTHROPIC_API_KEY: 'k' }, fetchImpl: notCalled });
    await expect(g.setDefaultModelId('openai/gpt-5.5')).rejects.toThrow(/not available/);
  });

  it('getDefaultModelId is null and chatDefault throws when nothing is configured', async () => {
    const g = new ModelGateway({ env: {}, fetchImpl: notCalled });
    expect(await g.getDefaultModelId()).toBeNull();
    await expect(g.chatDefault([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no provider API keys/i);
  });

  it('routes a local runtime by its injected base URL', async () => {
    let url = '';
    const fetchImpl = (async (u: string) => {
      url = String(u);
      return sse(['{"choices":[{"delta":{"content":"ok"}}]}', '[DONE]']);
    }) as unknown as typeof fetch;
    const g = new ModelGateway({
      env: {},
      fetchImpl,
      listLocalRuntimes: () => [
        { id: 'lm', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', models: ['llama-3'] },
      ],
    });
    const res = await g.chat({
      id: 'openai-compatible/lm:llama-3',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(res.text).toBe('ok');
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
  });
});

describe('ModelGateway — chatTools', () => {
  const completion = (message: Record<string, unknown>, finish = 'tool_calls') =>
    new Response(JSON.stringify({ choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 120, completion_tokens: 30 } }), { status: 200, headers: { 'content-type': 'application/json' } });

  it('sends tools and tool messages in OpenAI format and returns tool calls with usage', async () => {
    let body!: Record<string, any>;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return completion({ content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_clause', arguments: '{"heading":"Term"}' } }] });
    }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl });
    const res = await g.chatTools({
      id: 'qwen/qwen3.8-max',
      thinking: false,
      tools: [{ name: 'add_clause', description: 'Add a clause', parameters: { type: 'object', properties: { heading: { type: 'string' } } } }],
      messages: [
        { role: 'system', content: 'draft' },
        { role: 'user', content: 'go' },
        { role: 'assistant', content: null, toolCalls: [{ id: 'call_0', name: 'outline', arguments: '{}' }] },
        { role: 'tool', toolCallId: 'call_0', content: 'The agreement is empty.' },
      ],
    });
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'add_clause', arguments: '{"heading":"Term"}' }]);
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(body.stream).toBe(false);
    expect(body.enable_thinking).toBe(false);
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: 'add_clause', description: 'Add a clause', parameters: { type: 'object', properties: { heading: { type: 'string' } } } } });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: null, tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'outline', arguments: '{}' } }] });
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'call_0', content: 'The agreement is empty.' });
  });

  it('sends an assistant turn without tool calls as plain content, never an empty tool_calls list', async () => {
    let body!: Record<string, any>;
    const fetchImpl = (async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); return completion({ content: 'ok' }, 'stop'); }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl });
    await g.chatTools({ id: 'qwen/x', tools: [], messages: [{ role: 'user', content: 'go' }, { role: 'assistant', content: null, toolCalls: [] }, { role: 'user', content: 'use the tools' }] });
    expect(body.messages[1]).toEqual({ role: 'assistant', content: '' });
  });

  it('omits tools when none are given and can ask for JSON', async () => {
    let body!: Record<string, any>;
    const fetchImpl = (async (_url: string, init: RequestInit) => { body = JSON.parse(init.body as string); return completion({ content: '{"a":1}' }, 'stop'); }) as unknown as typeof fetch;
    const g = new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl });
    const res = await g.chatTools({ id: 'qwen/qwen3.8-max', tools: [], json: true, messages: [{ role: 'user', content: 'hi' }] });
    expect(res.text).toBe('{"a":1}');
    expect(res.toolCalls).toEqual([]);
    expect(body.tools).toBeUndefined();
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('fails loudly on a cut-off reply, a missing usage report, an HTTP error, and Anthropic', async () => {
    const cut = (async () => completion({ content: 'half' }, 'length')) as unknown as typeof fetch;
    await expect(new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl: cut }).chatTools({ id: 'qwen/x', tools: [], messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/token limit/);
    const noUsage = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl: noUsage }).chatTools({ id: 'qwen/x', tools: [], messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/no token usage/);
    const http = (async () => new Response('busy', { status: 503 })) as unknown as typeof fetch;
    await expect(new ModelGateway({ env: { DASHSCOPE_API_KEY: 'q' }, fetchImpl: http }).chatTools({ id: 'qwen/x', tools: [], messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/503/);
    await expect(new ModelGateway({ env: { ANTHROPIC_API_KEY: 'a' }, fetchImpl: notCalled }).chatTools({ id: 'anthropic/claude-sonnet-5', tools: [], messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/tool calls/);
  });
});
