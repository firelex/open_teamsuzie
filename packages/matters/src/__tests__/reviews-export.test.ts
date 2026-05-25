import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import {
    ReviewsStore as GridReviewsStore,
    REVIEWS_MIGRATIONS as GRID_REVIEWS_MIGRATIONS,
} from '@teamsuzie/grid-review';

import {
    buildReviewWorkbook,
    createReviewsExportRouter,
} from '../reviews-export.js';

let db: DatabaseInstance;
let workspaces: WorkspacesStore;
let reviews: GridReviewsStore;

beforeEach(() => {
    db = openDb({
        path: ':memory:',
        migrations: [...WORKSPACES_MIGRATIONS, ...GRID_REVIEWS_MIGRATIONS],
    });
    workspaces = new WorkspacesStore({ db });
    reviews = new GridReviewsStore({ db });
});

afterEach(() => {
    db.close();
});

async function buildSeededReview() {
    const matter = workspaces.createWorkspace({ name: 'Acme v Beta' });
    const review = reviews.createReview({
        workspaceId: matter.id,
        name: 'NDA review',
        description: null,
    });
    const col1 = reviews.addColumn({
        reviewId: review.id,
        title: 'Term length',
        prompt: 'How long is the term?',
        format: 'text',
        position: 0,
    });
    const col2 = reviews.addColumn({
        reviewId: review.id,
        title: 'Governing law',
        prompt: 'Which jurisdiction governs?',
        format: 'short_text',
        position: 1,
    });
    const doc1 = reviews.addDocument({
        reviewId: review.id,
        externalDocId: 'file_a',
        name: 'nda-a.pdf',
        mimeType: 'application/pdf',
        position: 0,
    });
    const doc2 = reviews.addDocument({
        reviewId: review.id,
        externalDocId: 'file_b',
        name: 'nda-b.docx',
        mimeType:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        position: 1,
    });
    reviews.upsertCell({
        reviewId: review.id,
        columnId: col1.id,
        reviewDocumentId: doc1.id,
        status: 'done',
        value: '2 years',
        citations: JSON.stringify([
            { id: 1, doc: 'file_a', quote: 'The term shall be two (2) years.' },
        ]),
        error: null,
    });
    reviews.upsertCell({
        reviewId: review.id,
        columnId: col2.id,
        reviewDocumentId: doc1.id,
        status: 'done',
        value: 'New York',
        citations: null,
        error: null,
    });
    reviews.upsertCell({
        reviewId: review.id,
        columnId: col1.id,
        reviewDocumentId: doc2.id,
        status: 'error',
        value: null,
        citations: null,
        error: 'Conversion failed',
    });
    reviews.upsertCell({
        reviewId: review.id,
        columnId: col2.id,
        reviewDocumentId: doc2.id,
        status: 'pending',
        value: null,
        citations: null,
        error: null,
    });
    return { matter, review };
}

describe('buildReviewWorkbook', () => {
    it('renders header + doc rows + cell values', async () => {
        const { matter, review } = await buildSeededReview();
        const { workbook, fileName, reviewName } = await buildReviewWorkbook({
            reviews,
            workspaces,
            reviewId: review.id,
            matterId: matter.id,
        });
        expect(reviewName).toBe('NDA review');
        expect(fileName).toMatch(/acme-v-beta-nda-review-\d{4}-\d{2}-\d{2}\.xlsx$/);
        const sheet = workbook.worksheets[0]!;
        const header = sheet.getRow(1).values as (string | undefined)[];
        // ExcelJS prefixes a leading undefined index 0; check 1+
        expect(header[1]).toBe('Document');
        expect(header[2]).toBe('Term length');
        expect(header[3]).toBe('Governing law');

        // Two doc rows, in position order
        expect(sheet.getCell('A2').value).toBe('nda-a.pdf');
        expect(sheet.getCell('B2').value).toBe('2 years');
        expect(sheet.getCell('C2').value).toBe('New York');
        expect(sheet.getCell('A3').value).toBe('nda-b.docx');
        // errored cell renders error string in value
        expect(sheet.getCell('B3').value).toBe('Conversion failed');
        // pending cell renders empty
        expect(sheet.getCell('C3').value).toBe('');
    });

    it('attaches citation comments on cells with citations', async () => {
        const { matter, review } = await buildSeededReview();
        const { workbook } = await buildReviewWorkbook({
            reviews,
            workspaces,
            reviewId: review.id,
            matterId: matter.id,
        });
        const sheet = workbook.worksheets[0]!;
        const noted = sheet.getCell('B2');
        // Cell has a citation → note populated; otherwise null
        expect(noted.note).toBeDefined();
        // Cell without citations is undefined
        const noNote = sheet.getCell('C2');
        expect(noNote.note).toBeUndefined();
    });

    it('throws 404 when the review id does not belong to the matter', async () => {
        const matter = workspaces.createWorkspace({ name: 'A' });
        const other = workspaces.createWorkspace({ name: 'B' });
        const r = reviews.createReview({
            workspaceId: other.id,
            name: 'wrong matter',
            description: null,
        });
        await expect(
            buildReviewWorkbook({
                reviews,
                workspaces,
                reviewId: r.id,
                matterId: matter.id,
            }),
        ).rejects.toThrow(/review not found/);
    });
});

describe('createReviewsExportRouter', () => {
    it('serves a .xlsx download with the expected content-type and filename', async () => {
        const { matter, review } = await buildSeededReview();
        const app = express();
        // Mimic the agent-runtime mount: prefix middleware stashes
        // matterId on the request the same way the chats and reviews
        // sub-routers consume it.
        app.use(
            '/api/matters/:matterId/reviews',
            (req, _res, next) => {
                (req as unknown as { _matterId?: string })._matterId = String(
                    req.params.matterId ?? '',
                );
                next();
            },
            createReviewsExportRouter({ reviews, workspaces }),
        );
        const res = await request(app)
            .get(`/api/matters/${matter.id}/reviews/${review.id}/export.xlsx`)
            .responseType('blob');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(
            /openxmlformats-officedocument\.spreadsheetml\.sheet/,
        );
        expect(res.headers['content-disposition']).toContain(
            'attachment; filename=',
        );

        // Round-trip the bytes through ExcelJS to confirm a valid xlsx.
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(res.body);
        const sheet = wb.worksheets[0]!;
        expect(sheet.getCell('A1').value).toBe('Document');
    });

    it('returns 404 when the review id does not belong to the matter', async () => {
        const a = workspaces.createWorkspace({ name: 'A' });
        const b = workspaces.createWorkspace({ name: 'B' });
        const inB = reviews.createReview({
            workspaceId: b.id,
            name: 'In B',
            description: null,
        });
        const app = express();
        app.use(
            '/api/matters/:matterId/reviews',
            (req, _res, next) => {
                (req as unknown as { _matterId?: string })._matterId = String(
                    req.params.matterId ?? '',
                );
                next();
            },
            createReviewsExportRouter({ reviews, workspaces }),
        );
        const res = await request(app).get(
            `/api/matters/${a.id}/reviews/${inB.id}/export.xlsx`,
        );
        expect(res.status).toBe(404);
    });
});
