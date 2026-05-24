/**
 * Cell-value format hints for review columns. The store treats these
 * opaquely — the host UI uses the hint to pick an editor / renderer
 * (e.g. number input, date picker, tag chip). Stored as a free string
 * on the column so future formats can be added without a migration;
 * the union here is just the set the package itself knows about.
 */
export type CellFormat =
  | 'text'
  | 'number'
  | 'boolean'
  | 'date'
  | 'tags'
  | 'currency';

/**
 * One column definition on a review template. `id` is stable across
 * template edits so review rows can keep referring to it; `prompt` is
 * a free-form instruction the host can ship to the model when
 * populating cells.
 */
export interface ReviewColumn {
  id: string;
  title: string;
  prompt: string;
  format: CellFormat;
}

/**
 * Idempotent input for seeding a template. Mirrors the workflows
 * seed shape — stable `id`, name, optional description, plus the
 * template-specific `columns` array.
 */
export interface ReviewTemplateSeed {
  id: string;
  name: string;
  description?: string;
  columns: ReviewColumn[];
}

export type ReviewTemplateSource = 'system' | 'user';

/**
 * A named column set the user can instantiate as a tabular review.
 * System templates are seeded from code at boot; user templates are
 * created via the UI. Same shape and read path for both — the only
 * structural difference is `source` + `ownerId` (null for system).
 */
export interface ReviewTemplate extends ReviewTemplateSeed {
  source: ReviewTemplateSource;
  /** Null for system templates; the user's id (typically email) for user templates. */
  ownerId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Non-null when the template has been archived (still visible in "show archived"). */
  archivedAt: number | null;
}

export interface CreateUserTemplateInput {
  ownerId: string;
  name: string;
  description?: string;
  columns: ReviewColumn[];
}

/**
 * Idempotent input for seeding system templates at startup. Stable
 * `id` (host-defined slug) so re-running the seed updates the row
 * in-place rather than inserting duplicates.
 */
export interface UpsertSystemTemplateInput {
  id: string;
  name: string;
  description?: string;
  columns: ReviewColumn[];
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  /** Pass an array to replace the column set; omit to leave it untouched. */
  columns?: ReviewColumn[];
}

export interface ListTemplatesOptions {
  /**
   * Owner whose visibility to compute. User templates owned by this id
   * are included; system templates are included unconditionally; user
   * templates owned by anyone else are excluded.
   */
  ownerId: string;
  /** Default false — exclude archived rows. */
  includeArchived?: boolean;
}

/**
 * One instantiated review — a name, an optional template reference,
 * and a row set. Each row is a free-form record keyed by column id
 * (or any other host-chosen key) so the package stays out of the
 * cell-value validation business.
 */
export interface Review {
  id: string;
  /** Null when the review was created from scratch (no template). */
  templateId: string | null;
  /** User id (typically email) — reviews are always user-owned. */
  ownerId: string;
  name: string;
  rows: Array<Record<string, unknown>>;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

export interface CreateUserReviewInput {
  ownerId: string;
  name: string;
  /** Optional — link to the template the review was instantiated from. */
  templateId?: string | null;
  /** Optional initial rows; defaults to []. */
  rows?: Array<Record<string, unknown>>;
}

export interface UpdateReviewInput {
  name?: string;
  /** Pass an array to replace the row set; omit to leave it untouched. */
  rows?: Array<Record<string, unknown>>;
}

export interface ListReviewsOptions {
  ownerId: string;
  /** Default false — exclude archived rows. */
  includeArchived?: boolean;
}
