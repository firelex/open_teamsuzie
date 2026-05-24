import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAiDraftRouter } from '../ai-draft.js';

describe('POST /api/ai/draft', () => {
  it('returns 503 when no model is configured', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/ai/draft', createAiDraftRouter({
      simpleModel: undefined,
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
      runTurn: async () => ({ text: '' }),
    }));
    const res = await request(app).post('/api/ai/draft').send({
      kind: 'no-such-kind', context: {},
    });
    expect(res.status).toBe(400);
  });
});
