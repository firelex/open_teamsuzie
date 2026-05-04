import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { CHATS_MIGRATIONS } from '../migrations.js';
import { ChatsStore } from '../store.js';

let db: DatabaseInstance;
let store: ChatsStore;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: CHATS_MIGRATIONS });
    store = new ChatsStore({ db });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates the expected tables', () => {
        const tables = db
            .prepare<[], { name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
            )
            .all()
            .map((r) => r.name);
        expect(tables).toContain('chats');
        expect(tables).toContain('chat_messages');
    });
});

describe('Chat CRUD', () => {
    it('creates with default name and trimmed override', () => {
        const a = store.createChat({ workspaceId: 'm1' });
        expect(a.name).toBe('New chat');

        const b = store.createChat({ workspaceId: 'm1', name: '  Q&A on NDA  ' });
        expect(b.name).toBe('Q&A on NDA');
    });

    it('rename via updateChat', () => {
        const c = store.createChat({ workspaceId: 'm', name: 'old' });
        const updated = store.updateChat(c.id, { name: 'new' });
        expect(updated?.name).toBe('new');
    });

    it('lists chats by workspace, most recent first', () => {
        const tickedDb = openDb({ path: ':memory:', migrations: CHATS_MIGRATIONS });
        let t = 1700000000000;
        const ticked = new ChatsStore({ db: tickedDb, now: () => t });
        const a = ticked.createChat({ workspaceId: 'm', name: 'A' });
        t += 1000;
        const b = ticked.createChat({ workspaceId: 'm', name: 'B' });
        t += 1000;
        ticked.createChat({ workspaceId: 'other', name: 'C' });

        expect(ticked.listChats('m').map((c) => c.id)).toEqual([b.id, a.id]);
        tickedDb.close();
    });
});

describe('Message append + list', () => {
    it('appends user + assistant messages and lists them in order', () => {
        // Inject the clock so created_at is monotonic across appendMessage
        // calls — otherwise sub-millisecond ties make the ORDER BY ambiguous.
        const tickedDb = openDb({ path: ':memory:', migrations: CHATS_MIGRATIONS });
        let t = 1700000000000;
        const ticked = new ChatsStore({ db: tickedDb, now: () => t });
        const chat = ticked.createChat({ workspaceId: 'm', name: 't' });
        t += 100;
        ticked.appendMessage({
            chatId: chat.id,
            role: 'user',
            content: 'What is the governing law?',
        });
        t += 100;
        ticked.appendMessage({
            chatId: chat.id,
            role: 'assistant',
            content: 'Delaware [1].',
            citations: '[{"id":1,"doc":"d","quote":"governing law is Delaware"}]',
        });
        const msgs = ticked.listMessages(chat.id);
        expect(msgs).toHaveLength(2);
        expect(msgs[0]!.role).toBe('user');
        expect(msgs[1]!.role).toBe('assistant');
        expect(msgs[1]!.citations).toContain('Delaware');
        tickedDb.close();
    });

    it('appendMessage bumps the chat updated_at', () => {
        const tickedDb = openDb({ path: ':memory:', migrations: CHATS_MIGRATIONS });
        let t = 1700000000000;
        const ticked = new ChatsStore({ db: tickedDb, now: () => t });
        const chat = ticked.createChat({ workspaceId: 'm', name: 't' });
        const initialUpdated = chat.updatedAt;
        t += 5000;
        ticked.appendMessage({ chatId: chat.id, role: 'user', content: 'hi' });
        const after = ticked.getChat(chat.id);
        expect(after?.updatedAt).toBeGreaterThan(initialUpdated);
        tickedDb.close();
    });
});

describe('Cascades', () => {
    it('deleting a chat removes its messages', () => {
        const chat = store.createChat({ workspaceId: 'm', name: 't' });
        store.appendMessage({ chatId: chat.id, role: 'user', content: 'a' });
        store.appendMessage({ chatId: chat.id, role: 'assistant', content: 'b' });
        expect(store.listMessages(chat.id)).toHaveLength(2);

        expect(store.deleteChat(chat.id)).toBe(true);
        expect(store.getChat(chat.id)).toBeNull();
        expect(store.listMessages(chat.id)).toHaveLength(0);
    });

    it('clearMessages keeps the chat row but drops history', () => {
        const chat = store.createChat({ workspaceId: 'm', name: 't' });
        store.appendMessage({ chatId: chat.id, role: 'user', content: 'a' });
        const removed = store.clearMessages(chat.id);
        expect(removed).toBe(1);
        expect(store.getChat(chat.id)).not.toBeNull();
        expect(store.listMessages(chat.id)).toHaveLength(0);
    });
});

describe('id + clock injection', () => {
    it('uses injected idFactory and clock', () => {
        const fixedDb = openDb({ path: ':memory:', migrations: CHATS_MIGRATIONS });
        let counter = 0;
        const fixed = new ChatsStore({
            db: fixedDb,
            idFactory: () => `id-${++counter}`,
            now: () => 1700000000000,
        });
        const chat = fixed.createChat({ workspaceId: 'm', name: 'x' });
        expect(chat.id).toBe('id-1');
        expect(chat.createdAt).toBe(1700000000000);
        fixedDb.close();
    });
});
