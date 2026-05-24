import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
  CreateUserWorkflowInput,
  ListWorkflowsOptions,
  UpdateWorkflowInput,
  UpsertSystemWorkflowInput,
  Workflow,
  WorkflowColumnConfig,
  WorkflowOutputMode,
  WorkflowSeed,
  WorkflowSource,
  WorkflowVersion,
  WorkflowVersionReason,
} from './types.js';
import { WORKFLOW_OUTPUT_MODES } from './types.js';

interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  name: string;
  description: string;
  prompt: string;
  practice_areas: string;
  column_config: string | null;
  output_mode: string;
  captured_at: number;
  captured_by: string | null;
  reason: string;
}

function normalizeOutputMode(
  raw: WorkflowOutputMode | undefined,
  fallbackForColumnConfig: boolean,
): WorkflowOutputMode {
  if (raw && WORKFLOW_OUTPUT_MODES.includes(raw)) return raw;
  // Treat omitted output_mode as 'tabular_review' if the row has a
  // column config, otherwise 'inline_chat'. Matches the migration's
  // backfill so callers don't have to set output_mode redundantly when
  // they pass a column config.
  return fallbackForColumnConfig ? 'tabular_review' : 'inline_chat';
}

interface WorkflowRow {
  id: string;
  source: string;
  owner_id: string | null;
  name: string;
  description: string;
  prompt: string;
  practice_areas: string;
  column_config: string | null;
  output_mode: string;
  /** SQLite stores the featured flag as 0/1 — projected to boolean on read. */
  featured: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface WorkflowsStoreOptions {
  db: DatabaseInstance;
  idFactory?: () => string;
  now?: () => number;
}

/**
 * CRUD over the `workflows` + `workflow_hides` tables. System rows
 * are owned by the upstream code that seeds them (via `upsertSystem`);
 * user rows are created at runtime via `createUserWorkflow`. The same
 * row shape and read API serve both. Visibility (`listVisible`) merges
 * the two while honoring per-user hides of system rows.
 */
export class WorkflowsStore {
  private readonly db: DatabaseInstance;
  private readonly newId: () => string;
  private readonly clock: () => number;

  constructor(opts: WorkflowsStoreOptions) {
    this.db = opts.db;
    this.newId = opts.idFactory ?? (() => randomUUID());
    this.clock = opts.now ?? (() => Date.now());
  }

  // --- System (seeded) rows --------------------------------------------

  /**
   * Insert or update a system workflow. Used at app startup to seed
   * a code-defined catalog into the DB — re-running the seed with the
   * same `id` updates fields rather than duplicating the row, so
   * editing the seeds upstream propagates to existing installs on the
   * next boot.
   */
  upsertSystem(input: UpsertSystemWorkflowInput): Workflow {
    const now = this.clock();
    const description = input.description ?? '';
    const practiceAreas = JSON.stringify(input.practiceAreas ?? []);
    const columnConfig =
      input.columnConfig === undefined || input.columnConfig === null
        ? null
        : JSON.stringify(input.columnConfig);
    const outputMode = normalizeOutputMode(
      input.outputMode,
      columnConfig !== null,
    );
    const featured = input.featured ? 1 : 0;
    prepareCached<
      [
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        number,
        number,
        number,
      ]
    >(
      this.db,
      `INSERT INTO workflows
       (id, source, owner_id, name, description, prompt, practice_areas, column_config, output_mode, featured, created_at, updated_at, archived_at)
       VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         prompt = excluded.prompt,
         practice_areas = excluded.practice_areas,
         column_config = excluded.column_config,
         output_mode = excluded.output_mode,
         featured = excluded.featured,
         updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.name,
      description,
      input.prompt,
      practiceAreas,
      columnConfig,
      outputMode,
      featured,
      now,
      now,
    );
    return this.get(input.id)!;
  }

  /**
   * Bulk seed — convenience wrapper around `upsertSystem` plus a
   * cleanup pass that removes any system rows whose id isn't in the
   * incoming set. Use at app startup; matches "the code is the source
   * of truth for system workflows" semantics.
   */
  seedSystem(inputs: UpsertSystemWorkflowInput[]): { upserted: number; removed: number } {
    const idSet = new Set(inputs.map((i) => i.id));
    const tx = this.db.transaction(() => {
      for (const input of inputs) this.upsertSystem(input);
      // Drop system rows no longer in the seed list.
      const stale = prepareCached<[], { id: string }>(
        this.db,
        `SELECT id FROM workflows WHERE source = 'system'`,
      )
        .all()
        .filter((r) => !idSet.has(r.id));
      let removed = 0;
      const del = prepareCached<[string]>(
        this.db,
        `DELETE FROM workflows WHERE id = ? AND source = 'system'`,
      );
      for (const r of stale) {
        del.run(r.id);
        removed += 1;
      }
      return { upserted: inputs.length, removed };
    });
    return tx();
  }

  /**
   * Seed items as user-owned rows exactly once per `seedKey`. On the first
   * call the items are inserted with `INSERT OR IGNORE` (so any row the user
   * has already created with the same `id` is left untouched) and an
   * idempotency marker is written to `workflow_seeds_applied`. Subsequent
   * calls for the same `seedKey` are no-ops — the marker already exists so
   * the user's edits and deletes are preserved across restarts.
   *
   * Use this for copy-on-first-run defaults ("demo" prompts, starter
   * templates, etc.).  For immutable system rows that always reflect the
   * code-of-truth, use `seedSystem` / `upsertSystem` instead.
   */
  seedAsUserIfEmpty(seedKey: string, items: WorkflowSeed[], ownerId: string): void {
    const marker = prepareCached<[string], { seed_key: string }>(
      this.db,
      'SELECT seed_key FROM workflow_seeds_applied WHERE seed_key = ?',
    ).get(seedKey);
    if (marker) return;

    const insertItem = prepareCached<
      [string, string, string, string, string, string, string | null, string, number, number, number]
    >(
      this.db,
      `INSERT OR IGNORE INTO workflows
         (id, source, owner_id, name, description, prompt, practice_areas, column_config, output_mode, featured, created_at, updated_at, archived_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const insertMarker = prepareCached<[string, number]>(
      this.db,
      'INSERT INTO workflow_seeds_applied (seed_key, applied_at) VALUES (?, ?)',
    );

    const now = this.clock();
    const tx = this.db.transaction(() => {
      for (const item of items) {
        const columnConfig =
          item.columnConfig === undefined || item.columnConfig === null
            ? null
            : JSON.stringify(item.columnConfig);
        const outputMode = normalizeOutputMode(item.outputMode, columnConfig !== null);
        insertItem.run(
          item.id,
          ownerId,
          item.name,
          item.description ?? '',
          item.prompt,
          JSON.stringify(item.practiceAreas ?? []),
          columnConfig,
          outputMode,
          item.featured ? 1 : 0,
          now,
          now,
        );
      }
      insertMarker.run(seedKey, now);
    });
    tx();
  }

  // --- User rows --------------------------------------------------------

  createUserWorkflow(input: CreateUserWorkflowInput): Workflow {
    const id = this.newId();
    const now = this.clock();
    const columnConfig =
      input.columnConfig === undefined || input.columnConfig === null
        ? null
        : JSON.stringify(input.columnConfig);
    const outputMode = normalizeOutputMode(
      input.outputMode,
      columnConfig !== null,
    );
    const featured = input.featured ? 1 : 0;
    prepareCached<
      [
        string,
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        number,
        number,
        number,
      ]
    >(
      this.db,
      `INSERT INTO workflows
       (id, source, owner_id, name, description, prompt, practice_areas, column_config, output_mode, featured, created_at, updated_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.name,
      input.description ?? '',
      input.prompt,
      JSON.stringify(input.practiceAreas ?? []),
      columnConfig,
      outputMode,
      featured,
      now,
      now,
    );
    return this.get(id)!;
  }

  /**
   * Patch a workflow. System rows are read-only — to "edit" a system
   * workflow, the caller should fork it into a user row with the
   * desired changes (the host can offer that as a UI affordance).
   * Returns null when the id doesn't exist or the row isn't owned by
   * `ownerId`.
   *
   * WD5 — captures a `workflow_versions` snapshot of the pre-edit
   * state immediately before applying the patch. The capture and
   * update happen in a single transaction so a snapshot is never
   * orphaned on update failure.
   */
  updateUserWorkflow(
    id: string,
    ownerId: string,
    patch: UpdateWorkflowInput,
    capturedBy?: string | null,
  ): Workflow | null {
    const existing = this.get(id);
    if (!existing) return null;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return null;
    const now = this.clock();
    // `columnConfig` is tri-valued: undefined → leave alone, null →
    // clear, array → replace. The other fields use the simpler
    // "undefined → leave alone, defined → replace" pattern.
    const nextColumnConfigJson =
      patch.columnConfig === undefined
        ? existing.columnConfig === null
          ? null
          : JSON.stringify(existing.columnConfig)
        : patch.columnConfig === null
          ? null
          : JSON.stringify(patch.columnConfig);
    const nextOutputMode: WorkflowOutputMode =
      patch.outputMode && WORKFLOW_OUTPUT_MODES.includes(patch.outputMode)
        ? patch.outputMode
        : existing.outputMode;
    const nextFeatured =
      patch.featured === undefined ? (existing.featured ? 1 : 0) : patch.featured ? 1 : 0;
    const next = {
      name: patch.name?.trim() ?? existing.name,
      description: patch.description ?? existing.description,
      prompt: patch.prompt ?? existing.prompt,
      practiceAreas: patch.practiceAreas
        ? JSON.stringify(patch.practiceAreas)
        : JSON.stringify(existing.practiceAreas),
      columnConfig: nextColumnConfigJson,
      outputMode: nextOutputMode,
      featured: nextFeatured,
    };
    const tx = this.db.transaction(() => {
      this.insertVersionFromExisting(existing, capturedBy ?? null, 'update', now);
      prepareCached<
        [string, string, string, string, string | null, string, number, number, string]
      >(
        this.db,
        `UPDATE workflows
           SET name = ?, description = ?, prompt = ?, practice_areas = ?,
               column_config = ?, output_mode = ?, featured = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        next.name,
        next.description,
        next.prompt,
        next.practiceAreas,
        next.columnConfig,
        next.outputMode,
        next.featured,
        now,
        id,
      );
    });
    tx();
    return this.get(id);
  }

  // --- Versioning (WD5) -------------------------------------------------

  /**
   * Versions for a user-owned workflow, newest first. System workflows
   * never have history (their state is owned by the seed). Returns an
   * empty array for unknown ids or when the caller isn't the owner.
   */
  listVersions(id: string, ownerId: string): WorkflowVersion[] {
    const existing = this.get(id);
    if (!existing) return [];
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return [];
    const rows = prepareCached<[string], WorkflowVersionRow>(
      this.db,
      // ROWID is SQLite's hidden monotonically-increasing per-INSERT id.
      // Used as a tiebreaker so two snapshots written in the same
      // millisecond (common for restore-after-update sequences) order
      // by insertion order, not by random UUID lexicographic compare.
      `SELECT * FROM workflow_versions
         WHERE workflow_id = ?
         ORDER BY captured_at DESC, ROWID DESC`,
    ).all(id);
    return rows.map(rowToVersion);
  }

  /**
   * Restore a workflow to a prior captured state. Captures the current
   * state with `reason = 'restore'` first, then overwrites the live row
   * with the version's fields. Returns the post-restore workflow, or
   * null when the version doesn't belong to this workflow / owner.
   */
  restoreVersion(
    workflowId: string,
    versionId: string,
    ownerId: string,
    capturedBy?: string | null,
  ): Workflow | null {
    const existing = this.get(workflowId);
    if (!existing) return null;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return null;
    const versionRow = prepareCached<[string, string], WorkflowVersionRow>(
      this.db,
      `SELECT * FROM workflow_versions WHERE id = ? AND workflow_id = ?`,
    ).get(versionId, workflowId);
    if (!versionRow) return null;
    const now = this.clock();
    const tx = this.db.transaction(() => {
      this.insertVersionFromExisting(existing, capturedBy ?? null, 'restore', now);
      prepareCached<
        [string, string, string, string, string | null, string, number, string]
      >(
        this.db,
        `UPDATE workflows
           SET name = ?, description = ?, prompt = ?, practice_areas = ?,
               column_config = ?, output_mode = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        versionRow.name,
        versionRow.description,
        versionRow.prompt,
        versionRow.practice_areas,
        versionRow.column_config,
        versionRow.output_mode,
        now,
        workflowId,
      );
    });
    tx();
    return this.get(workflowId);
  }

  /** Internal: write one snapshot row from a `Workflow`. */
  private insertVersionFromExisting(
    existing: Workflow,
    capturedBy: string | null,
    reason: WorkflowVersionReason,
    capturedAt: number,
  ): void {
    prepareCached<
      [
        string,
        string,
        string,
        string,
        string,
        string,
        string | null,
        string,
        number,
        string | null,
        string,
      ]
    >(
      this.db,
      `INSERT INTO workflow_versions
         (id, workflow_id, name, description, prompt, practice_areas,
          column_config, output_mode, captured_at, captured_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      this.newId(),
      existing.id,
      existing.name,
      existing.description,
      existing.prompt,
      JSON.stringify(existing.practiceAreas),
      existing.columnConfig === null
        ? null
        : JSON.stringify(existing.columnConfig),
      existing.outputMode,
      capturedAt,
      capturedBy,
      reason,
    );
  }

  archive(id: string, ownerId: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    // System rows: any user can archive their *visibility* via hide.
    // The archive flag is for user rows the owner has retired.
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return false;
    const now = this.clock();
    prepareCached<[number, number, string]>(
      this.db,
      `UPDATE workflows SET archived_at = ?, updated_at = ? WHERE id = ?`,
    ).run(now, now, id);
    return true;
  }

  unarchive(id: string, ownerId: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return false;
    prepareCached<[number, string]>(
      this.db,
      `UPDATE workflows SET archived_at = NULL, updated_at = ? WHERE id = ?`,
    ).run(this.clock(), id);
    return true;
  }

  /**
   * Delete a user workflow. System rows can't be deleted — to remove
   * a system workflow from a user's view, use `hide` instead.
   */
  deleteUserWorkflow(id: string, ownerId: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return false;
    const result = prepareCached<[string]>(
      this.db,
      `DELETE FROM workflows WHERE id = ?`,
    ).run(id);
    return result.changes > 0;
  }

  // --- Hides (per-user soft deletes for system rows) -------------------

  /**
   * Hide a workflow from a user's `listVisible` results. Idempotent —
   * re-hiding doesn't error. Hiding a user-owned row works mechanically
   * but the semantically-cleaner move for the owner is `archive`;
   * hide is for system rows.
   */
  hide(id: string, ownerId: string): void {
    prepareCached<[string, string, number]>(
      this.db,
      `INSERT INTO workflow_hides (workflow_id, owner_id, hidden_at)
       VALUES (?, ?, ?)
       ON CONFLICT(workflow_id, owner_id) DO NOTHING`,
    ).run(id, ownerId, this.clock());
  }

  unhide(id: string, ownerId: string): boolean {
    const result = prepareCached<[string, string]>(
      this.db,
      `DELETE FROM workflow_hides WHERE workflow_id = ? AND owner_id = ?`,
    ).run(id, ownerId);
    return result.changes > 0;
  }

  /**
   * Hide flags for a user — useful for a "Hidden workflows" section
   * with one-click unhide. Only returns rows whose underlying workflow
   * still exists.
   */
  listHiddenIds(ownerId: string): string[] {
    return prepareCached<[string], { workflow_id: string }>(
      this.db,
      `SELECT h.workflow_id
         FROM workflow_hides h
         JOIN workflows w ON w.id = h.workflow_id
        WHERE h.owner_id = ?`,
    )
      .all(ownerId)
      .map((r) => r.workflow_id);
  }

  // --- Reads ------------------------------------------------------------

  get(id: string): Workflow | null {
    const row = prepareCached<[string], WorkflowRow>(
      this.db,
      `SELECT * FROM workflows WHERE id = ?`,
    ).get(id);
    return row ? rowToWorkflow(row) : null;
  }

  /**
   * Workflows visible to `ownerId`: every system row not hidden by
   * this user, plus every user row owned by this user. Sorted
   * `name ASC` for deterministic library ordering — host can re-sort
   * if needed.
   */
  listVisible(opts: ListWorkflowsOptions): Workflow[] {
    const archivedClause = opts.includeArchived
      ? ''
      : ' AND w.archived_at IS NULL';
    const rows = prepareCached<[string, string], WorkflowRow>(
      this.db,
      `SELECT w.* FROM workflows w
        WHERE (
          (w.source = 'system'
           AND NOT EXISTS (
             SELECT 1 FROM workflow_hides h
              WHERE h.workflow_id = w.id AND h.owner_id = ?
           ))
          OR (w.source = 'user' AND w.owner_id = ?)
        )${archivedClause}
        ORDER BY w.source, w.name COLLATE NOCASE`,
    ).all(opts.ownerId, opts.ownerId);
    return rows.map(rowToWorkflow);
  }

  /** All rows of a given source — for diagnostics or admin pages. */
  listBySource(source: WorkflowSource): Workflow[] {
    return prepareCached<[string], WorkflowRow>(
      this.db,
      `SELECT * FROM workflows WHERE source = ? ORDER BY name COLLATE NOCASE`,
    )
      .all(source)
      .map(rowToWorkflow);
  }
}

function rowToVersion(row: WorkflowVersionRow): WorkflowVersion {
  let practiceAreas: string[] = [];
  try {
    const parsed = JSON.parse(row.practice_areas);
    if (Array.isArray(parsed)) practiceAreas = parsed.filter((x) => typeof x === 'string');
  } catch {
    /* tolerate corrupt JSON */
  }
  let columnConfig: WorkflowColumnConfig[] | null = null;
  if (row.column_config) {
    try {
      const parsed = JSON.parse(row.column_config);
      if (Array.isArray(parsed)) {
        columnConfig = parsed.filter(
          (x): x is WorkflowColumnConfig =>
            !!x &&
            typeof x === 'object' &&
            typeof (x as WorkflowColumnConfig).title === 'string' &&
            typeof (x as WorkflowColumnConfig).prompt === 'string' &&
            typeof (x as WorkflowColumnConfig).format === 'string',
        );
      }
    } catch {
      /* tolerate corrupt JSON */
    }
  }
  return {
    id: row.id,
    workflowId: row.workflow_id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    practiceAreas,
    columnConfig,
    outputMode: WORKFLOW_OUTPUT_MODES.includes(
      row.output_mode as WorkflowOutputMode,
    )
      ? (row.output_mode as WorkflowOutputMode)
      : 'inline_chat',
    capturedAt: row.captured_at,
    capturedBy: row.captured_by,
    reason: row.reason === 'restore' ? 'restore' : 'update',
  };
}

function rowToWorkflow(row: WorkflowRow): Workflow {
  let practiceAreas: string[] = [];
  try {
    const parsed = JSON.parse(row.practice_areas);
    if (Array.isArray(parsed)) practiceAreas = parsed.filter((x) => typeof x === 'string');
  } catch {
    // Tolerate bad JSON — surface as empty array rather than failing the read.
  }
  let columnConfig: WorkflowColumnConfig[] | null = null;
  if (row.column_config) {
    try {
      const parsed = JSON.parse(row.column_config);
      if (Array.isArray(parsed)) {
        columnConfig = parsed.filter(
          (x): x is WorkflowColumnConfig =>
            !!x &&
            typeof x === 'object' &&
            typeof (x as WorkflowColumnConfig).title === 'string' &&
            typeof (x as WorkflowColumnConfig).prompt === 'string' &&
            typeof (x as WorkflowColumnConfig).format === 'string',
        );
      }
    } catch {
      /* tolerate corrupt JSON; expose as null */
    }
  }
  return {
    id: row.id,
    source: row.source as WorkflowSource,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    practiceAreas,
    columnConfig,
    outputMode: WORKFLOW_OUTPUT_MODES.includes(
      row.output_mode as WorkflowOutputMode,
    )
      ? (row.output_mode as WorkflowOutputMode)
      : 'inline_chat',
    featured: row.featured === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
