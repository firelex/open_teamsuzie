import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { ApprovalQueue } from '@teamsuzie/approvals';
import type { ChatsStore } from '@teamsuzie/chats';
import { PersonaRegistry } from '@teamsuzie/personas';
import { createChatRouter } from '../chat-route.js';
import { InMemoryFileStore } from '../files-route.js';

/**
 * Lock down the matter-bound chat tool wiring put in place during L1:
 * when AssistantPage sends `sessionId=matterId` to /api/chat for a
 * matter-bound chat, the chat-route must build per-turn tools with that
 * matterId and surface it on toolCtx — that's what makes the drafting
 * suite, propose_document_edits, compare_documents, etc. look up files
 * in the matter's bucket instead of the chat's session bucket.
 *
 * If a refactor ever changes how sessionId flows through chat-route,
 * this test catches it before matter-bound tool calls silently start
 * missing matter docs.
 */

function makeChatsStore(): ChatsStore {
    return {
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
        appendMessage: () => ({
            id: 'm',
            chatId: 'c',
            role: 'user' as const,
            content: '',
            createdAt: 0,
        }),
        updateChat: () => null,
    } as unknown as ChatsStore;
}

let fileStore: InMemoryFileStore;
beforeEach(() => {
    fileStore = new InMemoryFileStore();
    // Pre-seed the matter's file bucket with a doc.
    fileStore.put({
        id: 'matter-doc-1',
        sessionId: 'matter-42',
        name: 'memo.txt',
        mimeType: 'text/plain',
        size: 4,
        bytes: Buffer.from('memo'),
        createdAt: 0,
    });
});

afterEach(() => {
    // InMemoryFileStore has no disk side-effect to clean up.
});

describe('matter-bound chat → per-turn tools see the matter file bucket', () => {
    it('builds per-turn tools with sessionId=matterId and surfaces it on toolCtx', async () => {
        let observedSessionIdForTools = '';
        let observedToolCtxSessionId: string | undefined = undefined;

        const app = express();
        app.use(express.json());
        app.use(
            '/api/chat',
            createChatRouter({
                agent: {
                    baseUrl: 'http://upstream',
                    apiKey: 'k',
                    model: 'default-model',
                },
                chats: makeChatsStore(),
                personaRegistry: new PersonaRegistry({}),
                ownerId: 'owner',
                workspaceId: 'assistant:default',
                toolCtx: {
                    approvals: {} as ApprovalQueue,
                    vectorDbBaseUrl: '',
                },
                fileStore,
                buildPerTurnTools: (sessionId) => {
                    observedSessionIdForTools = sessionId;
                    return [];
                },
                runChatTurn: async function* mock(opts) {
                    observedToolCtxSessionId = opts.toolCtx.sessionId;
                    yield { type: 'done' };
                },
            }),
        );

        await request(app).post('/api/chat').send({
            message: 'use the doc',
            chatId: 'matter-chat-1',
            // AssistantPage in matter mode sends sessionId=matterId.
            sessionId: 'matter-42',
            workspaceId: 'matter-42',
        });

        // Per-turn tools must close over the matter id, so tools like
        // convert_to_markdown / propose_document_edits resolve files
        // under bucket=matter-42 rather than the chat session bucket.
        expect(observedSessionIdForTools).toBe('matter-42');
        // Tools that read sessionId from ctx (rather than per-turn closure)
        // get the same value — the chat-route plumbs it on both paths.
        expect(observedToolCtxSessionId).toBe('matter-42');
    });

    it('the matter file bucket is reachable through the chat-route file store with the same sessionId', () => {
        // Independent assertion: the file we seeded under bucket=matter-42
        // is reachable via fileStore.get(sessionId, fileId). Tools that
        // call into fileStore using ctx.sessionId or the per-turn closure
        // value land on this same lookup, so the routing is correct
        // end-to-end.
        const rec = fileStore.get('matter-42', 'matter-doc-1');
        expect(rec).toBeDefined();
        expect(rec!.name).toBe('memo.txt');
    });

    it('top-level Assistant chats keep using chatId as the bucket (regression for non-matter mode)', async () => {
        let observedSessionIdForTools = '';

        // Top-level chat row — workspaceId is the runtime default,
        // not a matter id.
        const chats = {
            getChat: () => ({
                id: 'top-chat-1',
                workspaceId: 'assistant:default',
                name: 'plain chat',
                createdAt: 0,
                updatedAt: 0,
                personaId: null,
            }),
            appendMessage: () => ({
                id: 'm',
                chatId: 'c',
                role: 'user' as const,
                content: '',
                createdAt: 0,
            }),
            updateChat: () => null,
        } as unknown as ChatsStore;

        const app = express();
        app.use(express.json());
        app.use(
            '/api/chat',
            createChatRouter({
                agent: {
                    baseUrl: 'http://upstream',
                    apiKey: 'k',
                    model: 'default-model',
                },
                chats,
                personaRegistry: new PersonaRegistry({}),
                ownerId: 'owner',
                workspaceId: 'assistant:default',
                toolCtx: {
                    approvals: {} as ApprovalQueue,
                    vectorDbBaseUrl: '',
                },
                buildPerTurnTools: (sessionId) => {
                    observedSessionIdForTools = sessionId;
                    return [];
                },
                runChatTurn: async function* mock() {
                    yield { type: 'done' };
                },
            }),
        );

        await request(app).post('/api/chat').send({
            message: 'hi',
            chatId: 'top-chat-1',
            // AssistantPage in non-matter mode sends sessionId=chatId.
            sessionId: 'top-chat-1',
        });

        expect(observedSessionIdForTools).toBe('top-chat-1');
    });
});
