import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { RECORDS_MIGRATIONS } from '../migrations.js';
import { RecordsStore } from '../store.js';

let db: DatabaseInstance;
let store: RecordsStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: RECORDS_MIGRATIONS });
    nextId = 0;
    nextTime = 1700000000000;
    store = new RecordsStore({
        db,
        idFactory: () => `r${++nextId}`,
        now: () => ++nextTime,
    });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('creates the record_types table with the right shape', () => {
        const cols = db
            .prepare<[], { name: string }>(`PRAGMA table_info('record_types')`)
            .all()
            .map((r) => r.name)
            .sort();
        expect(cols).toEqual(
            [
                'id',
                'org_id',
                'key',
                'name',
                'description',
                'created_at',
                'updated_at',
            ].sort(),
        );
    });

    it('creates the records table with the right shape', () => {
        const cols = db
            .prepare<[], { name: string }>(`PRAGMA table_info('records')`)
            .all()
            .map((r) => r.name)
            .sort();
        expect(cols).toEqual(
            [
                'id',
                'org_id',
                'type_id',
                'title',
                'custom_fields',
                'created_by',
                'created_at',
                'updated_at',
                'archived_at',
            ].sort(),
        );
    });
});

describe('record types', () => {
    it('creates and reads back a type by id and by (org, key)', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
            description: 'A piece of equipment',
        });
        expect(t.id).toBe('r1');
        expect(t.key).toBe('asset');
        expect(store.getRecordType(t.id)).toEqual(t);
        expect(store.getRecordTypeByKey('org-1', 'asset')).toEqual(t);
        expect(store.getRecordTypeByKey('org-2', 'asset')).toBeNull();
    });

    it('rejects duplicate (org, key) types', () => {
        store.createRecordType({ orgId: 'org-1', key: 'asset', name: 'Asset' });
        expect(() =>
            store.createRecordType({ orgId: 'org-1', key: 'asset', name: 'Other' }),
        ).toThrow();
    });

    it('allows the same key across different orgs', () => {
        const a = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const b = store.createRecordType({
            orgId: 'org-2',
            key: 'asset',
            name: 'Asset',
        });
        expect(a.id).not.toBe(b.id);
    });

    it('lists types per org, name-sorted', () => {
        store.createRecordType({ orgId: 'org-1', key: 'b', name: 'Beta' });
        store.createRecordType({ orgId: 'org-1', key: 'a', name: 'Alpha' });
        store.createRecordType({ orgId: 'org-2', key: 'z', name: 'Zeta' });
        const list = store.listRecordTypes('org-1').map((t) => t.name);
        expect(list).toEqual(['Alpha', 'Beta']);
    });

    it('updates name/description and refreshes updated_at', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const updated = store.updateRecordType(t.id, {
            name: 'Equipment',
            description: 'Renamed',
        });
        expect(updated?.name).toBe('Equipment');
        expect(updated?.description).toBe('Renamed');
        expect(updated!.updatedAt).toBeGreaterThan(t.updatedAt);
    });

    it('cascades record deletion when a type is deleted', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        store.createRecord({ orgId: 'org-1', typeId: t.id, title: 'pump-1' });
        store.createRecord({ orgId: 'org-1', typeId: t.id, title: 'pump-2' });
        expect(store.countRecords({ orgId: 'org-1' })).toBe(2);
        expect(store.deleteRecordType(t.id)).toBe(true);
        expect(store.countRecords({ orgId: 'org-1' })).toBe(0);
    });
});

describe('record CRUD', () => {
    it('creates a record with title and custom fields, round-tripping the JSON', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const r = store.createRecord({
            orgId: 'org-1',
            typeId: t.id,
            title: 'Pump 1',
            customFields: { serial: 'X-9', kw: 12.5, tags: ['onsite'] },
            createdBy: 'alice@x',
        });
        expect(r.title).toBe('Pump 1');
        expect(r.customFields).toEqual({
            serial: 'X-9',
            kw: 12.5,
            tags: ['onsite'],
        });
        expect(r.createdBy).toBe('alice@x');
        expect(r.archivedAt).toBeNull();
    });

    it('updateRecord replaces customFields when provided, leaves alone when omitted', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const r = store.createRecord({
            orgId: 'org-1',
            typeId: t.id,
            title: 'Original',
            customFields: { a: 1, b: 2 },
        });
        const titleOnly = store.updateRecord(r.id, { title: 'Renamed' });
        expect(titleOnly?.title).toBe('Renamed');
        expect(titleOnly?.customFields).toEqual({ a: 1, b: 2 });
        const replaced = store.updateRecord(r.id, { customFields: { c: 3 } });
        expect(replaced?.customFields).toEqual({ c: 3 });
    });

    it('archive/unarchive toggles archivedAt', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const r = store.createRecord({
            orgId: 'org-1',
            typeId: t.id,
            title: 'x',
        });
        const archived = store.archiveRecord(r.id);
        expect(archived?.archivedAt).not.toBeNull();
        const restored = store.unarchiveRecord(r.id);
        expect(restored?.archivedAt).toBeNull();
    });

    it('tolerates corrupt custom_fields JSON by surfacing empty object', () => {
        const t = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const r = store.createRecord({
            orgId: 'org-1',
            typeId: t.id,
            title: 'x',
        });
        // Simulate a corrupted column out-of-band.
        db.prepare(`UPDATE records SET custom_fields = '{not json' WHERE id = ?`).run(r.id);
        const reloaded = store.getRecord(r.id);
        expect(reloaded?.customFields).toEqual({});
    });
});

describe('listRecords', () => {
    function seed() {
        const t1 = store.createRecordType({
            orgId: 'org-1',
            key: 'asset',
            name: 'Asset',
        });
        const t2 = store.createRecordType({
            orgId: 'org-1',
            key: 'site',
            name: 'Site',
        });
        store.createRecord({ orgId: 'org-1', typeId: t1.id, title: 'Pump Alpha' });
        store.createRecord({ orgId: 'org-1', typeId: t1.id, title: 'Pump Beta' });
        store.createRecord({ orgId: 'org-1', typeId: t2.id, title: 'North Yard' });
        // org-2 record should never appear in org-1 reads.
        const otherType = store.createRecordType({
            orgId: 'org-2',
            key: 'asset',
            name: 'Asset',
        });
        store.createRecord({
            orgId: 'org-2',
            typeId: otherType.id,
            title: 'Pump Other',
        });
        return { t1, t2 };
    }

    it('scopes to org and excludes archived by default', () => {
        const { t1 } = seed();
        const archived = store.createRecord({
            orgId: 'org-1',
            typeId: t1.id,
            title: 'Pump Old',
        });
        store.archiveRecord(archived.id);
        const titles = store
            .listRecords({ orgId: 'org-1' })
            .map((r) => r.title)
            .sort();
        expect(titles).toEqual(['North Yard', 'Pump Alpha', 'Pump Beta']);
    });

    it('filters by type', () => {
        const { t2 } = seed();
        const titles = store
            .listRecords({ orgId: 'org-1', typeId: t2.id })
            .map((r) => r.title);
        expect(titles).toEqual(['North Yard']);
    });

    it('search is case-insensitive substring on title', () => {
        seed();
        const titles = store
            .listRecords({ orgId: 'org-1', search: 'pump' })
            .map((r) => r.title)
            .sort();
        expect(titles).toEqual(['Pump Alpha', 'Pump Beta']);
    });

    it('order title_asc sorts case-insensitively', () => {
        seed();
        const titles = store
            .listRecords({ orgId: 'org-1', order: 'title_asc' })
            .map((r) => r.title);
        expect(titles).toEqual(['North Yard', 'Pump Alpha', 'Pump Beta']);
    });

    it('paginates with limit/offset', () => {
        seed();
        const page1 = store.listRecords({
            orgId: 'org-1',
            order: 'title_asc',
            limit: 2,
        });
        const page2 = store.listRecords({
            orgId: 'org-1',
            order: 'title_asc',
            limit: 2,
            offset: 2,
        });
        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(1);
        expect(page1.concat(page2).map((r) => r.title)).toEqual([
            'North Yard',
            'Pump Alpha',
            'Pump Beta',
        ]);
    });

    it('includeArchived surfaces archived rows', () => {
        const { t1 } = seed();
        const archived = store.createRecord({
            orgId: 'org-1',
            typeId: t1.id,
            title: 'Pump Old',
        });
        store.archiveRecord(archived.id);
        const titles = store
            .listRecords({ orgId: 'org-1', includeArchived: true })
            .map((r) => r.title)
            .sort();
        expect(titles).toContain('Pump Old');
    });

    it('countRecords matches list filter set', () => {
        seed();
        expect(store.countRecords({ orgId: 'org-1' })).toBe(3);
        expect(store.countRecords({ orgId: 'org-1', search: 'pump' })).toBe(2);
    });
});
