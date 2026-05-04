import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { DOCUMENT_VERSIONS_MIGRATIONS } from '../migrations.js';
import { DocumentVersionsStore } from '../store.js';

let db: DatabaseInstance;
let store: DocumentVersionsStore;
let nextId = 0;
let nextTime = 1700000000000;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: DOCUMENT_VERSIONS_MIGRATIONS,
    });
    nextId = 0;
    nextTime = 1700000000000;
    store = new DocumentVersionsStore({
        db,
        idFactory: () => `v${++nextId}`,
        now: () => ++nextTime,
    });
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
        expect(tables).toContain('document_versions');
        expect(tables).toContain('document_heads');
    });
});

describe('addVersion', () => {
    it('returns the new version with all fields populated', () => {
        const v = store.addVersion({
            externalDocId: 'doc-1',
            parentId: null,
            source: 'upload',
            storageId: 'file_abc',
            byteSize: 12345,
            contentHash: 'sha256-aaa',
            notes: 'initial upload',
        });
        expect(v.id).toBe('v1');
        expect(v.externalDocId).toBe('doc-1');
        expect(v.parentId).toBeNull();
        expect(v.source).toBe('upload');
        expect(v.storageId).toBe('file_abc');
        expect(v.byteSize).toBe(12345);
        expect(v.contentHash).toBe('sha256-aaa');
        expect(v.notes).toBe('initial upload');
        expect(typeof v.createdAt).toBe('number');
    });

    it('rejects an invalid source', () => {
        expect(() =>
            store.addVersion({
                externalDocId: 'doc-1',
                source: 'bogus' as never,
                storageId: 'file',
            }),
        ).toThrow(/invalid source/);
    });

    it("accepts 'generated' as a source (WD4)", () => {
        const v = store.addVersion({
            externalDocId: 'doc-cp-checklist',
            parentId: null,
            source: 'generated',
            storageId: 'file_generated_abc',
            byteSize: 4096,
            notes: 'CP checklist (Acme Holdings senior secured term loan)',
        });
        expect(v.source).toBe('generated');
        expect(v.parentId).toBeNull();
        // Round-trip: re-read and confirm the source survived persistence.
        const fetched = store.getVersion(v.id);
        expect(fetched?.source).toBe('generated');
    });

    it('rejects a parentId that does not exist', () => {
        expect(() =>
            store.addVersion({
                externalDocId: 'doc-1',
                parentId: 'no-such-version',
                source: 'proposal',
                storageId: 'file',
            }),
        ).toThrow(/parentId not found/);
    });

    it('rejects a parentId belonging to a different document', () => {
        const root = store.addVersion({
            externalDocId: 'doc-A',
            source: 'upload',
            storageId: 'fileA',
        });
        expect(() =>
            store.addVersion({
                externalDocId: 'doc-B',
                parentId: root.id,
                source: 'proposal',
                storageId: 'fileB',
            }),
        ).toThrow(/different document/);
    });

    it('updates the head pointer to the newly-added version', () => {
        const a = store.addVersion({
            externalDocId: 'doc-1',
            source: 'upload',
            storageId: 'file1',
        });
        expect(store.getHead('doc-1')?.id).toBe(a.id);
        const b = store.addVersion({
            externalDocId: 'doc-1',
            parentId: a.id,
            source: 'proposal',
            storageId: 'file2',
        });
        expect(store.getHead('doc-1')?.id).toBe(b.id);
    });
});

describe('listVersions', () => {
    it('returns the chain in chronological order, oldest first', () => {
        const a = store.addVersion({
            externalDocId: 'doc-1',
            source: 'upload',
            storageId: 's1',
        });
        const b = store.addVersion({
            externalDocId: 'doc-1',
            parentId: a.id,
            source: 'proposal',
            storageId: 's2',
        });
        const c = store.addVersion({
            externalDocId: 'doc-1',
            parentId: b.id,
            source: 'accept',
            storageId: 's3',
        });
        const list = store.listVersions('doc-1');
        expect(list.map((v) => v.id)).toEqual([a.id, b.id, c.id]);
    });

    it('isolates versions by externalDocId', () => {
        store.addVersion({
            externalDocId: 'doc-A',
            source: 'upload',
            storageId: 'a',
        });
        const b = store.addVersion({
            externalDocId: 'doc-B',
            source: 'upload',
            storageId: 'b',
        });
        const list = store.listVersions('doc-B');
        expect(list).toHaveLength(1);
        expect(list[0].id).toBe(b.id);
    });
});

describe('walkAncestors', () => {
    it('walks parent chain back to root, newest first', () => {
        const a = store.addVersion({
            externalDocId: 'd',
            source: 'upload',
            storageId: 'a',
        });
        const b = store.addVersion({
            externalDocId: 'd',
            parentId: a.id,
            source: 'proposal',
            storageId: 'b',
        });
        const c = store.addVersion({
            externalDocId: 'd',
            parentId: b.id,
            source: 'accept',
            storageId: 'c',
        });
        const ancestors = store.walkAncestors(c.id);
        expect(ancestors.map((v) => v.id)).toEqual([c.id, b.id, a.id]);
    });

    it('returns just the version itself when it has no parent', () => {
        const a = store.addVersion({
            externalDocId: 'd',
            source: 'upload',
            storageId: 'a',
        });
        expect(store.walkAncestors(a.id).map((v) => v.id)).toEqual([a.id]);
    });

    it('returns empty for a non-existent id', () => {
        expect(store.walkAncestors('missing')).toEqual([]);
    });
});

describe('walkDescendants', () => {
    it('returns every version on every branch below a given version', () => {
        // a → b → c (linear)
        // a → d (branch)
        const a = store.addVersion({
            externalDocId: 'd',
            source: 'upload',
            storageId: 'a',
        });
        const b = store.addVersion({
            externalDocId: 'd',
            parentId: a.id,
            source: 'proposal',
            storageId: 'b',
        });
        const c = store.addVersion({
            externalDocId: 'd',
            parentId: b.id,
            source: 'accept',
            storageId: 'c',
        });
        const d = store.addVersion({
            externalDocId: 'd',
            parentId: a.id,
            source: 'reject',
            storageId: 'd',
        });
        const desc = store.walkDescendants(a.id);
        expect(new Set(desc.map((v) => v.id))).toEqual(
            new Set([b.id, c.id, d.id]),
        );
    });
});

describe('setHead (restore an old version)', () => {
    it('repoints the head at any prior version while leaving the chain intact', () => {
        const a = store.addVersion({
            externalDocId: 'd',
            source: 'upload',
            storageId: 'a',
        });
        const b = store.addVersion({
            externalDocId: 'd',
            parentId: a.id,
            source: 'proposal',
            storageId: 'b',
        });
        const c = store.addVersion({
            externalDocId: 'd',
            parentId: b.id,
            source: 'reject',
            storageId: 'c',
        });
        // Head is now c. Restore a:
        store.setHead('d', a.id);
        expect(store.getHead('d')?.id).toBe(a.id);
        // Chain still has all three versions:
        expect(store.listVersions('d').map((v) => v.id)).toEqual([
            a.id,
            b.id,
            c.id,
        ]);
    });

    it('rejects setting head to a non-existent version', () => {
        const a = store.addVersion({
            externalDocId: 'd',
            source: 'upload',
            storageId: 'a',
        });
        expect(() => store.setHead('d', 'missing')).toThrow(/not found/);
        // Head untouched
        expect(store.getHead('d')?.id).toBe(a.id);
    });

    it('rejects setting head to a version on a different document', () => {
        store.addVersion({
            externalDocId: 'd1',
            source: 'upload',
            storageId: 'a',
        });
        const other = store.addVersion({
            externalDocId: 'd2',
            source: 'upload',
            storageId: 'b',
        });
        expect(() => store.setHead('d1', other.id)).toThrow(
            /different document/,
        );
    });
});

describe('AC: full round trip — chain walkable, head pointer, restore old version', () => {
    it('end-to-end demo of the R12 acceptance criteria', () => {
        // Upload v1
        const v1 = store.addVersion({
            externalDocId: 'NDA',
            source: 'upload',
            storageId: 'bytes-of-v1',
            byteSize: 1000,
            notes: 'Initial NDA from counterparty',
        });
        // LLM proposes a redline
        const v2 = store.addVersion({
            externalDocId: 'NDA',
            parentId: v1.id,
            source: 'proposal',
            storageId: 'bytes-of-v2',
            byteSize: 1100,
            notes: 'Redline: tighten confidentiality scope',
        });
        // User accepts
        const v3 = store.addVersion({
            externalDocId: 'NDA',
            parentId: v2.id,
            source: 'accept',
            storageId: 'bytes-of-v3',
            byteSize: 1080,
        });

        // (1) Chain walkable
        const chain = store.listVersions('NDA');
        expect(chain.map((v) => v.source)).toEqual([
            'upload',
            'proposal',
            'accept',
        ]);
        const ancestors = store.walkAncestors(v3.id);
        expect(ancestors.map((v) => v.id)).toEqual([v3.id, v2.id, v1.id]);

        // (2) Current pointer
        expect(store.getHead('NDA')?.id).toBe(v3.id);

        // (3) Restore an old version
        store.setHead('NDA', v1.id);
        expect(store.getHead('NDA')?.id).toBe(v1.id);
        // Chain still has all three:
        expect(store.listVersions('NDA')).toHaveLength(3);
    });
});

describe('deleteAllForDocument', () => {
    it('removes every version + head row for one document, leaves others untouched', () => {
        const a1 = store.addVersion({
            externalDocId: 'A',
            source: 'upload',
            storageId: 'a1',
        });
        store.addVersion({
            externalDocId: 'A',
            parentId: a1.id,
            source: 'proposal',
            storageId: 'a2',
        });
        const b1 = store.addVersion({
            externalDocId: 'B',
            source: 'upload',
            storageId: 'b1',
        });

        const removed = store.deleteAllForDocument('A');
        expect(removed).toBe(2);

        expect(store.listVersions('A')).toEqual([]);
        expect(store.getHead('A')).toBeNull();
        // B untouched
        expect(store.listVersions('B')).toHaveLength(1);
        expect(store.getHead('B')?.id).toBe(b1.id);
    });
});
