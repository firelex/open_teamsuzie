import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import {
    ReviewsStore as GridReviewsStore,
    REVIEWS_MIGRATIONS as GRID_REVIEWS_MIGRATIONS,
} from '@teamsuzie/grid-review';
import {
    WorkflowsStore,
    WORKFLOWS_MIGRATIONS,
} from '@teamsuzie/workflows';

import { createReviewsFromWorkflowRouter } from '../reviews-from-workflow.js';

const SESSION_EMAIL = 'demo@example.com';

let db: DatabaseInstance;
let workspaces: WorkspacesStore;
let reviews: GridReviewsStore;
let workflows: WorkflowsStore;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [
            ...WORKSPACES_MIGRATIONS,
            ...GRID_REVIEWS_MIGRATIONS,
            ...WORKFLOWS_MIGRATIONS,
        ],
    });
    workspaces = new WorkspacesStore({ db });
    reviews = new GridReviewsStore({ db });
    workflows = new WorkflowsStore({ db });
});

afterEach(() => {
    db.close();
});

function makeApp(opts?: { sessionEmail?: string | null }): express.Express {
    const app = express();
    app.use(express.json());
    const sessionEmail =
        opts?.sessionEmail === undefined ? SESSION_EMAIL : opts.sessionEmail;
    app.use(
        '/api/matters/:matterId/reviews',
        (req, _res, next) => {
            (req as unknown as { _matterId?: string })._matterId = String(
                req.params.matterId ?? '',
            );
            next();
        },
        createReviewsFromWorkflowRouter({
            reviews,
            workspaces,
            workflows,
            getSessionUser: () =>
                sessionEmail ? { email: sessionEmail } : null,
        }),
    );
    return app;
}

function seedUserWorkflow(): string {
    const w = workflows.createUserWorkflow({
        ownerId: SESSION_EMAIL,
        name: 'NDA review',
        description: 'Standard NDA red-flags pass',
        prompt: '',
        practiceAreas: [],
        outputMode: 'tabular_review',
        columnConfig: [
            {
                id: 'col_term',
                title: 'Term length',
                prompt: 'How long is the term?',
                format: 'text',
            },
            {
                id: 'col_law',
                title: 'Governing law',
                prompt: 'Which jurisdiction governs?',
                format: 'short_text',
            },
            {
                id: 'col_invalid',
                title: 'Unknown shape',
                prompt: 'should be skipped',
                format: 'some-future-format',
            },
        ],
    });
    return w.id;
}

describe('createReviewsFromWorkflowRouter — POST /from-workflow', () => {
    it('returns 401 when no session user', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const app = makeApp({ sessionEmail: null });
        const res = await request(app)
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: 'whatever', externalDocIds: ['x'] });
        expect(res.status).toBe(401);
    });

    it('returns 404 when the matter does not exist', async () => {
        const wfId = seedUserWorkflow();
        const res = await request(makeApp())
            .post('/api/matters/missing/reviews/from-workflow')
            .send({ workflowId: wfId, externalDocIds: ['x'] });
        expect(res.status).toBe(404);
    });

    it('returns 400 when workflowId is missing', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ externalDocIds: ['x'] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/workflowId/i);
    });

    it('returns 400 when no documents are selected', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const wfId = seedUserWorkflow();
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: wfId, externalDocIds: [] });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/document/i);
    });

    it('returns 404 when the workflow does not exist', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: 'missing', externalDocIds: ['x'] });
        expect(res.status).toBe(404);
    });

    it('returns 404 when the workflow is user-owned by someone else', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const otherWf = workflows.createUserWorkflow({
            ownerId: 'other@example.com',
            name: 'Other',
            description: '',
            prompt: '',
            practiceAreas: [],
            outputMode: 'tabular_review',
            columnConfig: [
                { id: 'c1', title: 'Q', prompt: 'a?', format: 'text' },
            ],
        });
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: otherWf.id, externalDocIds: ['x'] });
        expect(res.status).toBe(404);
    });

    it('returns 400 when the workflow has no columns', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        const wf = workflows.createUserWorkflow({
            ownerId: SESSION_EMAIL,
            name: 'No-columns workflow',
            description: '',
            prompt: '',
            practiceAreas: [],
            outputMode: 'inline_chat',
            columnConfig: null,
        });
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: wf.id, externalDocIds: ['x'] });
        expect(res.status).toBe(400);
    });

    it('creates a review with valid columns + matching docs; skips invalid formats and stale ids', async () => {
        const matter = workspaces.createWorkspace({ name: 'Acme v Beta' });
        // Add two matter documents the user can reference.
        const docA = workspaces.addDocument({
            workspaceId: matter.id,
            folderId: null,
            externalDocId: 'file_a',
            name: 'nda-a.pdf',
            mimeType: 'application/pdf',
            size: 100,
        });
        const docB = workspaces.addDocument({
            workspaceId: matter.id,
            folderId: null,
            externalDocId: 'file_b',
            name: 'nda-b.docx',
            mimeType:
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 200,
        });
        // Sanity-check the seed
        expect(docA.externalDocId).toBe('file_a');
        expect(docB.externalDocId).toBe('file_b');

        const wfId = seedUserWorkflow();
        const res = await request(makeApp())
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({
                workflowId: wfId,
                // file_a + file_b are in the matter; file_stale is not.
                externalDocIds: ['file_a', 'file_b', 'file_stale'],
            });
        expect(res.status).toBe(201);
        expect(res.body.skipped).toBe(1);

        const snapshot = res.body.item;
        expect(snapshot.review.name).toMatch(/^NDA review — /);
        expect(snapshot.review.workspaceId).toBe(matter.id);
        // Two valid columns survived (col_invalid was filtered out).
        expect(snapshot.columns).toHaveLength(2);
        expect(snapshot.columns.map((c: { title: string }) => c.title)).toEqual([
            'Term length',
            'Governing law',
        ]);
        // Two valid docs (file_a + file_b) became rows; file_stale was skipped.
        expect(snapshot.documents).toHaveLength(2);
        expect(
            snapshot.documents.map((d: { externalDocId: string }) => d.externalDocId).sort(),
        ).toEqual(['file_a', 'file_b']);
    });

    it('lets system workflows be used by any authenticated user', async () => {
        const matter = workspaces.createWorkspace({ name: 'M' });
        workspaces.addDocument({
            workspaceId: matter.id,
            folderId: null,
            externalDocId: 'file_a',
            name: 'doc.pdf',
            mimeType: 'application/pdf',
            size: 1,
        });
        const sys = workflows.upsertSystem({
            id: 'sys-shared',
            name: 'Shared system workflow',
            description: 'system-seeded review template',
            prompt: '',
            practiceAreas: [],
            outputMode: 'tabular_review',
            columnConfig: [
                { id: 'c1', title: 'Q1', prompt: 'a?', format: 'text' },
            ],
        });
        const res = await request(
            makeApp({ sessionEmail: 'other@example.com' }),
        )
            .post(`/api/matters/${matter.id}/reviews/from-workflow`)
            .send({ workflowId: sys.id, externalDocIds: ['file_a'] });
        expect(res.status).toBe(201);
        expect(res.body.item.review.workspaceId).toBe(matter.id);
    });
});
