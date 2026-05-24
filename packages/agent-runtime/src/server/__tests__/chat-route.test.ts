import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ApprovalQueue } from '@teamsuzie/approvals';
import type { ChatsStore } from '@teamsuzie/chats';
import { PersonaRegistry } from '@teamsuzie/personas';
import { createChatRouter } from '../chat-route.js';

function noopChats(): ChatsStore {
  // Minimal stub: only the methods the router calls are implemented.
  return {
    getChat: () => null,
    appendMessage: () => ({ id: 'm', chatId: 'c', role: 'user', content: '', createdAt: 0 }),
    updateChat: () => null,
  } as unknown as ChatsStore;
}

function fakeRunChatTurn(events: Array<{ type: string; [k: string]: unknown }>) {
  return async function* mock(_opts: unknown): AsyncGenerator<any> {
    for (const ev of events) yield ev as any;
  };
}

describe('POST /api/chat', () => {
  const baseDeps = {
    agent: { baseUrl: 'http://upstream', apiKey: 'k', model: 'default-model' },
    chats: noopChats(),
    personaRegistry: new PersonaRegistry({}),
    ownerId: 'owner',
    workspaceId: 'assistant:default',
    toolCtx: { approvals: {} as ApprovalQueue, vectorDbBaseUrl: '' },
  };

  it('rejects an empty message with 400', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: fakeRunChatTurn([]),
    }));
    const res = await request(app).post('/api/chat').send({});
    expect(res.status).toBe(400);
  });

  it('streams SSE chunks back', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: fakeRunChatTurn([
        { type: 'chunk', text: 'hello' },
        { type: 'chunk', text: ' world' },
        { type: 'done' },
      ]),
    }));
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'hi' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.text).toContain('data: {"type":"chunk","text":"hello"}');
    expect(res.text).toContain('data: {"type":"chunk","text":" world"}');
    expect(res.text).toContain('data: {"type":"done"}');
  });

  it('per-request body.model overrides agent.model', async () => {
    let observedModel = '';
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: async function* mock(opts) {
        observedModel = opts.agent.model;
        yield { type: 'done' };
      },
    }));
    await request(app)
      .post('/api/chat')
      .send({ message: 'hi', model: 'picked-model' });
    expect(observedModel).toBe('picked-model');
  });

  it('falls back to agent.model when no model in body', async () => {
    let observedModel = '';
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: async function* mock(opts) {
        observedModel = opts.agent.model;
        yield { type: 'done' };
      },
    }));
    await request(app)
      .post('/api/chat')
      .send({ message: 'hi' });
    expect(observedModel).toBe('default-model');
  });

  it('returns 404 for an unknown chatId', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: fakeRunChatTurn([{ type: 'done' }]),
    }));
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'hi', chatId: 'does-not-exist' });
    expect(res.status).toBe(404);
  });

  it('prepends [Attachments] block when attachmentIds resolve to files', async () => {
    const { InMemoryFileStore } = await import('../files-route.js');
    const fileStore = new InMemoryFileStore();
    fileStore.put({
      id: 'f1', sessionId: 's1', name: 'nda.txt', mimeType: 'text/plain',
      size: 12, bytes: Buffer.from('Term: 2 years'), createdAt: 0,
    });
    let observedContent = '';
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      fileStore,
      runChatTurn: async function* mock(opts) {
        observedContent = String(opts.messages[opts.messages.length - 1].content ?? '');
        yield { type: 'done' };
      },
    }));
    await request(app).post('/api/chat').send({
      message: 'What is the term?',
      sessionId: 's1',
      attachmentIds: ['f1'],
    });
    expect(observedContent).toContain('[Attachments]');
    expect(observedContent).toContain('Term: 2 years');
    expect(observedContent).toContain('[Message]');
    expect(observedContent).toContain('What is the term?');
  });

  it('ignores attachmentIds when fileStore is not configured', async () => {
    let observedContent = '';
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: async function* mock(opts) {
        observedContent = String(opts.messages[opts.messages.length - 1].content ?? '');
        yield { type: 'done' };
      },
    }));
    await request(app).post('/api/chat').send({
      message: 'hi',
      sessionId: 's1',
      attachmentIds: ['f1'],
    });
    expect(observedContent).toBe('hi');
  });

  it('forwards error events on runChatTurn throw', async () => {
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: async function* mock(): AsyncGenerator<any> {
        throw new Error('upstream blew up');
      },
    }));
    const res = await request(app)
      .post('/api/chat')
      .send({ message: 'hi' });
    expect(res.text).toContain('"type":"error"');
    expect(res.text).toContain('upstream blew up');
  });
});
