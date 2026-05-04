import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { SHARING_MIGRATIONS } from '../migrations.js';
import { MembersStore } from '../store.js';
import type { OwnerLookup } from '../types.js';

let db: DatabaseInstance;
let store: MembersStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: SHARING_MIGRATIONS });
    nextId = 0;
    nextTime = 1700000000000;
    store = new MembersStore({
        db,
        idFactory: () => `m${++nextId}`,
        now: () => ++nextTime,
    });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates the members table with the right shape', () => {
        const cols = db
            .prepare<[], { name: string }>(`PRAGMA table_info('members')`)
            .all()
            .map((r) => r.name)
            .sort();
        expect(cols).toEqual(
            [
                'id',
                'subject_type',
                'subject_id',
                'user_id',
                'role',
                'granted_at',
                'granted_by',
            ].sort(),
        );
    });
});

describe('addMember', () => {
    it('inserts a new row with all fields populated', () => {
        const m = store.addMember({
            subjectType: 'matter',
            subjectId: 'matter-1',
            userId: 'alice@x',
            role: 'editor',
            grantedBy: 'owner@x',
        });
        expect(m.id).toBe('m1');
        expect(m.role).toBe('editor');
        expect(m.grantedBy).toBe('owner@x');
        expect(typeof m.grantedAt).toBe('number');
    });

    it('rejects an invalid role', () => {
        expect(() =>
            store.addMember({
                subjectType: 'matter',
                subjectId: 'm',
                userId: 'u',
                role: 'admin' as never,
            }),
        ).toThrow(/invalid role/);
    });

    it('upserts an existing (subject, user) row — id stable, role + granted_by refresh', () => {
        const a = store.addMember({
            subjectType: 'matter',
            subjectId: 'matter-1',
            userId: 'alice@x',
            role: 'viewer',
        });
        const b = store.addMember({
            subjectType: 'matter',
            subjectId: 'matter-1',
            userId: 'alice@x',
            role: 'editor',
            grantedBy: 'admin@x',
        });
        expect(b.id).toBe(a.id);
        expect(b.role).toBe('editor');
        expect(b.grantedBy).toBe('admin@x');
        expect(b.grantedAt).toBeGreaterThan(a.grantedAt);
    });
});

describe('removeMember / removeMembersFor', () => {
    it('removes a single member by (subject, user)', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'bob@x',
            role: 'viewer',
        });
        expect(
            store.removeMember('matter', 'm1', 'alice@x'),
        ).toBe(true);
        expect(
            store.listMembersFor({ type: 'matter', id: 'm1' }).map((m) => m.userId),
        ).toEqual(['bob@x']);
    });

    it('removeMember returns false when nothing matched', () => {
        expect(store.removeMember('matter', 'missing', 'alice@x')).toBe(false);
    });

    it('removeMembersFor cascades all rows for one subject', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'bob@x',
            role: 'viewer',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm2',
            userId: 'alice@x',
            role: 'owner',
        });
        const removed = store.removeMembersFor({ type: 'matter', id: 'm1' });
        expect(removed).toBe(2);
        expect(
            store.listMembersFor({ type: 'matter', id: 'm1' }),
        ).toEqual([]);
        expect(
            store.listMembersFor({ type: 'matter', id: 'm2' }),
        ).toHaveLength(1);
    });
});

describe('listMembersFor / listSubjectsFor', () => {
    it('lists members of a subject in grant-time order', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'a@x',
            role: 'owner',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'b@x',
            role: 'editor',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'c@x',
            role: 'viewer',
        });
        expect(
            store.listMembersFor({ type: 'matter', id: 'm1' }).map((m) => m.userId),
        ).toEqual(['a@x', 'b@x', 'c@x']);
    });

    it('isolates by subject_type — matter members do not leak to reviews', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'shared-id',
            userId: 'alice@x',
            role: 'editor',
        });
        store.addMember({
            subjectType: 'review',
            subjectId: 'shared-id',
            userId: 'bob@x',
            role: 'viewer',
        });
        const matterMembers = store.listMembersFor({
            type: 'matter',
            id: 'shared-id',
        });
        expect(matterMembers.map((m) => m.userId)).toEqual(['alice@x']);
    });

    it('listSubjectsFor returns the subjects of a given type a user has membership on', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm2',
            userId: 'alice@x',
            role: 'viewer',
        });
        store.addMember({
            subjectType: 'workflow',
            subjectId: 'wf1',
            userId: 'alice@x',
            role: 'editor',
        });
        const matters = store.listSubjectsFor('alice@x', 'matter');
        expect(matters.map((m) => m.subjectId).sort()).toEqual(['m1', 'm2']);
    });
});

describe('getRole', () => {
    it('returns the explicit role or null', () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        expect(
            store.getRole({ type: 'matter', id: 'm1' }, 'alice@x'),
        ).toBe('editor');
        expect(
            store.getRole({ type: 'matter', id: 'm1' }, 'bob@x'),
        ).toBeNull();
    });
});

describe('canAccess', () => {
    it('returns the explicit role when the user has a member row', async () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        expect(
            await store.canAccess({ type: 'matter', id: 'm1' }, 'alice@x'),
        ).toBe('editor');
    });

    it('returns owner via the lookup callback when no explicit row exists', async () => {
        const lookup: OwnerLookup = (s) =>
            s.id === 'm1' ? 'creator@x' : null;
        expect(
            await store.canAccess(
                { type: 'matter', id: 'm1' },
                'creator@x',
                lookup,
            ),
        ).toBe('owner');
    });

    it('prefers the stronger of explicit-row and implicit-owner', async () => {
        // alice has an editor row but is also the implicit owner — owner wins.
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'editor',
        });
        const lookup: OwnerLookup = () => 'alice@x';
        expect(
            await store.canAccess({ type: 'matter', id: 'm1' }, 'alice@x', lookup),
        ).toBe('owner');
    });

    it('returns null when the user has neither explicit nor implicit access', async () => {
        const lookup: OwnerLookup = () => 'someone-else@x';
        expect(
            await store.canAccess({ type: 'matter', id: 'm1' }, 'alice@x', lookup),
        ).toBeNull();
    });

    it('respects role-rank ordering (owner > editor > viewer)', async () => {
        store.addMember({
            subjectType: 'matter',
            subjectId: 'm1',
            userId: 'alice@x',
            role: 'viewer',
        });
        const lookup: OwnerLookup = () => 'alice@x';
        // Explicit viewer + implicit owner → owner is stronger.
        expect(
            await store.canAccess({ type: 'matter', id: 'm1' }, 'alice@x', lookup),
        ).toBe('owner');

        // No implicit owner (lookup returns someone else): explicit viewer is what they get.
        const noOwner: OwnerLookup = () => 'bob@x';
        expect(
            await store.canAccess(
                { type: 'matter', id: 'm1' },
                'alice@x',
                noOwner,
            ),
        ).toBe('viewer');
    });

    it('skips implicit-owner resolution when ownerLookup is null/undefined', async () => {
        // alice is the implicit owner per the host, but we don't pass the lookup.
        // canAccess returns null because there's no explicit member row.
        expect(
            await store.canAccess({ type: 'matter', id: 'm1' }, 'alice@x'),
        ).toBeNull();
        expect(
            await store.canAccess(
                { type: 'matter', id: 'm1' },
                'alice@x',
                null,
            ),
        ).toBeNull();
    });
});
