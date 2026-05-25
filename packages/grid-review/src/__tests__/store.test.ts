import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import { REVIEWS_MIGRATIONS } from '../migrations.js';
import { ReviewsStore } from '../store.js';

let db: DatabaseInstance;
let store: ReviewsStore;

beforeEach(() => {
    db = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
    store = new ReviewsStore({ db });
});

afterEach(() => {
    db.close();
});

function makeReviewWithRowsAndCols() {
    const review = store.createReview({
        workspaceId: 'matter-1',
        name: 'M&A diligence',
    });
    const colA = store.addColumn({
        reviewId: review.id,
        title: 'Governing law',
        prompt: 'What is the governing law?',
        format: 'short_text',
    });
    const colB = store.addColumn({
        reviewId: review.id,
        title: 'Termination notice',
        prompt: 'How many days notice for termination?',
        format: 'short_text',
        position: 1,
    });
    const docA = store.addDocument({
        reviewId: review.id,
        externalDocId: 'wd-1',
        name: 'NDA.pdf',
        mimeType: 'application/pdf',
    });
    const docB = store.addDocument({
        reviewId: review.id,
        externalDocId: 'wd-2',
        name: 'Lease.docx',
        position: 1,
    });
    return { review, colA, colB, docA, docB };
}

describe('migrations', () => {
    it('runs clean on a fresh DB and is idempotent', () => {
        const fresh = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
        for (const m of REVIEWS_MIGRATIONS) {
            expect(() => fresh.exec(m.up)).not.toThrow();
        }
        const tables = fresh
            .prepare<[], { name: string }>(
                `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
            )
            .all()
            .map((r) => r.name);
        expect(tables).toContain('grid_reviews');
        expect(tables).toContain('grid_review_columns');
        expect(tables).toContain('grid_review_documents');
        expect(tables).toContain('grid_review_cells');
        fresh.close();
    });
});

describe('Review CRUD', () => {
    it('creates, reads, updates, deletes', () => {
        const created = store.createReview({
            workspaceId: 'matter-1',
            name: 'Q3 diligence',
            description: 'Twelve target companies',
        });
        expect(created.workspaceId).toBe('matter-1');

        const updated = store.updateReview(created.id, { name: 'Q3 diligence (v2)' });
        expect(updated?.name).toBe('Q3 diligence (v2)');
        expect(updated?.description).toBe('Twelve target companies');
        expect(updated?.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);

        expect(store.deleteReview(created.id)).toBe(true);
        expect(store.getReview(created.id)).toBeNull();
    });

    it('lists by workspace, newest first', () => {
        // Inject the clock so `created_at` can't tie within the millisecond.
        const tickedDb = openDb({
            path: ':memory:',
            migrations: REVIEWS_MIGRATIONS,
        });
        let t = 1700000000000;
        const ticked = new ReviewsStore({ db: tickedDb, now: () => t });
        const a = ticked.createReview({ workspaceId: 'm1', name: 'A' });
        t += 1000;
        const b = ticked.createReview({ workspaceId: 'm1', name: 'B' });
        t += 1000;
        ticked.createReview({ workspaceId: 'm2', name: 'C' });

        const ids = ticked.listReviews('m1').map((r) => r.id);
        expect(ids).toEqual([b.id, a.id]);
        tickedDb.close();
    });
});

describe('Column CRUD', () => {
    it('round-trips columns with prompt + format + position', () => {
        const review = store.createReview({ workspaceId: 'm', name: 'r' });
        const col = store.addColumn({
            reviewId: review.id,
            title: 'Term',
            prompt: 'When does the term end?',
            format: 'date',
            position: 2,
        });
        expect(col.format).toBe('date');
        expect(col.position).toBe(2);

        const updated = store.updateColumn(col.id, { format: 'short_text', position: 5 });
        expect(updated?.format).toBe('short_text');
        expect(updated?.position).toBe(5);

        expect(store.removeColumn(col.id)).toBe(true);
        expect(store.getColumn(col.id)).toBeNull();
    });

    it('lists columns ordered by position', () => {
        const review = store.createReview({ workspaceId: 'm', name: 'r' });
        const c2 = store.addColumn({ reviewId: review.id, title: 'B', prompt: '?', position: 2 });
        const c1 = store.addColumn({ reviewId: review.id, title: 'A', prompt: '?', position: 1 });
        const c3 = store.addColumn({ reviewId: review.id, title: 'C', prompt: '?', position: 3 });
        expect(store.listColumns(review.id).map((c) => c.id)).toEqual([
            c1.id,
            c2.id,
            c3.id,
        ]);
    });
});

describe('Document (row) CRUD', () => {
    it('round-trips review documents', () => {
        const review = store.createReview({ workspaceId: 'm', name: 'r' });
        const doc = store.addDocument({
            reviewId: review.id,
            externalDocId: 'wd-42',
            name: 'NDA.pdf',
            mimeType: 'application/pdf',
        });
        expect(doc.externalDocId).toBe('wd-42');

        expect(store.listDocuments(review.id)).toHaveLength(1);
        expect(store.removeDocument(doc.id)).toBe(true);
        expect(store.getDocument(doc.id)).toBeNull();
    });

    it('rejects duplicate external_doc_id within the same review', () => {
        const review = store.createReview({ workspaceId: 'm', name: 'r' });
        store.addDocument({ reviewId: review.id, externalDocId: 'd1', name: 'a' });
        expect(() =>
            store.addDocument({ reviewId: review.id, externalDocId: 'd1', name: 'a-again' }),
        ).toThrow();
    });
});

describe('Cell upsert + status', () => {
    it('inserts a cell on first write and updates on second', () => {
        const { review, colA, docA } = makeReviewWithRowsAndCols();
        const first = store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
            status: 'streaming',
            value: 'Delawa',
        });
        expect(first.status).toBe('streaming');
        expect(first.value).toBe('Delawa');

        const second = store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
            status: 'done',
            value: 'Delaware',
            citations: '[]',
        });
        expect(second.id).toBe(first.id);
        expect(second.status).toBe('done');
        expect(second.value).toBe('Delaware');
        expect(second.citations).toBe('[]');
    });

    it('partial upsert preserves untouched fields', () => {
        const { review, colA, docA } = makeReviewWithRowsAndCols();
        store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
            value: 'Delaware',
            citations: '[{"id":1}]',
        });
        store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
            status: 'done',
        });
        const got = store.getCell(colA.id, docA.id);
        expect(got?.status).toBe('done');
        expect(got?.value).toBe('Delaware');
        expect(got?.citations).toBe('[{"id":1}]');
    });

    it('setCellStatus marks error', () => {
        const { review, colA, docA } = makeReviewWithRowsAndCols();
        const cell = store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
        });
        const errored = store.setCellStatus(cell.id, 'error', 'token limit');
        expect(errored?.status).toBe('error');
        expect(errored?.error).toBe('token limit');
    });
});

describe('Cascades', () => {
    it('deleting a review wipes columns, docs, and cells', () => {
        const { review, colA, docA } = makeReviewWithRowsAndCols();
        store.upsertCell({
            reviewId: review.id,
            columnId: colA.id,
            reviewDocumentId: docA.id,
            value: 'x',
        });

        expect(store.deleteReview(review.id)).toBe(true);

        expect(store.listColumns(review.id)).toHaveLength(0);
        expect(store.listDocuments(review.id)).toHaveLength(0);
        expect(store.listCells(review.id)).toHaveLength(0);
    });

    it('removing a column cascades to its cells', () => {
        const { review, colA, colB, docA } = makeReviewWithRowsAndCols();
        store.upsertCell({ reviewId: review.id, columnId: colA.id, reviewDocumentId: docA.id, value: 'a' });
        store.upsertCell({ reviewId: review.id, columnId: colB.id, reviewDocumentId: docA.id, value: 'b' });

        store.removeColumn(colA.id);

        expect(store.getCell(colA.id, docA.id)).toBeNull();
        expect(store.getCell(colB.id, docA.id)?.value).toBe('b');
    });

    it('removing a document cascades to its cells', () => {
        const { review, colA, docA, docB } = makeReviewWithRowsAndCols();
        store.upsertCell({ reviewId: review.id, columnId: colA.id, reviewDocumentId: docA.id, value: 'a' });
        store.upsertCell({ reviewId: review.id, columnId: colA.id, reviewDocumentId: docB.id, value: 'b' });

        store.removeDocument(docA.id);

        expect(store.getCell(colA.id, docA.id)).toBeNull();
        expect(store.getCell(colA.id, docB.id)?.value).toBe('b');
    });
});

describe('Snapshot', () => {
    it('returns a coherent tuple of review/columns/docs/cells', () => {
        const { review, colA, colB, docA, docB } = makeReviewWithRowsAndCols();
        store.upsertCell({ reviewId: review.id, columnId: colA.id, reviewDocumentId: docA.id, value: 'a-1' });
        store.upsertCell({ reviewId: review.id, columnId: colB.id, reviewDocumentId: docB.id, value: 'b-2' });

        const snap = store.getReviewSnapshot(review.id);
        expect(snap).not.toBeNull();
        expect(snap!.review.id).toBe(review.id);
        expect(snap!.columns.map((c) => c.id)).toEqual([colA.id, colB.id]);
        expect(snap!.documents.map((d) => d.id)).toEqual([docA.id, docB.id]);
        expect(snap!.cells).toHaveLength(2);
    });

    it('returns null for unknown review', () => {
        expect(store.getReviewSnapshot('nope')).toBeNull();
    });
});

describe('id + clock injection', () => {
    it('uses injected idFactory and clock', () => {
        const fixedDb = openDb({ path: ':memory:', migrations: REVIEWS_MIGRATIONS });
        let counter = 0;
        const fixed = new ReviewsStore({
            db: fixedDb,
            idFactory: () => `test-id-${++counter}`,
            now: () => 1700000000000,
        });
        const r = fixed.createReview({ workspaceId: 'm', name: 'x' });
        expect(r.id).toBe('test-id-1');
        expect(r.createdAt).toBe(1700000000000);
        fixedDb.close();
    });
});
