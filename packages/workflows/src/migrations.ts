import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Workflows-as-data schema. One table for both system and user
 * workflows — they share shape, only `source` and `ownerId`
 * differ. A separate `workflow_hides` table records per-user hides
 * of system workflows so users can prune the seed catalog without
 * forking the rows.
 *
 * No foreign keys to other packages — `ownerId` is opaque to the
 * store, mirroring the loose-coupling pattern used by `@teamsuzie/chats`
 * and `@teamsuzie/grid-review`.
 */
export const WORKFLOWS_MIGRATIONS: Migration[] = [
  {
    name: '20260502_create_workflows',
    up: `
      CREATE TABLE IF NOT EXISTS workflows (
        id             TEXT PRIMARY KEY,
        source         TEXT NOT NULL CHECK (source IN ('system', 'user')),
        owner_id       TEXT,
        name           TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        prompt         TEXT NOT NULL,
        /* JSON array of strings — host renders as tags / filter facets. */
        practice_areas TEXT NOT NULL DEFAULT '[]',
        created_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL,
        archived_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_workflows_source_owner
        ON workflows(source, owner_id);
      CREATE INDEX IF NOT EXISTS idx_workflows_updated_at
        ON workflows(updated_at DESC);

      CREATE TABLE IF NOT EXISTS workflow_hides (
        workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        owner_id     TEXT NOT NULL,
        hidden_at    INTEGER NOT NULL,
        PRIMARY KEY (workflow_id, owner_id)
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_hides_owner
        ON workflow_hides(owner_id);
    `,
  },
  {
    // W3 — workflows can carry an optional column config that turns
    // them into review templates. JSON array of { title, prompt,
    // format }; null/missing means the workflow is free-form prompt.
    name: '20260503_workflows_column_config',
    up: `
      ALTER TABLE workflows ADD COLUMN column_config TEXT;
    `,
  },
  {
    // WD2 — workflows declare their output shape so the host runtime
    // can route the workflow to the right path: 'inline_chat' (default
    // — model produces prose in the chat), 'generate_docx' (model
    // calls the generate_docx tool to produce a structured Word
    // deliverable), or 'tabular_review' (host launches the workflow
    // as a review via from-workflow). Backfill: existing rows with a
    // non-null column_config get 'tabular_review'; the rest get
    // 'inline_chat'. The CHECK constraint enforces the enum at the
    // schema level so downstream code can rely on it.
    name: '20260504_workflows_output_mode',
    up: `
      ALTER TABLE workflows ADD COLUMN output_mode TEXT NOT NULL
        DEFAULT 'inline_chat'
        CHECK (output_mode IN ('inline_chat', 'generate_docx', 'tabular_review'));
      UPDATE workflows
         SET output_mode = 'tabular_review'
       WHERE column_config IS NOT NULL;
    `,
  },
  {
    // WD5 — append-only history of workflow edits. One row is inserted
    // before every successful `updateUserWorkflow`, capturing the
    // pre-edit state. Restores write a snapshot of the current state
    // and then UPDATE the live row, so the act of restoring is itself
    // versioned.
    //
    // System rows aren't versioned — they're code-of-truth and re-seed
    // on boot. The CASCADE drops history when the live row is deleted.
    name: '20260504_create_workflow_versions',
    up: `
      CREATE TABLE IF NOT EXISTS workflow_versions (
        id             TEXT PRIMARY KEY,
        workflow_id    TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        description    TEXT NOT NULL DEFAULT '',
        prompt         TEXT NOT NULL,
        practice_areas TEXT NOT NULL DEFAULT '[]',
        column_config  TEXT,
        output_mode    TEXT NOT NULL,
        captured_at    INTEGER NOT NULL,
        captured_by    TEXT,
        reason         TEXT NOT NULL CHECK (reason IN ('update', 'restore'))
      );
      CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_time
        ON workflow_versions(workflow_id, captured_at DESC);
    `,
  },
  {
    // Idempotency marker table for seedAsUserIfEmpty. One row per seed
    // key records that a given seed has already been copied into the
    // user store. On subsequent boots the seeder checks this table and
    // skips re-insertion, so user edits to seeded rows are never
    // overwritten.
    name: '20260524_workflow_seeds_applied',
    up: `
      CREATE TABLE IF NOT EXISTS workflow_seeds_applied (
        seed_key TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `,
  },
];
