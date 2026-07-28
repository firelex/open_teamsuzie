import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import { modelsRouter } from './router.js';
import type { ModelGateway } from './gateway.js';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function listen(gateway: Partial<ModelGateway>): Promise<string> {
  const app = express();
  app.use(express.json());
  app.use('/api/models', modelsRouter(gateway as ModelGateway));
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = (server!.address() as AddressInfo).port;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

describe('modelsRouter', () => {
  it('GET / returns configured + setup + models', async () => {
    const base = await listen({
      isConfigured: () => true,
      describeSetup: () => 'Model gateway ready.',
      listModels: async () => [
        { id: 'openai/gpt', provider: 'openai', model: 'gpt', label: 'GPT', deployment: 'hosted', available: true },
      ],
      getDefaultModelId: async () => 'openai/gpt',
    });
    const body = await (await fetch(`${base}/api/models`)).json();
    expect(body.configured).toBe(true);
    expect(body.setup).toBe('Model gateway ready.');
    expect(body.models[0].id).toBe('openai/gpt');
    expect(body.defaultModelId).toBe('openai/gpt');
  });

  it('POST /chat streams SSE text deltas then a done event', async () => {
    const base = await listen({
      stream: async function* () {
        yield 'Hel';
        yield 'lo';
      },
    });
    const res = await fetch(`${base}/api/models/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'openai/gpt', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('data: {"text":"Hel"}');
    expect(text).toContain('data: {"text":"lo"}');
    expect(text).toContain('data: {"done":true}');
  });

  it('POST /chat emits a visible error event when the gateway throws', async () => {
    const base = await listen({
      // eslint-disable-next-line require-yield
      stream: async function* () {
        throw new Error('No OPENAI_API_KEY configured');
      },
    });
    const res = await fetch(`${base}/api/models/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'openai/gpt', messages: [{ role: 'user', content: 'hi' }] }),
    });
    const text = await res.text();
    expect(text).toContain('"error":"No OPENAI_API_KEY configured"');
  });

  it('POST /chat is a 400 without an id or messages', async () => {
    const base = await listen({ stream: async function* () {} });
    const res = await fetch(`${base}/api/models/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
