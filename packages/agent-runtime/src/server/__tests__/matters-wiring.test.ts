import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'matters-wiring-'));
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

describe('matters wiring', () => {
    it('returns 404 for /api/matters when modules.matters is false', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: false }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const res = await request(app).get('/api/matters');
            expect(res.status).toBe(404);
        } finally {
            await close();
        }
    });

    it('mounts /api/matters when modules.matters is true', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const res = await request(app).get('/api/matters');
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.items)).toBe(true);
        } finally {
            await close();
        }
    });

    it('creates a matter and grants the dev user owner so they can read it back', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const createRes = await request(app)
                .post('/api/matters')
                .send({ name: 'Acme v Beta' });
            expect(createRes.status).toBe(201);
            const matterId = createRes.body.item.id;

            const listRes = await request(app).get('/api/matters');
            expect(listRes.status).toBe(200);
            expect(listRes.body.items.some((m: { id: string }) => m.id === matterId)).toBe(true);

            // Member-aware: the matter detail route is mounted under
            // requireMatterAccess, so the dev session being an owner means
            // we can fetch it back without a 403.
            const oneRes = await request(app).get(`/api/matters/${matterId}`);
            expect(oneRes.status).toBe(200);
            expect(oneRes.body.item.name).toBe('Acme v Beta');
        } finally {
            await close();
        }
    });

    it('exposes the matter members endpoint behind requireMatterAccess', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const createRes = await request(app)
                .post('/api/matters')
                .send({ name: 'M' });
            const matterId = createRes.body.item.id;

            const res = await request(app).get(
                `/api/matters/${matterId}/members`,
            );
            expect(res.status).toBe(200);
            expect(res.body.role).toBe('owner');
            expect(res.body.items).toHaveLength(1);
        } finally {
            await close();
        }
    });

    it('list filters by membership so non-members cannot see other users matters', async () => {
        // Boot once with devAuth=true to create a matter owned by the dev user.
        const dbPath = join(tmp, 'agent.db');
        const manifestPath = writeManifest({ matters: true });
        const first = await createApp({ manifestPath, dbPath, devAuth: true });
        try {
            await request(first.app).post('/api/matters').send({ name: 'Solo' });
        } finally {
            await first.close();
        }

        // Re-boot pointing at the same DB but WITHOUT devAuth — every request
        // is unauthenticated, so the list endpoint should fail at the auth
        // gate (the membership filter is only reachable past auth).
        const second = await createApp({ manifestPath, dbPath });
        try {
            const res = await request(second.app).get('/api/matters');
            expect(res.status).toBe(401);
        } finally {
            await second.close();
        }
    });

    it('matter-scoped chats list is scoped to that matter', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, history: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const a = await request(app).post('/api/matters').send({ name: 'A' });
            const b = await request(app).post('/api/matters').send({ name: 'B' });
            await request(app)
                .post(`/api/matters/${a.body.item.id}/chats`)
                .send({ name: 'first chat in A' });

            const inA = await request(app).get(
                `/api/matters/${a.body.item.id}/chats`,
            );
            const inB = await request(app).get(
                `/api/matters/${b.body.item.id}/chats`,
            );
            expect(inA.status).toBe(200);
            expect(inA.body.items).toHaveLength(1);
            expect(inA.body.items[0].name).toBe('first chat in A');
            expect(inB.status).toBe(200);
            expect(inB.body.items).toHaveLength(0);
        } finally {
            await close();
        }
    });
});
