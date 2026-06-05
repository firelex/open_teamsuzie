import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { EVENTS_MIGRATIONS } from '../migrations.js';
import { EventsStore } from '../store.js';

let db: DatabaseInstance;
let store: EventsStore;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: EVENTS_MIGRATIONS });
    store = new EventsStore({ db });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates the events table with the expected indexes', () => {
        const tables = db
            .prepare<[], { name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
            )
            .all()
            .map((r) => r.name);
        expect(tables).toContain('events');

        const indexes = db
            .prepare<[], { name: string }>(
                `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='events' AND name NOT LIKE 'sqlite_%'`,
            )
            .all()
            .map((r) => r.name);
        expect(indexes).toEqual(expect.arrayContaining([
            'idx_events_subject_id',
            'idx_events_subject_kind',
            'idx_events_chat_id',
            'idx_events_correlation',
        ]));
    });
});

describe('EventsStore.append', () => {
    it('persists the event with an auto id and a generated ts', () => {
        const e = store.append({
            subjectId: 'p1',
            chatId: 'c1',
            source: 'system',
            kind: 'status',
            payload: { status: 'running' },
        });
        expect(e.id).toBeGreaterThan(0);
        expect(e.ts).toBeTruthy();
        expect(e.subjectId).toBe('p1');
        expect(e.chatId).toBe('c1');
        expect(e.source).toBe('system');
        expect(e.payload).toEqual({ status: 'running' });
        expect(e.correlationId).toBeNull();
    });

    it('accepts a chat-less event', () => {
        const e = store.append({ subjectId: 'p1', source: 'system', kind: 'boot', payload: {} });
        expect(e.chatId).toBeNull();
    });

    it('accepts any string for source — no CHECK constraint', () => {
        const e = store.append({
            subjectId: 'p1',
            source: 'executive_assistant',
            kind: 'note',
            payload: {},
        });
        expect(e.source).toBe('executive_assistant');
    });

    it('stores a correlation id when provided', () => {
        const e = store.append({
            subjectId: 'p1',
            chatId: 'c1',
            source: 'agent',
            kind: 'tool_call',
            payload: { name: 'do_thing' },
            correlationId: 'turn-1',
        });
        expect(e.correlationId).toBe('turn-1');
    });
});

describe('EventsStore reads', () => {
    function seed(): void {
        store.append({ subjectId: 'p1', chatId: 'c1', source: 'system', kind: 'status', payload: { status: 'running' } });
        store.append({ subjectId: 'p1', chatId: 'c1', source: 'agent', kind: 'message', payload: { text: 'hi' }, correlationId: 'turn-1' });
        store.append({ subjectId: 'p1', chatId: 'c1', source: 'agent', kind: 'tool_call', payload: { name: 'x' }, correlationId: 'turn-1' });
        store.append({ subjectId: 'p1', chatId: 'c2', source: 'user', kind: 'message', payload: { text: 'other chat' } });
        store.append({ subjectId: 'p2', chatId: 'c3', source: 'system', kind: 'status', payload: {} });
    }

    it('listByChat returns events for one chat in chronological order', () => {
        seed();
        const xs = store.listByChat('c1');
        expect(xs.map((e) => e.kind)).toEqual(['status', 'message', 'tool_call']);
    });

    it('listByChat respects the limit and takes the tail', () => {
        for (let i = 0; i < 10; i++) {
            store.append({ subjectId: 'p1', chatId: 'c1', source: 'system', kind: 'tick', payload: { i } });
        }
        const xs = store.listByChat('c1', 3);
        expect(xs.map((e) => (e.payload as { i: number }).i)).toEqual([7, 8, 9]);
    });

    it('listSinceForChat returns only events newer than sinceId', () => {
        seed();
        const first = store.listByChat('c1')[0];
        const xs = store.listSinceForChat('c1', first.id);
        expect(xs).toHaveLength(2);
        expect(xs[0].kind).toBe('message');
    });

    it('listByKindsForChat filters by kind list', () => {
        seed();
        const xs = store.listByKindsForChat('c1', ['status', 'tool_call']);
        expect(xs.map((e) => e.kind)).toEqual(['status', 'tool_call']);
    });

    it('listByKindsForChat with an empty kinds list returns []', () => {
        seed();
        expect(store.listByKindsForChat('c1', [])).toEqual([]);
    });

    it('listBySubject returns events across all chats for a subject', () => {
        seed();
        const xs = store.listBySubject('p1');
        expect(xs).toHaveLength(4);
        expect(xs.every((e) => e.subjectId === 'p1')).toBe(true);
    });

    it('listByCorrelation returns events sharing a correlation id', () => {
        seed();
        const xs = store.listByCorrelation('turn-1');
        expect(xs.map((e) => e.kind)).toEqual(['message', 'tool_call']);
    });
});

describe('EventsStore.clear', () => {
    it('clearForChat removes only that chat', () => {
        store.append({ subjectId: 'p1', chatId: 'c1', source: 'system', kind: 'a', payload: {} });
        store.append({ subjectId: 'p1', chatId: 'c2', source: 'system', kind: 'b', payload: {} });
        store.clearForChat('c1');
        expect(store.listByChat('c1')).toHaveLength(0);
        expect(store.listByChat('c2')).toHaveLength(1);
    });

    it('clearForSubject removes every event for a subject across chats', () => {
        store.append({ subjectId: 'p1', chatId: 'c1', source: 'system', kind: 'a', payload: {} });
        store.append({ subjectId: 'p1', chatId: 'c2', source: 'system', kind: 'b', payload: {} });
        store.append({ subjectId: 'p2', chatId: 'c3', source: 'system', kind: 'c', payload: {} });
        store.clearForSubject('p1');
        expect(store.listBySubject('p1')).toHaveLength(0);
        expect(store.listBySubject('p2')).toHaveLength(1);
    });
});
