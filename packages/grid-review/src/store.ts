import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AddColumnInput,
    AddReviewDocumentInput,
    CellFormat,
    CellStatus,
    CreateReviewInput,
    Review,
    ReviewCell,
    ReviewColumn,
    ReviewDocument,
    ReviewSnapshot,
    UpdateColumnInput,
    UpdateReviewInput,
    UpsertCellInput,
} from './types.js';

interface ReviewRow {
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    created_at: number;
    updated_at: number;
}

interface ColumnRow {
    id: string;
    review_id: string;
    title: string;
    prompt: string;
    format: string;
    position: number;
    created_at: number;
    updated_at: number;
}

interface DocumentRow {
    id: string;
    review_id: string;
    external_doc_id: string;
    name: string;
    mime_type: string | null;
    position: number;
    added_at: number;
}

interface CellRow {
    id: string;
    review_id: string;
    column_id: string;
    review_document_id: string;
    status: string;
    value: string | null;
    citations: string | null;
    error: string | null;
    updated_at: number;
}

export interface ReviewsStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

export class ReviewsStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: ReviewsStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    // --- Review -----------------------------------------------------------

    createReview(input: CreateReviewInput): Review {
        const id = this.newId();
        const now = this.clock();
        prepareCached<[string, string, string, string | null, number, number]>(
            this.db,
            `INSERT INTO reviews (id, workspace_id, name, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, input.workspaceId, input.name, input.description ?? null, now, now);
        return this.getReview(id)!;
    }

    getReview(id: string): Review | null {
        const row = prepareCached<[string], ReviewRow>(
            this.db,
            `SELECT * FROM reviews WHERE id = ?`,
        ).get(id);
        return row ? rowToReview(row) : null;
    }

    listReviews(workspaceId: string): Review[] {
        return prepareCached<[string], ReviewRow>(
            this.db,
            `SELECT * FROM reviews WHERE workspace_id = ? ORDER BY created_at DESC`,
        )
            .all(workspaceId)
            .map(rowToReview);
    }

    updateReview(id: string, patch: UpdateReviewInput): Review | null {
        const existing = this.getReview(id);
        if (!existing) return null;
        const now = this.clock();
        const next = {
            name: patch.name ?? existing.name,
            description:
                patch.description === undefined ? existing.description : patch.description,
        };
        prepareCached<[string, string | null, number, string]>(
            this.db,
            `UPDATE reviews SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
        ).run(next.name, next.description, now, id);
        return this.getReview(id);
    }

    deleteReview(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM reviews WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Columns ----------------------------------------------------------

    addColumn(input: AddColumnInput): ReviewColumn {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [string, string, string, string, string, number, number, number]
        >(
            this.db,
            `INSERT INTO review_columns (id, review_id, title, prompt, format, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.reviewId,
            input.title,
            input.prompt,
            input.format ?? 'text',
            input.position ?? 0,
            now,
            now,
        );
        return this.getColumn(id)!;
    }

    getColumn(id: string): ReviewColumn | null {
        const row = prepareCached<[string], ColumnRow>(
            this.db,
            `SELECT * FROM review_columns WHERE id = ?`,
        ).get(id);
        return row ? rowToColumn(row) : null;
    }

    listColumns(reviewId: string): ReviewColumn[] {
        return prepareCached<[string], ColumnRow>(
            this.db,
            `SELECT * FROM review_columns WHERE review_id = ? ORDER BY position, created_at`,
        )
            .all(reviewId)
            .map(rowToColumn);
    }

    updateColumn(id: string, patch: UpdateColumnInput): ReviewColumn | null {
        const existing = this.getColumn(id);
        if (!existing) return null;
        const now = this.clock();
        const next = {
            title: patch.title ?? existing.title,
            prompt: patch.prompt ?? existing.prompt,
            format: patch.format ?? existing.format,
            position: patch.position ?? existing.position,
        };
        prepareCached<[string, string, string, number, number, string]>(
            this.db,
            `UPDATE review_columns
             SET title = ?, prompt = ?, format = ?, position = ?, updated_at = ?
             WHERE id = ?`,
        ).run(next.title, next.prompt, next.format, next.position, now, id);
        return this.getColumn(id);
    }

    removeColumn(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM review_columns WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Documents (rows) -------------------------------------------------

    addDocument(input: AddReviewDocumentInput): ReviewDocument {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [string, string, string, string, string | null, number, number]
        >(
            this.db,
            `INSERT INTO review_documents
             (id, review_id, external_doc_id, name, mime_type, position, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.reviewId,
            input.externalDocId,
            input.name,
            input.mimeType ?? null,
            input.position ?? 0,
            now,
        );
        return this.getDocument(id)!;
    }

    getDocument(id: string): ReviewDocument | null {
        const row = prepareCached<[string], DocumentRow>(
            this.db,
            `SELECT * FROM review_documents WHERE id = ?`,
        ).get(id);
        return row ? rowToDocument(row) : null;
    }

    listDocuments(reviewId: string): ReviewDocument[] {
        return prepareCached<[string], DocumentRow>(
            this.db,
            `SELECT * FROM review_documents WHERE review_id = ? ORDER BY position, added_at`,
        )
            .all(reviewId)
            .map(rowToDocument);
    }

    removeDocument(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM review_documents WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    /**
     * Drop every review row that references a given external document
     * within a workspace. Used by hosts to keep reviews in sync when the
     * underlying document is removed from its matter — without this, a
     * review can hold a row pointing at a file_id that no longer exists,
     * with no way for the review UI to detect the staleness.
     *
     * Cells cascade away with the row (FK ON DELETE CASCADE).
     */
    removeDocumentsByExternalId(
        workspaceId: string,
        externalDocId: string,
    ): number {
        const result = prepareCached<[string, string]>(
            this.db,
            `DELETE FROM review_documents
              WHERE external_doc_id = ?
                AND review_id IN (
                  SELECT id FROM reviews WHERE workspace_id = ?
                )`,
        ).run(externalDocId, workspaceId);
        return result.changes;
    }

    // --- Cells ------------------------------------------------------------

    upsertCell(input: UpsertCellInput): ReviewCell {
        const now = this.clock();
        const existing = this.getCell(input.columnId, input.reviewDocumentId);
        if (existing) {
            const next = {
                status: input.status ?? existing.status,
                value: input.value === undefined ? existing.value : input.value,
                citations:
                    input.citations === undefined ? existing.citations : input.citations,
                error: input.error === undefined ? existing.error : input.error,
            };
            prepareCached<
                [string, string | null, string | null, string | null, number, string]
            >(
                this.db,
                `UPDATE review_cells
                 SET status = ?, value = ?, citations = ?, error = ?, updated_at = ?
                 WHERE id = ?`,
            ).run(next.status, next.value, next.citations, next.error, now, existing.id);
            return this.getCellById(existing.id)!;
        }
        const id = this.newId();
        prepareCached<
            [
                string,
                string,
                string,
                string,
                string,
                string | null,
                string | null,
                string | null,
                number,
            ]
        >(
            this.db,
            `INSERT INTO review_cells
             (id, review_id, column_id, review_document_id, status, value, citations, error, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.reviewId,
            input.columnId,
            input.reviewDocumentId,
            input.status ?? 'pending',
            input.value ?? null,
            input.citations ?? null,
            input.error ?? null,
            now,
        );
        return this.getCellById(id)!;
    }

    getCell(columnId: string, reviewDocumentId: string): ReviewCell | null {
        const row = prepareCached<[string, string], CellRow>(
            this.db,
            `SELECT * FROM review_cells WHERE column_id = ? AND review_document_id = ?`,
        ).get(columnId, reviewDocumentId);
        return row ? rowToCell(row) : null;
    }

    getCellById(id: string): ReviewCell | null {
        const row = prepareCached<[string], CellRow>(
            this.db,
            `SELECT * FROM review_cells WHERE id = ?`,
        ).get(id);
        return row ? rowToCell(row) : null;
    }

    listCells(reviewId: string): ReviewCell[] {
        return prepareCached<[string], CellRow>(
            this.db,
            `SELECT * FROM review_cells WHERE review_id = ?`,
        )
            .all(reviewId)
            .map(rowToCell);
    }

    setCellStatus(id: string, status: CellStatus, error: string | null = null): ReviewCell | null {
        const now = this.clock();
        const result = prepareCached<[string, string | null, number, string]>(
            this.db,
            `UPDATE review_cells SET status = ?, error = ?, updated_at = ? WHERE id = ?`,
        ).run(status, error, now, id);
        if (result.changes === 0) return null;
        return this.getCellById(id);
    }

    /**
     * Reset any cells stuck in `streaming` state to `pending` — typically
     * called once at app startup to recover from an interrupted run
     * (server restart, aborted request, crashed adapter). Safe to call
     * unconditionally; returns the number of rows reset.
     */
    recoverStaleStreaming(): number {
        const result = prepareCached<[number]>(
            this.db,
            `UPDATE review_cells SET status = 'pending', updated_at = ?
             WHERE status = 'streaming'`,
        ).run(this.clock());
        return result.changes;
    }

    // --- Bulk -------------------------------------------------------------

    /**
     * Coherent snapshot of a review for grid rendering. Returns null if the
     * review doesn't exist.
     */
    getReviewSnapshot(reviewId: string): ReviewSnapshot | null {
        const review = this.getReview(reviewId);
        if (!review) return null;
        return {
            review,
            columns: this.listColumns(reviewId),
            documents: this.listDocuments(reviewId),
            cells: this.listCells(reviewId),
        };
    }
}

function rowToReview(row: ReviewRow): Review {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToColumn(row: ColumnRow): ReviewColumn {
    return {
        id: row.id,
        reviewId: row.review_id,
        title: row.title,
        prompt: row.prompt,
        format: row.format as CellFormat,
        position: row.position,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToDocument(row: DocumentRow): ReviewDocument {
    return {
        id: row.id,
        reviewId: row.review_id,
        externalDocId: row.external_doc_id,
        name: row.name,
        mimeType: row.mime_type,
        position: row.position,
        addedAt: row.added_at,
    };
}

function rowToCell(row: CellRow): ReviewCell {
    return {
        id: row.id,
        reviewId: row.review_id,
        columnId: row.column_id,
        reviewDocumentId: row.review_document_id,
        status: row.status as CellStatus,
        value: row.value,
        citations: row.citations,
        error: row.error,
        updatedAt: row.updated_at,
    };
}
