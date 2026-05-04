import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Document version chains and per-document head pointer.
 *
 * `document_versions` is append-only (versions are immutable; mutate by
 * adding a new version that points at the prior as `parent_id`). Source
 * tags distinguish original uploads from proposals (e.g. an LLM-generated
 * redline) and from accept/reject resolutions.
 *
 * `document_heads` is the per-logical-document "current" pointer — `restore
 * an old version` is implemented by repointing this to a prior version id.
 * The chain itself remains intact.
 *
 * Cascades: removing a row from `document_versions` does NOT cascade to
 * children — version chains are preserved across head resets. Hosts that
 * want to wipe a doc's history call `deleteAllForDocument(externalDocId)`.
 */
export const DOCUMENT_VERSIONS_MIGRATIONS: Migration[] = [
    {
        name: '20260502_create_document_versions',
        up: `
            CREATE TABLE IF NOT EXISTS document_versions (
                id              TEXT PRIMARY KEY,
                external_doc_id TEXT NOT NULL,
                parent_id       TEXT REFERENCES document_versions(id),
                source          TEXT NOT NULL CHECK (source IN ('upload', 'proposal', 'accept', 'reject')),
                storage_id      TEXT NOT NULL,
                byte_size       INTEGER,
                content_hash    TEXT,
                notes           TEXT,
                created_at      INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_document_versions_doc
                ON document_versions(external_doc_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_document_versions_parent
                ON document_versions(parent_id);

            CREATE TABLE IF NOT EXISTS document_heads (
                external_doc_id    TEXT PRIMARY KEY,
                current_version_id TEXT NOT NULL REFERENCES document_versions(id),
                updated_at         INTEGER NOT NULL
            );
        `,
    },
    {
        // Add 'generated' to the source enum (WD4 — generate_docx-produced
        // versions, which have no parent and don't fit the upload /
        // proposal / accept / reject set). SQLite CHECK constraints can't
        // be altered in place; rebuild the table with the new constraint
        // and copy data over. `legacy_alter_table = ON` keeps
        // `document_heads.current_version_id`'s FK reference targeting
        // "document_versions" by name across the rename, so the FK works
        // again as soon as we recreate the table under the original name.
        name: '20260504_document_versions_add_generated_source',
        up: `
            PRAGMA legacy_alter_table = 1;

            CREATE TABLE document_versions_new (
                id              TEXT PRIMARY KEY,
                external_doc_id TEXT NOT NULL,
                parent_id       TEXT REFERENCES document_versions(id),
                source          TEXT NOT NULL CHECK (source IN ('upload', 'proposal', 'accept', 'reject', 'generated')),
                storage_id      TEXT NOT NULL,
                byte_size       INTEGER,
                content_hash    TEXT,
                notes           TEXT,
                created_at      INTEGER NOT NULL
            );

            INSERT INTO document_versions_new
                (id, external_doc_id, parent_id, source, storage_id, byte_size, content_hash, notes, created_at)
            SELECT
                id, external_doc_id, parent_id, source, storage_id, byte_size, content_hash, notes, created_at
            FROM document_versions;

            DROP TABLE document_versions;
            ALTER TABLE document_versions_new RENAME TO document_versions;

            CREATE INDEX IF NOT EXISTS idx_document_versions_doc
                ON document_versions(external_doc_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_document_versions_parent
                ON document_versions(parent_id);

            PRAGMA legacy_alter_table = 0;
        `,
    },
];
