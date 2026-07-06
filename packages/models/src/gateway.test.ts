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
