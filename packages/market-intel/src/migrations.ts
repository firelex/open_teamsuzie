import type { Migration } from '@teamsuzie/db-sqlite';

export const MARKET_INTEL_MIGRATIONS: Migration[] = [
  {
    name: '20260528_create_market_intel_tables',
    up: `
      CREATE TABLE IF NOT EXISTS market_watch_runs (
        id                TEXT PRIMARY KEY,
        subject_id        TEXT NOT NULL,
        provider          TEXT NOT NULL,
        status            TEXT NOT NULL,
        categories_json   TEXT NOT NULL,
        queries_json      TEXT NOT NULL,
        not_configured    INTEGER NOT NULL DEFAULT 0,
        error             TEXT,
        created_by        TEXT NOT NULL,
        created_at        INTEGER NOT NULL,
        completed_at      INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_mwr_subject
        ON market_watch_runs(subject_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS market_watch_items (
        id                  INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id              TEXT NOT NULL REFERENCES market_watch_runs(id) ON DELETE CASCADE,
        subject_id          TEXT NOT NULL,
        category            TEXT NOT NULL,
        query               TEXT NOT NULL,
        title               TEXT NOT NULL,
        url                 TEXT NOT NULL,
        snippet             TEXT NOT NULL,
        source              TEXT,
        published_at        TEXT,
        relevance_rationale TEXT NOT NULL,
        created_at          INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mwi_subject
        ON market_watch_items(subject_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mwi_run
        ON market_watch_items(run_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_mwi_run_url_category
        ON market_watch_items(run_id, url, category);
    `,
  },
];
