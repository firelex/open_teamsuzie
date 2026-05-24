import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
  CreateUserReviewInput,
  CreateUserTemplateInput,
  ListReviewsOptions,
  ListTemplatesOptions,
  Review,
  ReviewColumn,
  ReviewTemplate,
  ReviewTemplateSeed,
  ReviewTemplateSource,
  UpdateReviewInput,
  UpdateTemplateInput,
  UpsertSystemTemplateInput,
} from './types.js';

interface ReviewTemplateRow {
  id: string;
  source: string;
  owner_id: string | null;
  name: string;
  description: string | null;
  columns_json: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

interface ReviewRow {
  id: string;
  template_id: string | null;
  owner_id: string;
  name: string;
  rows_json: string;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
}

export interface ReviewsStoreOptions {
  db: DatabaseInstance;
  idFactory?: () => string;
  now?: () => number;
}

/**
 * CRUD over the `review_templates` + `reviews` tables. System
 * templates are owned by the upstream code that seeds them (via
 * `upsertSystemTemplate`); user templates and reviews are created at
 * runtime via the `*User*` methods. The same row shape and read API
 * serve both system and user templates.
 */
export class ReviewsStore {
  private readonly db: DatabaseInstance;
  private readonly newId: () => string;
  private readonly clock: () => number;

  constructor(opts: ReviewsStoreOptions) {
    this.db = opts.db;
    this.newId = opts.idFactory ?? (() => randomUUID());
    this.clock = opts.now ?? (() => Date.now());
  }

  // --- Templates: system (seeded) rows ---------------------------------

  /**
   * Insert or update a system template. Used at app startup to seed a
   * code-defined catalog — re-running with the same `id` updates fields
   * rather than duplicating.
   */
  upsertSystemTemplate(input: UpsertSystemTemplateInput): ReviewTemplate {
    const now = this.clock();
    const description = input.description ?? null;
    const columnsJson = JSON.stringify(input.columns ?? []);
    prepareCached<
      [string, string, string | null, string, number, number]
    >(
      this.db,
      `INSERT INTO review_templates
         (id, source, owner_id, name, description, columns_json, created_at, updated_at, archived_at)
       VALUES (?, 'system', NULL, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         columns_json = excluded.columns_json,
         updated_at = excluded.updated_at`,
    ).run(input.id, input.name, description, columnsJson, now, now);
    return this.getTemplate(input.id)!;
  }

  /**
   * Bulk seed — convenience wrapper around `upsertSystemTemplate` plus
   * a cleanup pass that removes any system templates whose id isn't in
   * the incoming set. Use at app startup; matches "the code is the
   * source of truth for system templates" semantics.
   */
  seedSystemTemplates(
    inputs: UpsertSystemTemplateInput[],
  ): { upserted: number; removed: number } {
    const idSet = new Set(inputs.map((i) => i.id));
    const tx = this.db.transaction(() => {
      for (const input of inputs) this.upsertSystemTemplate(input);
      const stale = prepareCached<[], { id: string }>(
        this.db,
        `SELECT id FROM review_templates WHERE source = 'system'`,
      )
        .all()
        .filter((r) => !idSet.has(r.id));
      let removed = 0;
      const del = prepareCached<[string]>(
        this.db,
        `DELETE FROM review_templates WHERE id = ? AND source = 'system'`,
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
   * Seed templates as user-owned rows exactly once per `seedKey`. On the
   * first call the items are inserted with `INSERT OR IGNORE` (so any
   * template the user has already created with the same `id` is left
   * untouched) and an idempotency marker is written to
   * `review_seeds_applied`. Subsequent calls for the same `seedKey` are
   * no-ops — the marker exists so the user's edits and deletes are
   * preserved across restarts.
   *
   * Use this for copy-on-first-run defaults ("demo" templates, starter
   * column sets, etc.). For immutable system templates that always
   * reflect the code-of-truth, use `seedSystemTemplates` /
   * `upsertSystemTemplate` instead.
   *
   * Note: seed data is template-shaped — this writes to
   * `review_templates`, not `reviews`.
   */
  seedAsUserIfEmpty(
    seedKey: string,
    items: ReviewTemplateSeed[],
    ownerId: string,
  ): void {
    const marker = prepareCached<[string], { seed_key: string }>(
      this.db,
      'SELECT seed_key FROM review_seeds_applied WHERE seed_key = ?',
    ).get(seedKey);
    if (marker) return;

    const insertItem = prepareCached<
      [string, string, string, string | null, string, number, number]
    >(
      this.db,
      `INSERT OR IGNORE INTO review_templates
         (id, source, owner_id, name, description, columns_json, created_at, updated_at, archived_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?, NULL)`,
    );
    const insertMarker = prepareCached<[string, number]>(
      this.db,
      'INSERT INTO review_seeds_applied (seed_key, applied_at) VALUES (?, ?)',
    );

    const now = this.clock();
    const tx = this.db.transaction(() => {
      for (const item of items) {
        insertItem.run(
          item.id,
          ownerId,
          item.name,
          item.description ?? null,
          JSON.stringify(item.columns ?? []),
          now,
          now,
        );
      }
      insertMarker.run(seedKey, now);
    });
    tx();
  }

  // --- Templates: user rows --------------------------------------------

  createUserTemplate(input: CreateUserTemplateInput): ReviewTemplate {
    const id = this.newId();
    const now = this.clock();
    prepareCached<
      [string, string, string, string | null, string, number, number]
    >(
      this.db,
      `INSERT INTO review_templates
         (id, source, owner_id, name, description, columns_json, created_at, updated_at)
       VALUES (?, 'user', ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.ownerId,
      input.name,
      input.description ?? null,
      JSON.stringify(input.columns ?? []),
      now,
      now,
    );
    return this.getTemplate(id)!;
  }

  /**
   * Patch a user-owned template. System templates are read-only — to
   * "edit" a system template, the caller should fork it into a user
   * template with the desired changes. Returns null when the id
   * doesn't exist or the row isn't owned by `ownerId`.
   */
  updateUserTemplate(
    id: string,
    ownerId: string,
    patch: UpdateTemplateInput,
  ): ReviewTemplate | null {
    const existing = this.getTemplate(id);
    if (!existing) return null;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return null;
    const now = this.clock();
    const next = {
      name: patch.name?.trim() ?? existing.name,
      description:
        patch.description === undefined
          ? existing.description ?? null
          : patch.description,
      columns: patch.columns
        ? JSON.stringify(patch.columns)
        : JSON.stringify(existing.columns),
    };
    prepareCached<[string, string | null, string, number, string]>(
      this.db,
      `UPDATE review_templates
         SET name = ?, description = ?, columns_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(next.name, next.description, next.columns, now, id);
    return this.getTemplate(id);
  }

  /**
   * Delete a user template. System templates can't be deleted via this
   * path — `seedSystemTemplates` is the only way to remove them.
   */
  deleteUserTemplate(id: string, ownerId: string): boolean {
    const existing = this.getTemplate(id);
    if (!existing) return false;
    if (existing.source !== 'user' || existing.ownerId !== ownerId) return false;
    const result = prepareCached<[string]>(
      this.db,
      `DELETE FROM review_templates WHERE id = ?`,
    ).run(id);
    return result.changes > 0;
  }

  // --- Templates: reads ------------------------------------------------

  getTemplate(id: string): ReviewTemplate | null {
    const row = prepareCached<[string], ReviewTemplateRow>(
      this.db,
      `SELECT * FROM review_templates WHERE id = ?`,
    ).get(id);
    return row ? rowToTemplate(row) : null;
  }

  /**
   * Templates visible to `ownerId`: every system template, plus every
   * user template owned by this user. Sorted `name ASC` for
   * deterministic library ordering.
   */
  listTemplatesVisible(opts: ListTemplatesOptions): ReviewTemplate[] {
    const archivedClause = opts.includeArchived
      ? ''
      : ' AND t.archived_at IS NULL';
    const rows = prepareCached<[string], ReviewTemplateRow>(
      this.db,
      `SELECT t.* FROM review_templates t
        WHERE (
          t.source = 'system'
          OR (t.source = 'user' AND t.owner_id = ?)
        )${archivedClause}
        ORDER BY t.source, t.name COLLATE NOCASE`,
    ).all(opts.ownerId);
    return rows.map(rowToTemplate);
  }

  /** All templates of a given source — for diagnostics or admin pages. */
  listTemplatesBySource(source: ReviewTemplateSource): ReviewTemplate[] {
    return prepareCached<[string], ReviewTemplateRow>(
      this.db,
      `SELECT * FROM review_templates WHERE source = ? ORDER BY name COLLATE NOCASE`,
    )
      .all(source)
      .map(rowToTemplate);
  }

  // --- Reviews: CRUD ---------------------------------------------------

  createUserReview(input: CreateUserReviewInput): Review {
    const id = this.newId();
    const now = this.clock();
    prepareCached<
      [string, string | null, string, string, string, number, number]
    >(
      this.db,
      `INSERT INTO reviews
         (id, template_id, owner_id, name, rows_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.templateId ?? null,
      input.ownerId,
      input.name,
      JSON.stringify(input.rows ?? []),
      now,
      now,
    );
    return this.getReview(id, input.ownerId)!;
  }

  updateUserReview(
    id: string,
    ownerId: string,
    patch: UpdateReviewInput,
  ): Review | null {
    const existing = this.getReview(id, ownerId);
    if (!existing) return null;
    const now = this.clock();
    const next = {
      name: patch.name?.trim() ?? existing.name,
      rows: patch.rows
        ? JSON.stringify(patch.rows)
        : JSON.stringify(existing.rows),
    };
    prepareCached<[string, string, number, string]>(
      this.db,
      `UPDATE reviews
         SET name = ?, rows_json = ?, updated_at = ?
       WHERE id = ?`,
    ).run(next.name, next.rows, now, id);
    return this.getReview(id, ownerId);
  }

  deleteUserReview(id: string, ownerId: string): boolean {
    const existing = this.getReview(id, ownerId);
    if (!existing) return false;
    const result = prepareCached<[string]>(
      this.db,
      `DELETE FROM reviews WHERE id = ?`,
    ).run(id);
    return result.changes > 0;
  }

  // --- Reviews: reads --------------------------------------------------

  /**
   * Fetch a single review by id. Reviews are always user-private — the
   * row is only returned when `ownerId` matches; mismatches read as
   * null (same shape as unknown id).
   */
  getReview(id: string, ownerId: string): Review | null {
    const row = prepareCached<[string], ReviewRow>(
      this.db,
      `SELECT * FROM reviews WHERE id = ?`,
    ).get(id);
    if (!row) return null;
    if (row.owner_id !== ownerId) return null;
    return rowToReview(row);
  }

  /**
   * Reviews owned by `ownerId`, sorted newest-updated first. Reviews
   * are never shared in this version — visibility is owner-only.
   */
  listReviewsVisible(opts: ListReviewsOptions): Review[] {
    const archivedClause = opts.includeArchived
      ? ''
      : ' AND archived_at IS NULL';
    const rows = prepareCached<[string], ReviewRow>(
      this.db,
      `SELECT * FROM reviews
        WHERE owner_id = ?${archivedClause}
        ORDER BY updated_at DESC`,
    ).all(opts.ownerId);
    return rows.map(rowToReview);
  }
}

function rowToTemplate(row: ReviewTemplateRow): ReviewTemplate {
  let columns: ReviewColumn[] = [];
  try {
    const parsed = JSON.parse(row.columns_json);
    if (Array.isArray(parsed)) {
      columns = parsed.filter(
        (x): x is ReviewColumn =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as ReviewColumn).id === 'string' &&
          typeof (x as ReviewColumn).title === 'string' &&
          typeof (x as ReviewColumn).prompt === 'string' &&
          typeof (x as ReviewColumn).format === 'string',
      );
    }
  } catch {
    // Tolerate bad JSON — surface as empty array rather than failing the read.
  }
  return {
    id: row.id,
    source: row.source as ReviewTemplateSource,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description ?? undefined,
    columns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function rowToReview(row: ReviewRow): Review {
  let rows: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(row.rows_json);
    if (Array.isArray(parsed)) {
      rows = parsed.filter(
        (x): x is Record<string, unknown> =>
          !!x && typeof x === 'object' && !Array.isArray(x),
      );
    }
  } catch {
    // Tolerate bad JSON — surface as empty array.
  }
  return {
    id: row.id,
    templateId: row.template_id,
    ownerId: row.owner_id,
    name: row.name,
    rows,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
