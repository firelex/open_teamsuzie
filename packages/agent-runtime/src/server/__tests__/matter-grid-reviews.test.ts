import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'matter-grid-reviews-'));
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

describe('matter-scoped grid reviews wiring', () => {
    it('does NOT mount /api/matters/:id/reviews when modules.reviews=false', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: false }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const create = await request(app)
                .post('/api/matters')
                .send({ name: 'M' });
            const id = create.body.item.id;
            // requireMatterAccess gates the path — without a reviews
            // router mounted, the access middleware still runs through
            // and then there's no downstream handler. Express returns
            // 404 from its default no-route handler.
            const res = await request(app).get(`/api/matters/${id}/reviews`);
            expect(res.status).toBe(404);
        } finally {
            await close();
        }
    });

    it('mounts /api/matters/:id/reviews when both matters and reviews modules are on', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const m = await request(app)
                .post('/api/matters')
                .send({ name: 'M' });
            const matterId = m.body.item.id;

            const empty = await request(app).get(
                `/api/matters/${matterId}/reviews`,
            );
            expect(empty.status).toBe(200);
            expect(empty.body.items).toEqual([]);

            const created = await request(app)
                .post(`/api/matters/${matterId}/reviews`)
                .send({ name: 'NDA review', description: 'survey' });
            expect(created.status).toBe(201);
            expect(created.body.item.workspaceId).toBe(matterId);
            const reviewId = created.body.item.id;

            const snap = await request(app).get(
                `/api/matters/${matterId}/reviews/${reviewId}`,
            );
            expect(snap.status).toBe(200);
            expect(snap.body.snapshot.review.id).toBe(reviewId);
            expect(snap.body.snapshot.columns).toEqual([]);
            expect(snap.body.snapshot.documents).toEqual([]);
            expect(snap.body.snapshot.cells).toEqual([]);

            const listAgain = await request(app).get(
                `/api/matters/${matterId}/reviews`,
            );
            expect(listAgain.body.items).toHaveLength(1);
            expect(listAgain.body.items[0].id).toBe(reviewId);
        } finally {
            await close();
        }
    });

    it('matter A cannot see matter B reviews', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const a = await request(app).post('/api/matters').send({ name: 'A' });
            const b = await request(app).post('/api/matters').send({ name: 'B' });
            await request(app)
                .post(`/api/matters/${a.body.item.id}/reviews`)
                .send({ name: 'A review' });

            const inA = await request(app).get(
                `/api/matters/${a.body.item.id}/reviews`,
            );
            const inB = await request(app).get(
                `/api/matters/${b.body.item.id}/reviews`,
            );
            expect(inA.body.items).toHaveLength(1);
            expect(inB.body.items).toHaveLength(0);
        } finally {
            await close();
        }
    });

    it('deleting a matter cascades to its reviews', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const m = await request(app)
                .post('/api/matters')
                .send({ name: 'Doomed' });
            const matterId = m.body.item.id;
            await request(app)
                .post(`/api/matters/${matterId}/reviews`)
                .send({ name: 'Soon-orphan' });

            const before = await request(app).get(
                `/api/matters/${matterId}/reviews`,
            );
            expect(before.body.items).toHaveLength(1);

            const del = await request(app).delete(`/api/matters/${matterId}`);
            expect(del.status).toBe(200);

            // Re-create a matter to read against — the deleted matter's
            // own routes 404 now via requireMatterAccess.
            const probe = await request(app)
                .post('/api/matters')
                .send({ name: 'Probe' });
            const probeRes = await request(app).get(
                `/api/matters/${probe.body.item.id}/reviews`,
            );
            expect(probeRes.body.items).toHaveLength(0);
        } finally {
            await close();
        }
    });
});
