import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Schema for tabular document review:
 *   - `reviews` belongs to a host-side parent (matter / workspace / project).
 *     The `workspace_id` column is opaque — no cross-package FK. The host
 *     app is responsible for cascading on parent delete (typical: when a
 *     matter is deleted, list+delete its reviews).
 *   - `review_columns` — the prompted questions / extractions, in display order.
 *   - `review_documents` — rows in the grid; pointer into the host doc store.
 *   - `review_cells` — the N×M output grid. Sparse (rows only when populated).
 *
 * Within a review, deletes cascade: removing a column wipes its cells;
 * removing a row-document wipes its cells; removing a review wipes everything.
 */
export const REVIEWS_MIGRATIONS: Migration[] = [
    {
        name: '20260501_create_reviews',
        up: `
            CREATE TABLE IF NOT EXISTS reviews (
                id            TEXT PRIMARY KEY,
                workspace_id  TEXT NOT NULL,
                name          TEXT NOT NULL,
                description   TEXT,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_columns (
                id          TEXT PRIMARY KEY,
                review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                prompt      TEXT NOT NULL,
                format      TEXT NOT NULL DEFAULT 'text',
                position    INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS review_documents (
                id              TEXT PRIMARY KEY,
                review_id       TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                external_doc_id TEXT NOT NULL,
                name            TEXT NOT NULL,
                mime_type       TEXT,
                position        INTEGER NOT NULL DEFAULT 0,
                added_at        INTEGER NOT NULL,
                UNIQUE (review_id, external_doc_id)
            );

            CREATE TABLE IF NOT EXISTS review_cells (
                id                  TEXT PRIMARY KEY,
                review_id           TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
                column_id           TEXT NOT NULL REFERENCES review_columns(id) ON DELETE CASCADE,
                review_document_id  TEXT NOT NULL REFERENCES review_documents(id) ON DELETE CASCADE,
                status              TEXT NOT NULL DEFAULT 'pending',
                value               TEXT,
                citations           TEXT,
                error               TEXT,
                updated_at          INTEGER NOT NULL,
                UNIQUE (column_id, review_document_id)
            );

            CREATE INDEX IF NOT EXISTS idx_reviews_workspace
                ON reviews(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_review_columns_review
                ON review_columns(review_id, position);
            CREATE INDEX IF NOT EXISTS idx_review_documents_review
                ON review_documents(review_id, position);
            CREATE INDEX IF NOT EXISTS idx_review_cells_review
                ON review_cells(review_id);
        `,
    },
];
