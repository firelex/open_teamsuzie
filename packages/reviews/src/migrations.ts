import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Reviews-as-data schema. Two tables:
 *
 *   review_templates — named column sets. System + user rows in one
 *     table (mirroring the workflows package); `source` + `owner_id`
 *     distinguish them.
 *
 *   reviews — instantiated tabular reviews owned by a single user.
 *     `template_id` is a soft pointer (no FK) — reviews keep working
 *     even after the originating template is deleted.
 *
 * `review_seeds_applied` is the idempotency marker table used by
 * `seedAsUserIfEmpty` on templates (matching the workflows pattern).
 */
export const REVIEWS_MIGRATIONS: Migration[] = [
  {
    name: '20260524_init_reviews',
    up: `
      CREATE TABLE IF NOT EXISTS review_templates (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL CHECK (source IN ('system', 'user')),
        owner_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        columns_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_review_templates_source_owner
        ON review_templates(source, owner_id);
      CREATE INDEX IF NOT EXISTS idx_review_templates_updated_at
        ON review_templates(updated_at DESC);

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rows_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        archived_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_reviews_owner
        ON reviews(owner_id);
      CREATE INDEX IF NOT EXISTS idx_reviews_updated_at
        ON reviews(updated_at DESC);

      CREATE TABLE IF NOT EXISTS review_seeds_applied (
        seed_key TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
];
