import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';

import {
    MATTERS_METADATA_MIGRATIONS,
    MatterMetadataStore,
} from '../metadata-store.js';

let db: DatabaseInstance;
let workspaces: WorkspacesStore;
let store: MatterMetadataStore;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [...WORKSPACES_MIGRATIONS, ...MATTERS_METADATA_MIGRATIONS],
    });
    workspaces = new WorkspacesStore({ db });
    store = new MatterMetadataStore({ db });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates matter_metadata with the expected columns', () => {
        const cols = db
            .prepare<[], { name: string }>(
                `SELECT name FROM pragma_table_info('matter_metadata')`,
            )
            .all()
            .map((r) => r.name)
            .sort();
        expect(cols).toEqual(
            [
                'created_at',
                'custom_fields_json',
                'matter_id',
                'type_id',
                'updated_at',
            ].sort(),
        );
    });
});

describe('MatterMetadataStore', () => {
    it('returns null for a matter with no metadata row', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        expect(store.get(m.id)).toBeNull();
    });

    it('upsert inserts on first call and returns the stored value', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        const meta = store.upsert({
            matterId: m.id,
            typeId: 'litigation',
            customFields: { jurisdiction: 'NY', amount: 100 },
        });
        expect(meta.matterId).toBe(m.id);
        expect(meta.typeId).toBe('litigation');
        expect(meta.customFields).toEqual({ jurisdiction: 'NY', amount: 100 });
        expect(meta.createdAt).toBeGreaterThan(0);
        expect(meta.updatedAt).toBeGreaterThan(0);
    });

    it('upsert updates on second call (same matter id) and preserves createdAt', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        const first = store.upsert({
            matterId: m.id,
            typeId: 'litigation',
            customFields: { jurisdiction: 'NY' },
        });
        // Advance time so updatedAt is distinguishably newer.
        const second = new MatterMetadataStore({
            db,
            now: () => first.createdAt + 1000,
        }).upsert({
            matterId: m.id,
            typeId: 'transactional',
            customFields: { jurisdiction: 'DE', amount: 200 },
        });
        expect(second.createdAt).toBe(first.createdAt);
        expect(second.updatedAt).toBeGreaterThan(first.updatedAt);
        expect(second.typeId).toBe('transactional');
        expect(second.customFields).toEqual({ jurisdiction: 'DE', amount: 200 });
    });

    it('upsert accepts null typeId (untyped matter) and an empty customFields blob', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        const meta = store.upsert({
            matterId: m.id,
            typeId: null,
            customFields: {},
        });
        expect(meta.typeId).toBeNull();
        expect(meta.customFields).toEqual({});
    });

    it('listByType returns matter ids whose row matches the given typeId', () => {
        const a = workspaces.createWorkspace({ name: 'A' });
        const b = workspaces.createWorkspace({ name: 'B' });
        const c = workspaces.createWorkspace({ name: 'C' });
        store.upsert({ matterId: a.id, typeId: 'lit', customFields: {} });
        store.upsert({ matterId: b.id, typeId: 'lit', customFields: {} });
        store.upsert({ matterId: c.id, typeId: 'tx', customFields: {} });
        expect(store.listByType('lit').sort()).toEqual([a.id, b.id].sort());
        expect(store.listByType('tx')).toEqual([c.id]);
        expect(store.listByType('missing')).toEqual([]);
    });

    it('delete removes the row', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        store.upsert({ matterId: m.id, typeId: 'lit', customFields: {} });
        expect(store.delete(m.id)).toBe(true);
        expect(store.get(m.id)).toBeNull();
        expect(store.delete(m.id)).toBe(false);
    });

    it('cascades on workspace delete (FK ON DELETE CASCADE)', () => {
        const m = workspaces.createWorkspace({ name: 'A' });
        store.upsert({ matterId: m.id, typeId: 'lit', customFields: { x: 1 } });
        expect(store.get(m.id)).not.toBeNull();
        workspaces.deleteWorkspace(m.id);
        expect(store.get(m.id)).toBeNull();
    });
});
