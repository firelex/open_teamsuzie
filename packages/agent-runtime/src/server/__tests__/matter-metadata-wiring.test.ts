import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'matter-metadata-'));
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

describe('matter metadata routes + shadow extensions', () => {
    it('POST /api/matters seeds metadata when typeId / customFields supplied', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const res = await request(app)
                .post('/api/matters')
                .send({
                    name: 'Acme v Beta',
                    typeId: 'litigation',
                    customFields: { jurisdiction: 'NY', amount: 100 },
                });
            expect(res.status).toBe(201);
            expect(res.body.item.name).toBe('Acme v Beta');
            expect(res.body.metadata.typeId).toBe('litigation');
            expect(res.body.metadata.customFields).toEqual({
                jurisdiction: 'NY',
                amount: 100,
            });

            const meta = await request(app).get(
                `/api/matters/${res.body.item.id}/metadata`,
            );
            expect(meta.status).toBe(200);
            expect(meta.body.item.typeId).toBe('litigation');
        } finally {
            await close();
        }
    });

    it('POST /api/matters without metadata fields leaves no metadata row', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const res = await request(app)
                .post('/api/matters')
                .send({ name: 'No type' });
            expect(res.status).toBe(201);
            expect(res.body.metadata).toBeNull();

            const meta = await request(app).get(
                `/api/matters/${res.body.item.id}/metadata`,
            );
            expect(meta.body.item).toBeNull();
        } finally {
            await close();
        }
    });

    it('GET /api/matters embeds metadata on items that have a row', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const typed = await request(app)
                .post('/api/matters')
                .send({
                    name: 'Typed',
                    typeId: 'litigation',
                    customFields: { jurisdiction: 'NY' },
                });
            const untyped = await request(app)
                .post('/api/matters')
                .send({ name: 'Untyped' });

            const list = await request(app).get('/api/matters');
            expect(list.status).toBe(200);
            const items = list.body.items as Array<{
                id: string;
                metadata?: { typeId: string };
            }>;
            const t = items.find((i) => i.id === typed.body.item.id)!;
            const u = items.find((i) => i.id === untyped.body.item.id)!;
            expect(t.metadata?.typeId).toBe('litigation');
            expect(u.metadata).toBeUndefined();
        } finally {
            await close();
        }
    });

    it('PUT /api/matters/:id/metadata replaces typeId + customFields', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const m = await request(app)
                .post('/api/matters')
                .send({ name: 'M' });
            const matterId = m.body.item.id;
            const put = await request(app)
                .put(`/api/matters/${matterId}/metadata`)
                .send({
                    typeId: 'transactional',
                    customFields: { amount: 999, public: true },
                });
            expect(put.status).toBe(200);
            expect(put.body.item.typeId).toBe('transactional');
            expect(put.body.item.customFields).toEqual({
                amount: 999,
                public: true,
            });

            // Second PUT replaces both fields.
            const put2 = await request(app)
                .put(`/api/matters/${matterId}/metadata`)
                .send({ typeId: null, customFields: {} });
            expect(put2.body.item.typeId).toBeNull();
            expect(put2.body.item.customFields).toEqual({});
        } finally {
            await close();
        }
    });

    it('GET /api/matters/:id/metadata returns 404 on missing matter (via requireMatterAccess)', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const res = await request(app).get(
                '/api/matters/missing-id/metadata',
            );
            expect(res.status).toBe(404);
        } finally {
            await close();
        }
    });

    it('matter delete cascades to metadata via FK', async () => {
        const dbPath = join(tmp, 'agent.db');
        const manifestPath = writeManifest({ matters: true });
        const { app, close } = await createApp({
            manifestPath,
            dbPath,
            devAuth: true,
        });
        try {
            const m = await request(app)
                .post('/api/matters')
                .send({
                    name: 'Doomed',
                    typeId: 'litigation',
                    customFields: { x: 1 },
                });
            const matterId = m.body.item.id;
            const before = await request(app).get(
                `/api/matters/${matterId}/metadata`,
            );
            expect(before.body.item.typeId).toBe('litigation');

            const del = await request(app).delete(`/api/matters/${matterId}`);
            expect(del.status).toBe(200);

            // Re-create a fresh matter to read against; the deleted
            // matter's own routes 404 via requireMatterAccess.
            const probe = await request(app)
                .post('/api/matters')
                .send({ name: 'Probe' });
            const probeMeta = await request(app).get(
                `/api/matters/${probe.body.item.id}/metadata`,
            );
            expect(probeMeta.body.item).toBeNull();
        } finally {
            await close();
        }
    });
});
