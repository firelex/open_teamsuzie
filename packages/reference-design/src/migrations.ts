import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * SQLite schema for `ReferenceDoc` persistence + the workflow ↔ reference
 * many-to-many link. Consuming apps pass this alongside their own
 * migrations into `openDb`. Migration name preserved from drafter's
 * 2026-05-14 release so installed dbs that already ran it don't re-run.
 */
export const REFERENCE_DESIGN_MIGRATIONS: Migration[] = [
  {
    name: '20260514_create_drafter_tables',
    up: `
      CREATE TABLE IF NOT EXISTS reference_docs (
        id                 TEXT PRIMARY KEY,
        doc_type           TEXT NOT NULL,
        display_name       TEXT NOT NULL,
        source_file_path   TEXT NOT NULL,
        source_mime        TEXT NOT NULL,
        content_markdown   TEXT NOT NULL,
        design_usable      INTEGER NOT NULL DEFAULT 0,
        warnings_json      TEXT NOT NULL DEFAULT '[]',
        ingested_at        INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reference_docs_doc_type
        ON reference_docs(doc_type);

      CREATE TABLE IF NOT EXISTS workflow_references (
        workflow_id      TEXT NOT NULL,
        reference_doc_id TEXT NOT NULL REFERENCES reference_docs(id) ON DELETE CASCADE,
        PRIMARY KEY (workflow_id, reference_doc_id)
      );
    `,
  },
];
