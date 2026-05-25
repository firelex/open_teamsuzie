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

  it('matches a chat whose workspaceId is the body.workspaceId override, not the configured default', async () => {
    const chats = {
      ...noopChats(),
      getChat: (id: string) =>
        id === 'matter-chat-1'
          ? {
              id,
              workspaceId: 'matter-42',
              name: 'matter chat',
              createdAt: 0,
              updatedAt: 0,
              personaId: null,
            }
          : null,
    } as unknown as ChatsStore;
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      chats,
      runChatTurn: fakeRunChatTurn([{ type: 'done' }]),
    }));
    // Without the workspaceId override, the chat-route would 404 because
    // chat.workspaceId='matter-42' ≠ deps.workspaceId='assistant:default'.
    const res = await request(app).post('/api/chat').send({
      message: 'hi',
      chatId: 'matter-chat-1',
      workspaceId: 'matter-42',
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when body.workspaceId does not match the chat row workspace_id', async () => {
    const chats = {
      ...noopChats(),
      getChat: () => ({
        id: 'matter-chat-1',
        workspaceId: 'matter-42',
        name: 'm',
        createdAt: 0,
        updatedAt: 0,
        personaId: null,
      }),
    } as unknown as ChatsStore;
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      chats,
      runChatTurn: fakeRunChatTurn([{ type: 'done' }]),
    }));
    const res = await request(app).post('/api/chat').send({
      message: 'hi',
      chatId: 'matter-chat-1',
      workspaceId: 'matter-9-imposter',
    });
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

  it('includes previously-uploaded files in [Attachments] even when no attachmentIds in this turn', async () => {
    const { InMemoryFileStore } = await import('../files-route.js');
    const fileStore = new InMemoryFileStore();
    // File uploaded on a prior turn — still in the session, not
    // re-attached this turn.
    fileStore.put({
      id: 'old-doc', sessionId: 's1', name: 'nda.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      size: 5, bytes: Buffer.from('hello'), createdAt: 0,
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
    // No attachmentIds in this turn's body — but the model should
    // still see the previously-uploaded file_id.
    await request(app).post('/api/chat').send({
      message: 'now compare them',
      sessionId: 's1',
    });
    expect(observedContent).toContain('[Attachments]');
    expect(observedContent).toContain('file_id=old-doc');
    expect(observedContent).toContain('nda.docx');
  });

  it('inlines text body only for files newly attached this turn (not all session text files)', async () => {
    const { InMemoryFileStore } = await import('../files-route.js');
    const fileStore = new InMemoryFileStore();
    // Older text file: should NOT have its body re-inlined.
    fileStore.put({
      id: 'old-txt', sessionId: 's1', name: 'notes.txt',
      mimeType: 'text/plain', size: 9, bytes: Buffer.from('Old body!'), createdAt: 0,
    });
    // Newly attached text file: body inlined.
    fileStore.put({
      id: 'new-txt', sessionId: 's1', name: 'fresh.txt',
      mimeType: 'text/plain', size: 9, bytes: Buffer.from('Fresh one'), createdAt: 0,
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
      message: 'check the new one',
      sessionId: 's1',
      attachmentIds: ['new-txt'],
    });
    // Both file_ids appear as metadata.
    expect(observedContent).toContain('file_id=old-txt');
    expect(observedContent).toContain('file_id=new-txt');
    // Newly attached body is inlined; older body is not.
    expect(observedContent).toContain('Fresh one');
    expect(observedContent).not.toContain('Old body!');
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

  it('merges buildPerTurnTools output with the static tools list', async () => {
    let observedToolNames: string[] = [];
    const staticTool = {
      name: 'static_tool', description: 'x', parameters: { type: 'object' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async () => ({}),
    } as any;
    const perTurnTool = {
      name: 'per_turn_tool', description: 'y', parameters: { type: 'object' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async () => ({}),
    } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      tools: [staticTool],
      buildPerTurnTools: (sid) => sid === 'sess-1' ? [perTurnTool] : [],
      runChatTurn: async function* mock(opts) {
        observedToolNames = opts.tools.map((t) => t.name);
        yield { type: 'done' };
      },
    }));
    await request(app).post('/api/chat').send({ message: 'hi', sessionId: 'sess-1' });
    expect(observedToolNames).toEqual(expect.arrayContaining(['static_tool', 'per_turn_tool']));
  });

  it('per-turn tools override static tools with the same name', async () => {
    let observedTool: { description: string } | undefined;
    const staticTool = {
      name: 'shared', description: 'static-version', parameters: { type: 'object' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async () => ({}),
    } as any;
    const perTurnTool = {
      name: 'shared', description: 'per-turn-version', parameters: { type: 'object' },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async () => ({}),
    } as any;
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      tools: [staticTool],
      buildPerTurnTools: () => [perTurnTool],
      runChatTurn: async function* mock(opts) {
        observedTool = opts.tools.find((t) => t.name === 'shared');
        yield { type: 'done' };
      },
    }));
    await request(app).post('/api/chat').send({ message: 'hi', sessionId: 'sess-1' });
    expect(observedTool?.description).toBe('per-turn-version');
  });

  it('propagates body.sessionId onto toolCtx.sessionId', async () => {
    let observedSessionId: string | undefined = undefined;
    const app = express();
    app.use(express.json());
    app.use('/api/chat', createChatRouter({
      ...baseDeps,
      runChatTurn: async function* mock(opts) {
        observedSessionId = opts.toolCtx.sessionId;
        yield { type: 'done' };
      },
    }));
    await request(app)
      .post('/api/chat')
      .send({ message: 'hi', sessionId: 'sess-abc' });
    expect(observedSessionId).toBe('sess-abc');
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
