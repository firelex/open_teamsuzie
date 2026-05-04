import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { WORKSPACES_MIGRATIONS } from '../migrations.js';
import { WorkspacesStore } from '../store.js';

let db: DatabaseInstance;
let store: WorkspacesStore;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: WORKSPACES_MIGRATIONS });
    store = new WorkspacesStore({ db });
});

afterEach(() => {
    db.close();
});

describe('migrations', () => {
    it('runs clean on a fresh DB and is idempotent', () => {
        const fresh = openDb({
            path: ':memory:',
            migrations: WORKSPACES_MIGRATIONS,
        });
        // Re-running migrations on the same DB must be a no-op.
        for (const m of WORKSPACES_MIGRATIONS) {
            expect(() => fresh.exec(m.up)).not.toThrow();
        }
        const tables = fresh
            .prepare<[], { name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
            )
            .all()
            .map((r) => r.name);
        expect(tables).toContain('workspaces');
        expect(tables).toContain('folders');
        expect(tables).toContain('workspace_documents');
        fresh.close();
    });
});

describe('Workspace CRUD', () => {
    it('creates, reads, updates, archives, and deletes', () => {
        const created = store.createWorkspace({
            name: 'Acme acquisition',
            description: 'M&A diligence',
        });
        expect(created.id).toBeTruthy();
        expect(created.name).toBe('Acme acquisition');
        expect(created.description).toBe('M&A diligence');
        expect(created.archivedAt).toBeNull();

        const fetched = store.getWorkspace(created.id);
        expect(fetched).toEqual(created);

        const updated = store.updateWorkspace(created.id, {
            name: 'Acme acquisition (v2)',
            description: null,
        });
        expect(updated?.name).toBe('Acme acquisition (v2)');
        expect(updated?.description).toBeNull();
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        expect(store.archiveWorkspace(created.id)).toBe(true);
        expect(store.getWorkspace(created.id)?.archivedAt).toBeTruthy();

        // Archive twice = no-op (idempotent for the visible state).
        expect(store.archiveWorkspace(created.id)).toBe(false);

        expect(store.unarchiveWorkspace(created.id)).toBe(true);
        expect(store.getWorkspace(created.id)?.archivedAt).toBeNull();

        expect(store.deleteWorkspace(created.id)).toBe(true);
        expect(store.getWorkspace(created.id)).toBeNull();
    });

    it('lists active workspaces by default; includeArchived flips the filter', () => {
        const a = store.createWorkspace({ name: 'A' });
        const b = store.createWorkspace({ name: 'B' });
        store.archiveWorkspace(b.id);

        const active = store.listWorkspaces();
        expect(active.map((w) => w.id)).toEqual([a.id]);

        const all = store.listWorkspaces({ includeArchived: true }).map((w) => w.id);
        expect(all.sort()).toEqual([a.id, b.id].sort());
    });

    it('updateWorkspace returns null for unknown id', () => {
        expect(store.updateWorkspace('does-not-exist', { name: 'x' })).toBeNull();
    });
});

describe('Folder CRUD', () => {
    it('round-trips folders with nested parents', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const root = store.createFolder({ workspaceId: ws.id, name: 'Root' });
        const child = store.createFolder({
            workspaceId: ws.id,
            parentFolderId: root.id,
            name: 'Child',
        });

        expect(store.getFolder(child.id)?.parentFolderId).toBe(root.id);

        const allInWs = store.listFolders(ws.id);
        expect(allInWs.map((f) => f.id).sort()).toEqual(
            [root.id, child.id].sort(),
        );

        const rootOnly = store.listFolders(ws.id, null);
        expect(rootOnly.map((f) => f.id)).toEqual([root.id]);

        const directChildren = store.listFolders(ws.id, root.id);
        expect(directChildren.map((f) => f.id)).toEqual([child.id]);
    });

    it('moves a folder to a new parent and renames', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const a = store.createFolder({ workspaceId: ws.id, name: 'A' });
        const b = store.createFolder({ workspaceId: ws.id, name: 'B' });
        const moved = store.updateFolder(b.id, {
            parentFolderId: a.id,
            name: 'B-renamed',
        });
        expect(moved?.parentFolderId).toBe(a.id);
        expect(moved?.name).toBe('B-renamed');
    });
});

describe('Document CRUD', () => {
    it('round-trips documents with full metadata', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const doc = store.addDocument({
            workspaceId: ws.id,
            externalDocId: 'file_abc123',
            name: 'NDA.pdf',
            mimeType: 'application/pdf',
            size: 12345,
        });
        expect(doc.id).toBeTruthy();
        expect(doc.externalDocId).toBe('file_abc123');
        expect(doc.size).toBe(12345);
        expect(doc.folderId).toBeNull();

        const folder = store.createFolder({ workspaceId: ws.id, name: 'Diligence' });
        const moved = store.updateDocument(doc.id, { folderId: folder.id });
        expect(moved?.folderId).toBe(folder.id);

        // listDocuments filters
        const all = store.listDocuments(ws.id);
        expect(all).toHaveLength(1);

        const root = store.listDocuments(ws.id, { folderId: null });
        expect(root).toHaveLength(0);

        const inFolder = store.listDocuments(ws.id, { folderId: folder.id });
        expect(inFolder).toHaveLength(1);

        expect(store.removeDocument(doc.id)).toBe(true);
        expect(store.getDocument(doc.id)).toBeNull();
    });
});

describe('cascades', () => {
    it('deleting a workspace removes its folders and documents', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const folder = store.createFolder({ workspaceId: ws.id, name: 'F' });
        store.addDocument({
            workspaceId: ws.id,
            folderId: folder.id,
            externalDocId: 'ext1',
            name: 'a.pdf',
        });
        store.addDocument({
            workspaceId: ws.id,
            externalDocId: 'ext2',
            name: 'b.pdf',
        });

        expect(store.listFolders(ws.id)).toHaveLength(1);
        expect(store.listDocuments(ws.id)).toHaveLength(2);

        expect(store.deleteWorkspace(ws.id)).toBe(true);

        expect(store.listFolders(ws.id)).toHaveLength(0);
        expect(store.listDocuments(ws.id)).toHaveLength(0);
    });

    it('deleting a parent folder cascades to subfolders', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const parent = store.createFolder({ workspaceId: ws.id, name: 'Parent' });
        const child = store.createFolder({
            workspaceId: ws.id,
            parentFolderId: parent.id,
            name: 'Child',
        });

        expect(store.deleteFolder(parent.id)).toBe(true);
        expect(store.getFolder(child.id)).toBeNull();
    });

    it('deleting a folder sets its documents folder_id to NULL (moves to root)', () => {
        const ws = store.createWorkspace({ name: 'WS' });
        const folder = store.createFolder({ workspaceId: ws.id, name: 'F' });
        const doc = store.addDocument({
            workspaceId: ws.id,
            folderId: folder.id,
            externalDocId: 'ext',
            name: 'x.pdf',
        });

        expect(store.deleteFolder(folder.id)).toBe(true);

        const after = store.getDocument(doc.id);
        expect(after).not.toBeNull();
        expect(after!.folderId).toBeNull();
    });
});

describe('id + clock injection', () => {
    it('uses injected idFactory and clock', () => {
        const fixedDb = openDb({
            path: ':memory:',
            migrations: WORKSPACES_MIGRATIONS,
        });
        let counter = 0;
        const fixed = new WorkspacesStore({
            db: fixedDb,
            idFactory: () => `test-id-${++counter}`,
            now: () => 1700000000000,
        });
        const ws = fixed.createWorkspace({ name: 'X' });
        expect(ws.id).toBe('test-id-1');
        expect(ws.createdAt).toBe(1700000000000);
        expect(ws.updatedAt).toBe(1700000000000);
        fixedDb.close();
    });
});
