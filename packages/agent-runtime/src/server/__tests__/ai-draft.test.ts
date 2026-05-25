import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAiDraftRouter, createCoreAiDraftKinds } from '../ai-draft.js';

describe('POST /api/ai/draft', () => {
  it('returns 503 when no model is configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: undefined,
      kinds: createCoreAiDraftKinds(),
      runTurn: async () => { throw new Error('should not be called'); },
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'prompt-body',
      context: { title: 'foo' },
    });
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/no model configured/i);
  });

  it('routes prompt-body via the simple model and returns the text', async () => {
    let capturedSystem = '';
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: { baseUrl: 'http://localhost', apiKey: 'x', model: 'm' },
      kinds: createCoreAiDraftKinds(),
      runTurn: async ({ messages }) => {
        capturedSystem = (messages.find(m => m.role === 'system') as any)?.content ?? '';
        return { text: 'drafted body' };
      },
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'prompt-body',
      context: { title: 'Summarize a contract', description: 'one-liner' },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.text).toBe('drafted body');
    expect(capturedSystem).toMatch(/Summarize a contract/);
  });

  it('rejects an unknown kind', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: { baseUrl: 'http://localhost', apiKey: 'x', model: 'm' },
      kinds: createCoreAiDraftKinds(),
      runTurn: async () => ({ text: '' }),
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'no-such-kind', context: {},
    });
    expect(res.status).toBe(400);
  });

  it('review-column-prompt instructs the LLM to return JSON {prompt, format} with the format hint encoded', async () => {
    let capturedSystem = '';
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: { baseUrl: 'http://localhost', apiKey: 'x', model: 'm' },
      kinds: createCoreAiDraftKinds(),
      runTurn: async ({ messages }) => {
        capturedSystem = (messages.find(m => m.role === 'system') as any)?.content ?? '';
        // Mock a well-formed structured response — the client (use-review's
        // draftColumnPrompt helper) parses this into { prompt, format }.
        return { text: '{"prompt":"How long is the term?","format":"text"}' };
      },
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'review-column-prompt',
      context: { title: 'Term length', formatHint: 'short_text', formatLocked: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.text).toMatch(/"format":"text"/);
    // System prompt sanity: the title, hint, and lock flag all flowed
    // through so the LLM can honor them.
    expect(capturedSystem).toMatch(/Term length/);
    expect(capturedSystem).toMatch(/short_text/);
    expect(capturedSystem).toMatch(/suggestion/i);
  });

  it('review-column-prompt flags the format hint as binding when formatLocked', async () => {
    let capturedSystem = '';
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: { baseUrl: 'http://localhost', apiKey: 'x', model: 'm' },
      kinds: createCoreAiDraftKinds(),
      runTurn: async ({ messages }) => {
        capturedSystem = (messages.find(m => m.role === 'system') as any)?.content ?? '';
        return { text: '{}' };
      },
    }));
    await request(app).post('/api/ai/draft').send({
      kind: 'review-column-prompt',
      context: { title: 't', formatHint: 'date', formatLocked: true },
    });
    expect(capturedSystem).toMatch(/binding/i);
  });

  it('uses an extension-registered kind', async () => {
    const kinds = createCoreAiDraftKinds();
    kinds.register(
      'my-extension-kind',
      { systemPromptFor: (c: any) => `Custom: ${c.q}` },
      { source: 'extension', extensionName: 'demo' },
    );
    let capturedSystem = '';
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: { baseUrl: 'http://x', apiKey: 'k', model: 'm' },
      kinds,
      runTurn: async ({ messages }) => {
        capturedSystem = (messages.find(m => m.role === 'system') as any)?.content ?? '';
        return { text: 'ok' };
      },
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'my-extension-kind',
      context: { q: 'hello' },
    });
    expect(res.status).toBe(200);
    expect(capturedSystem).toMatch(/Custom: hello/);
    expect(kinds.metaFor('my-extension-kind')).toEqual({
      source: 'extension',
      extensionName: 'demo',
    });
  });
});
