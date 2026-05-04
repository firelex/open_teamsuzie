import { Router, type Request, type Response } from 'express';

import type { CellEvent } from './runner.js';
import type { ReviewsStore } from './store.js';
import type { CellFormat, ReviewColumn, ReviewDocument } from './types.js';

/**
 * Adapter the host injects into the router so this package stays
 * LLM-agnostic and storage-agnostic. Given a (review-)document and a
 * column, the host returns an async iterable of `CellEvent`s — typically
 * by:
 *   1. Loading the file bytes (workspace_documents.external_doc_id → bytes).
 *   2. Converting to text + page breaks.
 *   3. Calling `prepareDocumentForPrompt`.
 *   4. Calling `runCell` (or `runCellWithFormat`) with an `LlmStream` it owns.
 */
export type RunCellAdapter = (args: {
    request?: Request;
    workspaceId: string;
    document: ReviewDocument;
    column: ReviewColumn;
    signal?: AbortSignal;
}) => AsyncIterable<CellEvent>;

export interface CreateReviewsRouterOptions {
    store: ReviewsStore;
    /**
     * If absent, the run endpoint returns 501. Hosts that only want CRUD
     * (e.g. for tests) can leave this off.
     */
    runAdapter?: RunCellAdapter;
    /**
     * Resolve the workspace this review belongs to. When mounted under
     * `/api/matters/:matterId/reviews`, the host typically wires this to
     * `req.params.matterId`. The router uses it to scope listing /
     * creation to the right matter.
     */
    getWorkspaceId: (req: Request) => string;
}

const VALID_FORMATS: ReadonlyArray<CellFormat> = [
    'text',
    'short_text',
    'date',
    'yes_no',
    'bullets',
    'money',
];

/**
 * REST + streaming endpoints for tabular reviews.
 *
 *   GET    /                              — list reviews in the workspace
 *   POST   /                              — create review
 *   GET    /:reviewId                     — full snapshot
 *   PATCH  /:reviewId                     — rename / update description
 *   DELETE /:reviewId                     — delete (cascades)
 *
 *   POST   /:reviewId/columns             — add column
 *   PATCH  /:reviewId/columns/:colId      — update title/prompt/format/position
 *   DELETE /:reviewId/columns/:colId      — remove column (cascades to its cells)
 *
 *   POST   /:reviewId/documents           — add row by external_doc_id
 *   DELETE /:reviewId/documents/:rowId    — remove row (cascades to its cells)
 *
 *   POST   /:reviewId/run                 — SSE stream that runs all pending
 *                                           cells, persisting via upsertCell;
 *                                           emits cell-status events the
 *                                           client can use to drive UI.
 */
export function createReviewsRouter(opts: CreateReviewsRouterOptions): Router {
    const { store, runAdapter, getWorkspaceId } = opts;
    const router: Router = Router();

    router.get('/', (req, res) => {
        const workspaceId = getWorkspaceId(req);
        res.json({ items: store.listReviews(workspaceId) });
    });

    router.post('/', (req, res) => {
        const workspaceId = getWorkspaceId(req);
        const body = req.body as Record<string, unknown> | undefined;
        const name = String(body?.name || '').trim();
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const description =
            typeof body?.description === 'string' && body.description.trim().length > 0
                ? body.description.trim()
                : null;
        const review = store.createReview({ workspaceId, name, description });
        res.status(201).json({ item: review });
    });

    router.get('/:reviewId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const snap = store.getReviewSnapshot(reviewId);
        if (!snap || snap.review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ snapshot: snap });
    });

    router.patch('/:reviewId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const patch: { name?: string; description?: string | null } = {};
        if (typeof body?.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            patch.name = trimmed;
        }
        if ('description' in (body ?? {})) {
            const d = body!.description;
            if (d === null) patch.description = null;
            else if (typeof d === 'string') {
                const trimmed = d.trim();
                patch.description = trimmed.length > 0 ? trimmed : null;
            } else {
                res.status(400).json({ error: 'description must be a string or null' });
                return;
            }
        }
        const updated = store.updateReview(reviewId, patch);
        res.json({ item: updated });
    });

    router.delete('/:reviewId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.deleteReview(reviewId);
        res.json({ ok: true });
    });

    // --- Columns ----------------------------------------------------------

    router.post('/:reviewId/columns', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const title = String(body?.title || '').trim();
        const prompt = String(body?.prompt || '').trim();
        if (!title || !prompt) {
            res.status(400).json({ error: 'title and prompt are required' });
            return;
        }
        let format: CellFormat = 'text';
        if (typeof body?.format === 'string') {
            if (!VALID_FORMATS.includes(body.format as CellFormat)) {
                res.status(400).json({ error: 'unknown format' });
                return;
            }
            format = body.format as CellFormat;
        }
        const position =
            typeof body?.position === 'number' && Number.isInteger(body.position)
                ? body.position
                : store.listColumns(reviewId).length;
        const col = store.addColumn({ reviewId, title, prompt, format, position });
        res.status(201).json({ item: col });
    });

    router.patch('/:reviewId/columns/:colId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const colId = String(req.params.colId ?? '');
        const review = store.getReview(reviewId);
        const column = store.getColumn(colId);
        if (
            !review ||
            review.workspaceId !== getWorkspaceId(req) ||
            !column ||
            column.reviewId !== reviewId
        ) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const patch: {
            title?: string;
            prompt?: string;
            format?: CellFormat;
            position?: number;
        } = {};
        if (typeof body?.title === 'string') {
            const trimmed = body.title.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'title cannot be empty' });
                return;
            }
            patch.title = trimmed;
        }
        if (typeof body?.prompt === 'string') {
            const trimmed = body.prompt.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'prompt cannot be empty' });
                return;
            }
            patch.prompt = trimmed;
        }
        if (typeof body?.format === 'string') {
            if (!VALID_FORMATS.includes(body.format as CellFormat)) {
                res.status(400).json({ error: 'unknown format' });
                return;
            }
            patch.format = body.format as CellFormat;
        }
        if (typeof body?.position === 'number' && Number.isInteger(body.position)) {
            patch.position = body.position;
        }
        const updated = store.updateColumn(colId, patch);
        res.json({ item: updated });
    });

    router.delete('/:reviewId/columns/:colId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const colId = String(req.params.colId ?? '');
        const review = store.getReview(reviewId);
        const column = store.getColumn(colId);
        if (
            !review ||
            review.workspaceId !== getWorkspaceId(req) ||
            !column ||
            column.reviewId !== reviewId
        ) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.removeColumn(colId);
        res.json({ ok: true });
    });

    // --- Documents (rows) -------------------------------------------------

    router.post('/:reviewId/documents', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const externalDocId = String(body?.externalDocId || '').trim();
        const name = String(body?.name || '').trim();
        if (!externalDocId || !name) {
            res.status(400).json({ error: 'externalDocId and name are required' });
            return;
        }
        const mimeType =
            typeof body?.mimeType === 'string' && body.mimeType.length > 0
                ? body.mimeType
                : null;
        const position =
            typeof body?.position === 'number' && Number.isInteger(body.position)
                ? body.position
                : store.listDocuments(reviewId).length;
        try {
            const row = store.addDocument({
                reviewId,
                externalDocId,
                name,
                mimeType,
                position,
            });
            res.status(201).json({ item: row });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'failed';
            // The unique constraint on (review_id, external_doc_id) trips here.
            if (/UNIQUE/i.test(message)) {
                res.status(409).json({ error: 'document already in review' });
                return;
            }
            res.status(500).json({ error: message });
        }
    });

    router.delete('/:reviewId/documents/:rowId', (req, res) => {
        const reviewId = String(req.params.reviewId ?? '');
        const rowId = String(req.params.rowId ?? '');
        const review = store.getReview(reviewId);
        const row = store.getDocument(rowId);
        if (
            !review ||
            review.workspaceId !== getWorkspaceId(req) ||
            !row ||
            row.reviewId !== reviewId
        ) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.removeDocument(rowId);
        res.json({ ok: true });
    });

    // --- Run pending cells via SSE ---------------------------------------

    router.post('/:reviewId/cells/run', async (req, res) => {
        if (!runAdapter) {
            res.status(501).json({ error: 'run adapter not configured' });
            return;
        }
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const columnId = String(body?.columnId ?? '');
        const reviewDocumentId = String(body?.reviewDocumentId ?? '');
        const column = store.getColumn(columnId);
        const document = store.getDocument(reviewDocumentId);
        if (!column || column.reviewId !== reviewId) {
            res.status(404).json({ error: 'column not found' });
            return;
        }
        if (!document || document.reviewId !== reviewId) {
            res.status(404).json({ error: 'row not found' });
            return;
        }

        // Reset the cell so the UI flips to a pending dot immediately. Pass
        // explicit nulls to actually clear the prior value/citations/error
        // (upsertCell preserves any field whose input is `undefined`).
        store.upsertCell({
            reviewId,
            columnId: column.id,
            reviewDocumentId: document.id,
            status: 'pending',
            value: null,
            citations: null,
            error: null,
        });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const send = (event: object) =>
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        const abort = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) abort.abort();
        });

        try {
            send({ type: 'start', columnId: column.id, rowId: document.id });
            let accumulated = '';
            let finalCell: ReturnType<ReviewsStore['upsertCell']> | null = null;
            try {
                for await (const event of runAdapter({
                    request: req,
                    workspaceId: review.workspaceId,
                    document,
                    column,
                    signal: abort.signal,
                })) {
                    if (event.type === 'token') {
                        accumulated += event.text;
                        store.upsertCell({
                            reviewId,
                            columnId: column.id,
                            reviewDocumentId: document.id,
                            status: 'streaming',
                            value: accumulated,
                        });
                        send({
                            type: 'cell_token',
                            columnId: column.id,
                            rowId: document.id,
                            text: event.text,
                        });
                    } else if (event.type === 'retrieved') {
                        send({
                            type: 'cell_retrieved',
                            columnId: column.id,
                            rowId: document.id,
                            summary: event.summary,
                            chunkCount: event.chunkCount,
                            chunks: event.chunks,
                            retrievalQuery: event.retrievalQuery,
                        });
                    } else if (event.type === 'done') {
                        finalCell = store.upsertCell({
                            reviewId,
                            columnId: column.id,
                            reviewDocumentId: document.id,
                            status: 'done',
                            value: event.text,
                            citations: JSON.stringify(event.citations),
                            error: null,
                        });
                    } else if (event.type === 'error') {
                        finalCell = store.upsertCell({
                            reviewId,
                            columnId: column.id,
                            reviewDocumentId: document.id,
                            status: 'error',
                            error: event.error.message,
                        });
                    }
                }
            } catch (err) {
                finalCell = store.upsertCell({
                    reviewId,
                    columnId: column.id,
                    reviewDocumentId: document.id,
                    status: 'error',
                    error: err instanceof Error ? err.message : 'failed',
                });
            }
            send({
                type: 'done',
                columnId: column.id,
                rowId: document.id,
                cellId: finalCell?.id ?? null,
                status: finalCell?.status ?? 'error',
            });
        } finally {
            res.end();
        }
    });

    router.post('/:reviewId/run', async (req, res) => {
        if (!runAdapter) {
            res.status(501).json({ error: 'run adapter not configured' });
            return;
        }
        const reviewId = String(req.params.reviewId ?? '');
        const review = store.getReview(reviewId);
        if (!review || review.workspaceId !== getWorkspaceId(req)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const columns = store.listColumns(reviewId);
        const docs = store.listDocuments(reviewId);
        const cells = store.listCells(reviewId);
        const cellByKey = new Map(
            cells.map((c) => [`${c.columnId}::${c.reviewDocumentId}`, c]),
        );

        // Pending = no cell yet, or status pending/error. (Streaming means
        // another run is already going; skip those to avoid races.)
        const pending: { column: ReviewColumn; document: ReviewDocument }[] = [];
        for (const doc of docs) {
            for (const col of columns) {
                const existing = cellByKey.get(`${col.id}::${doc.id}`);
                if (!existing || existing.status === 'pending' || existing.status === 'error') {
                    pending.push({ column: col, document: doc });
                }
            }
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const send = (event: object) =>
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        const abort = new AbortController();
        res.on('close', () => {
            if (!res.writableEnded) abort.abort();
        });

        try {
            send({ type: 'start', total: pending.length });
            for (const { column, document } of pending) {
                if (abort.signal.aborted) break;
                send({
                    type: 'cell_start',
                    columnId: column.id,
                    rowId: document.id,
                });
                let accumulated = '';
                let finalCell: ReturnType<ReviewsStore['upsertCell']> | null = null;
                try {
                    for await (const event of runAdapter({
                        request: req,
                        workspaceId: review.workspaceId,
                        document,
                        column,
                        signal: abort.signal,
                    })) {
                        if (event.type === 'token') {
                            accumulated += event.text;
                            store.upsertCell({
                                reviewId,
                                columnId: column.id,
                                reviewDocumentId: document.id,
                                status: 'streaming',
                                value: accumulated,
                            });
                            send({
                                type: 'cell_token',
                                columnId: column.id,
                                rowId: document.id,
                                text: event.text,
                            });
                        } else if (event.type === 'retrieved') {
                            send({
                                type: 'cell_retrieved',
                                columnId: column.id,
                                rowId: document.id,
                                summary: event.summary,
                                chunkCount: event.chunkCount,
                                chunks: event.chunks,
                                retrievalQuery: event.retrievalQuery,
                            });
                        } else if (event.type === 'done') {
                            finalCell = store.upsertCell({
                                reviewId,
                                columnId: column.id,
                                reviewDocumentId: document.id,
                                status: 'done',
                                value: event.text,
                                citations: JSON.stringify(event.citations),
                                error: null,
                            });
                        } else if (event.type === 'error') {
                            finalCell = store.upsertCell({
                                reviewId,
                                columnId: column.id,
                                reviewDocumentId: document.id,
                                status: 'error',
                                error: event.error.message,
                            });
                        }
                    }
                } catch (err) {
                    finalCell = store.upsertCell({
                        reviewId,
                        columnId: column.id,
                        reviewDocumentId: document.id,
                        status: 'error',
                        error: err instanceof Error ? err.message : 'failed',
                    });
                }
                send({
                    type: 'cell_done',
                    columnId: column.id,
                    rowId: document.id,
                    cellId: finalCell?.id ?? null,
                    status: finalCell?.status ?? 'error',
                });
            }
            send({ type: 'done' });
        } finally {
            res.end();
        }
    });

    return router;
}
