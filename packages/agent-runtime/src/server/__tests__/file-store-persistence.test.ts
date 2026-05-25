import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';
import { InMemoryFileStore } from '../files-route.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'file-store-persist-'));
});
afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
});

function writeManifest(modules: Record<string, boolean>): string {
    const p = join(tmp, 'agent.json');
    writeFileSync(
        p,
        JSON.stringify({
            name: 'Test',
            description: 'd',
            theme: { id: 'default' },
            persona: { id: 'p', systemPrompt: 's' },
            components: {
                chat: true,
                toolActivity: true,
                approvals: false,
                knowledgeBase: false,
                files: false,
                citations: false,
                workspace: false,
            },
            modules,
            tools: [],
        }),
    );
    return p;
}

describe('InMemoryFileStore disk persistence', () => {
    it('round-trips a record through write → new instance → read', () => {
        const dataDir = join(tmp, 'files');
        const writer = new InMemoryFileStore({ dataDir });
        writer.put({
            id: 'file_a',
            sessionId: 'matter-1',
            name: 'note.txt',
            mimeType: 'text/plain',
            size: 5,
            bytes: Buffer.from('hello'),
            createdAt: 12345,
        });

        const reader = new InMemoryFileStore({ dataDir });
        const rec = reader.get('matter-1', 'file_a');
        expect(rec).toBeDefined();
        expect(rec!.name).toBe('note.txt');
        expect(rec!.mimeType).toBe('text/plain');
        expect(rec!.size).toBe(5);
        expect(rec!.createdAt).toBe(12345);
        expect(rec!.bytes.toString('utf-8')).toBe('hello');
    });

    it('delete removes both on-disk files', () => {
        const dataDir = join(tmp, 'files');
        const store = new InMemoryFileStore({ dataDir });
        store.put({
            id: 'file_a',
            sessionId: 'matter-1',
            name: 'note.txt',
            mimeType: 'text/plain',
            size: 5,
            bytes: Buffer.from('hello'),
            createdAt: 0,
        });
        const bucketPath = join(dataDir, 'matter-1');
        expect(existsSync(join(bucketPath, 'file_a.bin'))).toBe(true);
        expect(existsSync(join(bucketPath, 'file_a.meta.json'))).toBe(true);
        store.delete('matter-1', 'file_a');
        expect(existsSync(join(bucketPath, 'file_a.bin'))).toBe(false);
        expect(existsSync(join(bucketPath, 'file_a.meta.json'))).toBe(false);
    });

    it('null dataDir keeps the store in-memory (no disk writes)', () => {
        const dataDir = join(tmp, 'files');
        const store = new InMemoryFileStore({ dataDir: null });
        store.put({
            id: 'file_a',
            sessionId: 'matter-1',
            name: 'note.txt',
            mimeType: 'text/plain',
            size: 1,
            bytes: Buffer.from('x'),
            createdAt: 0,
        });
        expect(existsSync(dataDir)).toBe(false);
    });

    it('agent-runtime: matter doc bytes survive a createApp restart cycle', async () => {
        // This is the regression that motivated the L5 disk persistence:
        // before the port, a tsx-watch restart left workspace_documents
        // rows pointing at file ids whose bytes had been GC'd from memory,
        // and `buildLocalRunCellAdapter` then yielded "document not found"
        // when the user re-ran cell extraction.
        const manifestPath = writeManifest({ matters: true });
        const dbPath = join(tmp, 'agent.db');

        // First boot — upload a doc, get its externalDocId.
        const first = await createApp({ manifestPath, dbPath, devAuth: true });
        let matterId: string;
        let externalDocId: string;
        try {
            const m = await request(first.app)
                .post('/api/matters')
                .send({ name: 'L5 persist' });
            matterId = m.body.item.id;
            const uploaded = await request(first.app)
                .post(`/api/matters/${matterId}/documents/upload`)
                .attach('file', Buffer.from('I survive restarts'), {
                    filename: 'note.txt',
                    contentType: 'text/plain',
                });
            externalDocId = uploaded.body.item.externalDocId;
        } finally {
            await first.close();
        }

        // Second boot against the same dbPath. The default files dir
        // sits next to it, so the same buckets hydrate on construction.
        const second = await createApp({ manifestPath, dbPath, devAuth: true });
        try {
            const res = await request(second.app).get(
                `/api/files/${encodeURIComponent(matterId)}/${encodeURIComponent(externalDocId)}/content`,
            );
            expect(res.status).toBe(200);
            expect(res.text).toBe('I survive restarts');
        } finally {
            await second.close();
        }
    });

    it('filesDataDir: null opts out of persistence', async () => {
        const manifestPath = writeManifest({ matters: true });
        const dbPath = join(tmp, 'agent.db');

        const first = await createApp({
            manifestPath,
            dbPath,
            devAuth: true,
            filesDataDir: null,
        });
        let matterId: string;
        let externalDocId: string;
        try {
            const m = await request(first.app)
                .post('/api/matters')
                .send({ name: 'ephemeral' });
            matterId = m.body.item.id;
            const uploaded = await request(first.app)
                .post(`/api/matters/${matterId}/documents/upload`)
                .attach('file', Buffer.from('gone after restart'), {
                    filename: 'note.txt',
                    contentType: 'text/plain',
                });
            externalDocId = uploaded.body.item.externalDocId;
        } finally {
            await first.close();
        }

        const second = await createApp({
            manifestPath,
            dbPath,
            devAuth: true,
            filesDataDir: null,
        });
        try {
            const res = await request(second.app).get(
                `/api/files/${encodeURIComponent(matterId)}/${encodeURIComponent(externalDocId)}/content`,
            );
            // workspace_documents row still exists in SQLite, but the
            // file bucket bytes don't — opt-out behaves identically to
            // the pre-port store.
            expect(res.status).toBe(404);
        } finally {
            await second.close();
        }
    });
});
