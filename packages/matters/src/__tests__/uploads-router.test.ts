import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import {
    DocumentVersionsStore,
    DOCUMENT_VERSIONS_MIGRATIONS,
} from '@teamsuzie/document-versions';

import { createMatterUploadsRouter } from '../uploads-router.js';
import type { MatterFileRecord, MatterFileStore } from '../uploads-router.js';

class FakeFileStore implements MatterFileStore {
    private bySession = new Map<string, Map<string, MatterFileRecord>>();
    put(record: MatterFileRecord): void {
        let sess = this.bySession.get(record.sessionId);
        if (!sess) {
            sess = new Map();
            this.bySession.set(record.sessionId, sess);
        }
        sess.set(record.id, record);
    }
    get(sessionId: string, fileId: string): MatterFileRecord | undefined {
        return this.bySession.get(sessionId)?.get(fileId);
    }
}

let db: DatabaseInstance;
let workspaces: WorkspacesStore;
let documentVersions: DocumentVersionsStore;
let fileStore: FakeFileStore;
let app: express.Express;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [...WORKSPACES_MIGRATIONS, ...DOCUMENT_VERSIONS_MIGRATIONS],
    });
    workspaces = new WorkspacesStore({ db });
    documentVersions = new DocumentVersionsStore({ db });
    fileStore = new FakeFileStore();
    app = express();
    app.use(
        '/api/matters',
        createMatterUploadsRouter({
            fileStore,
            workspaces,
            documentVersions,
            maxUploadBytes: 5 * 1024 * 1024,
        }),
    );
});

afterEach(() => {
    db.close();
});

describe('createMatterUploadsRouter — POST /:matterId/documents/upload', () => {
    it('uploads bytes to the matter bucket, adds a workspace_document row, records an upload version', async () => {
        const matter = workspaces.createWorkspace({ name: 'Acme v Beta' });

        const res = await request(app)
            .post(`/api/matters/${matter.id}/documents/upload`)
            .attach('file', Buffer.from('hello world'), {
                filename: 'memo.txt',
                contentType: 'text/plain',
            });

        expect(res.status).toBe(201);
        expect(res.body.item.name).toBe('memo.txt');
        expect(res.body.item.workspaceId).toBe(matter.id);
        expect(res.body.item.externalDocId).toBeDefined();

        const docs = workspaces.listDocuments(matter.id);
        expect(docs).toHaveLength(1);
        const doc = docs[0]!;
        expect(doc.name).toBe('memo.txt');

        const fileRec = fileStore.get(matter.id, doc.externalDocId);
        expect(fileRec).toBeDefined();
        expect(fileRec!.bytes.toString('utf-8')).toBe('hello world');
        expect(fileRec!.sessionId).toBe(matter.id);

        const versions = documentVersions.listVersions(doc.externalDocId);
        expect(versions).toHaveLength(1);
        expect(versions[0]!.source).toBe('upload');
    });

    it('returns 404 when the matter does not exist', async () => {
        const res = await request(app)
            .post('/api/matters/missing-matter/documents/upload')
            .attach('file', Buffer.from('x'), {
                filename: 'memo.txt',
                contentType: 'text/plain',
            });

        expect(res.status).toBe(404);
        expect(res.body.error).toMatch(/matter not found/i);
    });

    it('returns 400 when the multipart "file" field is missing', async () => {
        const matter = workspaces.createWorkspace({ name: 'No file test' });
        const res = await request(app)
            .post(`/api/matters/${matter.id}/documents/upload`)
            .field('folderId', '');

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/file is required/i);
    });

    it('returns 415 for unsupported file extensions', async () => {
        const matter = workspaces.createWorkspace({ name: 'Unsupported test' });
        const res = await request(app)
            .post(`/api/matters/${matter.id}/documents/upload`)
            .attach('file', Buffer.from('00'), {
                filename: 'thing.exe',
                contentType: 'application/octet-stream',
            });

        expect(res.status).toBe(415);
        expect(res.body.error).toMatch(/Unsupported file type/i);
    });

    it('accepts a folderId form field and places the doc inside that folder', async () => {
        const matter = workspaces.createWorkspace({ name: 'Folder test' });
        const folder = workspaces.createFolder({
            workspaceId: matter.id,
            parentFolderId: null,
            name: 'Pleadings',
        });

        const res = await request(app)
            .post(`/api/matters/${matter.id}/documents/upload`)
            .field('folderId', folder.id)
            .attach('file', Buffer.from('motion'), {
                filename: 'motion.pdf',
                contentType: 'application/pdf',
            });

        expect(res.status).toBe(201);
        expect(res.body.item.folderId).toBe(folder.id);
    });

    it('works without documentVersions wired (it is optional)', async () => {
        const localApp = express();
        localApp.use(
            '/api/matters',
            createMatterUploadsRouter({
                fileStore,
                workspaces,
                maxUploadBytes: 5 * 1024 * 1024,
            }),
        );
        const matter = workspaces.createWorkspace({ name: 'No versions' });
        const res = await request(localApp)
            .post(`/api/matters/${matter.id}/documents/upload`)
            .attach('file', Buffer.from('hi'), {
                filename: 'hi.txt',
                contentType: 'text/plain',
            });
        expect(res.status).toBe(201);
    });
});
