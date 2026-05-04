import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Standard SQLite tables for the KB. The vec0 virtual table is created
 * separately in `prepareKbDb` because it requires the sqlite-vec extension
 * to be loaded first — which is a runtime concern, not a migration concern.
 */
export const KB_MIGRATIONS: Migration[] = [
  {
    name: '20260428_create_kb',
    up: `
      CREATE TABLE IF NOT EXISTS kb_documents (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        mime_type   TEXT NOT NULL,
        size        INTEGER NOT NULL,
        markdown    TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        owner_id    TEXT,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_documents_owner ON kb_documents(owner_id);
      CREATE INDEX IF NOT EXISTS idx_kb_documents_created ON kb_documents(created_at DESC);

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        content     TEXT NOT NULL,
        start_char  INTEGER NOT NULL,
        end_char    INTEGER NOT NULL,
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_document ON kb_chunks(document_id);
    `,
  },
];
