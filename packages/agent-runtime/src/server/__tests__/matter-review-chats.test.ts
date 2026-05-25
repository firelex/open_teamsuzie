import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../index.js';

let tmp: string;
beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'matter-review-chats-'));
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

describe('review-bound chats under /api/matters/:id/reviews/:id/chats', () => {
    it('creates a review chat with its own workspace namespace, separate from matter chats', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({
                matters: true,
                reviews: true,
                history: true,
            }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const m = await request(app).post('/api/matters').send({ name: 'M' });
            const matterId = m.body.item.id;
            const r = await request(app)
                .post(`/api/matters/${matterId}/reviews`)
                .send({ name: 'NDA review' });
            const reviewId = r.body.item.id;

            // Create a chat under the review.
            const c1 = await request(app)
                .post(
                    `/api/matters/${matterId}/reviews/${reviewId}/chats`,
                )
                .send({ name: 'on this review' });
            expect(c1.status).toBe(201);
            // Workspace id namespace is `review:<reviewId>` so two
            // surfaces don't bleed into each other.
            expect(c1.body.item.workspaceId).toBe(`review:${reviewId}`);

            // The matter-scoped chat list must NOT see the review chat
            // (different workspace_id).
            const matterChats = await request(app).get(
                `/api/matters/${matterId}/chats`,
            );
            expect(matterChats.body.items).toHaveLength(0);

            // The review-scoped list sees its own chat.
            const reviewChats = await request(app).get(
                `/api/matters/${matterId}/reviews/${reviewId}/chats`,
            );
            expect(reviewChats.body.items).toHaveLength(1);
        } finally {
            await close();
        }
    });

    it('returns 404 when the review id does not belong to the matter', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const a = await request(app).post('/api/matters').send({ name: 'A' });
            const b = await request(app).post('/api/matters').send({ name: 'B' });
            // Create a review in matter A, then try to reach its chats
            // via matter B's url.
            const rA = await request(app)
                .post(`/api/matters/${a.body.item.id}/reviews`)
                .send({ name: 'in A' });
            const cross = await request(app)
                .post(
                    `/api/matters/${b.body.item.id}/reviews/${rA.body.item.id}/chats`,
                )
                .send({});
            expect(cross.status).toBe(404);
        } finally {
            await close();
        }
    });

    it('returns 404 on a non-existent reviewId', async () => {
        const { app, close } = await createApp({
            manifestPath: writeManifest({ matters: true, reviews: true }),
            dbPath: join(tmp, 'agent.db'),
            devAuth: true,
        });
        try {
            const m = await request(app).post('/api/matters').send({ name: 'M' });
            const res = await request(app)
                .post(
                    `/api/matters/${m.body.item.id}/reviews/no-such-review/chats`,
                )
                .send({});
            expect(res.status).toBe(404);
        } finally {
            await close();
        }
    });
});
