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
  WorkflowSource,
} from './types.js';
import { WORKFLOW_OUTPUT_MODES } from './types.js';

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
      ]
    >(
      this.db,
      `INSERT INTO workflows
       (id, source, owner_id, name, description, prompt, practice_areas, column_config, output_mode, created_at, updated_at, archived_at)
       VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         prompt = excluded.prompt,
         practice_areas = excluded.practice_areas,
         column_config = excluded.column_config,
         output_mode = excluded.output_mode,
         updated_at = excluded.updated_at`,
    ).run(
      input.id,
      input.name,
      description,
      input.prompt,
      practiceAreas,
      columnConfig,
      outputMode,
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
      ]
    >(
      this.db,
      `INSERT INTO workflows
       (id, source, owner_id, name, description, prompt, practice_areas, column_config, output_mode, created_at, updated_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.name,
      input.description ?? '',
      input.prompt,
      JSON.stringify(input.practiceAreas ?? []),
      columnConfig,
      outputMode,
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
   */
  updateUserWorkflow(
    id: string,
    ownerId: string,
    patch: UpdateWorkflowInput,
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
    const next = {
      name: patch.name?.trim() ?? existing.name,
      description: patch.description ?? existing.description,
      prompt: patch.prompt ?? existing.prompt,
      practiceAreas: patch.practiceAreas
        ? JSON.stringify(patch.practiceAreas)
        : JSON.stringify(existing.practiceAreas),
      columnConfig: nextColumnConfigJson,
      outputMode: nextOutputMode,
    };
    prepareCached<
      [string, string, string, string, string | null, string, number, string]
    >(
      this.db,
      `UPDATE workflows
         SET name = ?, description = ?, prompt = ?, practice_areas = ?,
             column_config = ?, output_mode = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.name,
      next.description,
      next.prompt,
      next.practiceAreas,
      next.columnConfig,
      next.outputMode,
      now,
      id,
    );
    return this.get(id);
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
