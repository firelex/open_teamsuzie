import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Schema for tabular document review:
 *   - `grid_reviews` belongs to a host-side parent (matter / workspace / project).
 *     The `workspace_id` column is opaque — no cross-package FK. The host
 *     app is responsible for cascading on parent delete (typical: when a
 *     matter is deleted, list+delete its reviews).
 *   - `grid_review_columns` — the prompted questions / extractions, in display order.
 *   - `grid_review_documents` — rows in the grid; pointer into the host doc store.
 *   - `grid_review_cells` — the N×M output grid. Sparse (rows only when populated).
 *
 * Within a review, deletes cascade: removing a column wipes its cells;
 * removing a row-document wipes its cells; removing a review wipes everything.
 *
 * The `grid_` prefix is deliberate: a host that also runs @teamsuzie/reviews
 * (flat library-style reviews) opens a different `reviews` table on the
 * same database. Sharing one schema name across both packages would silently
 * break migrations on whichever ran first (the second package's CREATE
 * TABLE IF NOT EXISTS skips, then index-on-missing-column fails). Different
 * names keep the two packages independent.
 */
export const REVIEWS_MIGRATIONS: Migration[] = [
    {
        name: '20260501_create_grid_reviews',
        up: `
            CREATE TABLE IF NOT EXISTS grid_reviews (
                id            TEXT PRIMARY KEY,
                workspace_id  TEXT NOT NULL,
                name          TEXT NOT NULL,
                description   TEXT,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS grid_review_columns (
                id          TEXT PRIMARY KEY,
                review_id   TEXT NOT NULL REFERENCES grid_reviews(id) ON DELETE CASCADE,
                title       TEXT NOT NULL,
                prompt      TEXT NOT NULL,
                format      TEXT NOT NULL DEFAULT 'text',
                position    INTEGER NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS grid_review_documents (
                id              TEXT PRIMARY KEY,
                review_id       TEXT NOT NULL REFERENCES grid_reviews(id) ON DELETE CASCADE,
                external_doc_id TEXT NOT NULL,
                name            TEXT NOT NULL,
                mime_type       TEXT,
                position        INTEGER NOT NULL DEFAULT 0,
                added_at        INTEGER NOT NULL,
                UNIQUE (review_id, external_doc_id)
            );

            CREATE TABLE IF NOT EXISTS grid_review_cells (
                id                  TEXT PRIMARY KEY,
                review_id           TEXT NOT NULL REFERENCES grid_reviews(id) ON DELETE CASCADE,
                column_id           TEXT NOT NULL REFERENCES grid_review_columns(id) ON DELETE CASCADE,
                review_document_id  TEXT NOT NULL REFERENCES grid_review_documents(id) ON DELETE CASCADE,
                status              TEXT NOT NULL DEFAULT 'pending',
                value               TEXT,
                citations           TEXT,
                error               TEXT,
                updated_at          INTEGER NOT NULL,
                UNIQUE (column_id, review_document_id)
            );

            CREATE INDEX IF NOT EXISTS idx_grid_reviews_workspace
                ON grid_reviews(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_grid_review_columns_review
                ON grid_review_columns(review_id, position);
            CREATE INDEX IF NOT EXISTS idx_grid_review_documents_review
                ON grid_review_documents(review_id, position);
            CREATE INDEX IF NOT EXISTS idx_grid_review_cells_review
                ON grid_review_cells(review_id);
        `,
    },
];
