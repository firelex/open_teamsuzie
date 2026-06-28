import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { ACTIVITY_MIGRATIONS } from '../migrations.js';
import { ActivityStore } from '../store.js';

let db: DatabaseInstance;
let store: ActivityStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: ACTIVITY_MIGRATIONS });
    nextId = 0;
    nextTime = 1700000000000;
    store = new ActivityStore({
        db,
        idFactory: () => `a${++nextId}`,
        now: () => ++nextTime,
    });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates activity_entries with the expected columns', () => {
        const cols = db
            .prepare<[], { name: string }>(`PRAGMA table_info('activity_entries')`)
            .all()
            .map((r) => r.name)
            .sort();
        expect(cols).toEqual(
            [
                'id',
                'org_id',
                'subject_type',
                'subject_id',
                'actor_id',
                'actor_type',
                'kind',
                'summary',
                'body',
                'metadata',
                'at',
            ].sort(),
        );
    });
});

describe('append + get', () => {
    it('persists all fields including actor and metadata', () => {
        const entry = store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'r-1' },
            kind: 'comment.added',
            summary: 'Alice left a comment',
            body: 'Looks good to me',
            actor: { id: 'alice@x', type: 'user' },
            metadata: { mentions: ['bob@x'] },
        });
        expect(entry.id).toBe('a1');
        expect(entry.kind).toBe('comment.added');
        expect(entry.body).toBe('Looks good to me');
        expect(entry.actorId).toBe('alice@x');
        expect(entry.actorType).toBe('user');
        expect(entry.metadata).toEqual({ mentions: ['bob@x'] });
        expect(store.get(entry.id)).toEqual(entry);
    });

    it('allows a null actor and empty metadata', () => {
        const entry = store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'r-1' },
            kind: 'system.created',
            summary: 'Record created',
        });
        expect(entry.actorId).toBeNull();
        expect(entry.actorType).toBeNull();
        expect(entry.metadata).toEqual({});
        expect(entry.body).toBeNull();
    });

    it('respects explicit `at` timestamps for backfill', () => {
        const entry = store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'r-1' },
            kind: 'imported',
            summary: 'Backfilled',
            at: 1234,
        });
        expect(entry.at).toBe(1234);
    });

    it('tolerates corrupt metadata JSON by surfacing empty object', () => {
        const entry = store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'r-1' },
            kind: 'k',
            summary: 's',
        });
        db.prepare(`UPDATE activity_entries SET metadata = 'broken' WHERE id = ?`).run(
            entry.id,
        );
        expect(store.get(entry.id)?.metadata).toEqual({});
    });
});

describe('listBySubject', () => {
    function seed() {
        const subject = { type: 'record', id: 'r-1' };
        const other = { type: 'record', id: 'r-2' };
        store.append({
            orgId: 'org-1',
            subject,
            kind: 'created',
            summary: 'one',
        });
        store.append({
            orgId: 'org-1',
            subject,
            kind: 'comment.added',
            summary: 'two',
        });
        store.append({
            orgId: 'org-1',
            subject,
            kind: 'stage.moved',
            summary: 'three',
        });
        store.append({
            orgId: 'org-1',
            subject: other,
            kind: 'created',
            summary: 'other',
        });
        store.append({
            orgId: 'org-2',
            subject,
            kind: 'created',
            summary: 'other-org',
        });
        return { subject, other };
    }

    it('returns subject-scoped entries newest first', () => {
        const { subject } = seed();
        const list = store.listBySubject({ orgId: 'org-1', subject });
        expect(list.map((e) => e.summary)).toEqual(['three', 'two', 'one']);
    });

    it('isolates by org and subject', () => {
        const { subject } = seed();
        // Other org's entries don't leak.
        expect(
            store
                .listBySubject({ orgId: 'org-1', subject })
                .every((e) => e.orgId === 'org-1'),
        ).toBe(true);
    });

    it('filters by kinds', () => {
        const { subject } = seed();
        const list = store.listBySubject({
            orgId: 'org-1',
            subject,
            kinds: ['comment.added', 'stage.moved'],
        });
        expect(list.map((e) => e.summary).sort()).toEqual(['three', 'two']);
    });

    it('paginates by `before` cursor', () => {
        const { subject } = seed();
        const all = store.listBySubject({ orgId: 'org-1', subject });
        const cursor = all[0].at;
        const next = store.listBySubject({
            orgId: 'org-1',
            subject,
            before: cursor,
        });
        expect(next.map((e) => e.summary)).toEqual(['two', 'one']);
    });

    it('respects limit', () => {
        const { subject } = seed();
        const list = store.listBySubject({ orgId: 'org-1', subject, limit: 2 });
        expect(list).toHaveLength(2);
    });

    it('countBySubject matches', () => {
        const { subject } = seed();
        expect(store.countBySubject('org-1', subject)).toBe(3);
    });
});

describe('listByOrg', () => {
    it('returns all org entries newest first across subjects', () => {
        store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'a' },
            kind: 'k',
            summary: 'first',
        });
        store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'b' },
            kind: 'k',
            summary: 'second',
        });
        const list = store.listByOrg({ orgId: 'org-1' });
        expect(list.map((e) => e.summary)).toEqual(['second', 'first']);
    });
});

describe('removeForSubject', () => {
    it('deletes all entries for a (org, subject) and returns the count', () => {
        const subject = { type: 'record', id: 'r-1' };
        store.append({ orgId: 'org-1', subject, kind: 'k', summary: 'x' });
        store.append({ orgId: 'org-1', subject, kind: 'k', summary: 'y' });
        store.append({
            orgId: 'org-1',
            subject: { type: 'record', id: 'r-2' },
            kind: 'k',
            summary: 'untouched',
        });
        expect(store.removeForSubject('org-1', subject)).toBe(2);
        expect(store.countBySubject('org-1', subject)).toBe(0);
        expect(
            store.countBySubject('org-1', { type: 'record', id: 'r-2' }),
        ).toBe(1);
    });
});
