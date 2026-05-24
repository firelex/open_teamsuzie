export type WorkflowSource = 'system' | 'user';

/**
 * How a workflow's output is rendered when launched (WD2):
 *
 * - `'inline_chat'` (default) — the model produces prose in the chat.
 *   No special tool injection.
 * - `'generate_docx'` — the model is expected to call the
 *   `generate_docx` tool with a structured spec to produce a Word
 *   deliverable. The host runtime injects that tool and adds a
 *   system-prompt nudge so the model uses it instead of inlining or
 *   the markdown drafting tools.
 * - `'tabular_review'` — the workflow ships with a `columnConfig` and
 *   is launched as a review via the host's `from-workflow` endpoint
 *   (W3). Doesn't run via /api/chat.
 *
 * The package treats these as opaque strings; routing semantics are
 * the host's concern. The CHECK constraint in the migration enforces
 * the enum at the schema level.
 */
export type WorkflowOutputMode =
  | 'inline_chat'
  | 'generate_docx'
  | 'tabular_review';

export const WORKFLOW_OUTPUT_MODES: readonly WorkflowOutputMode[] = [
  'inline_chat',
  'generate_docx',
  'tabular_review',
];

/**
 * One column entry in a workflow's review template (W3). When a host
 * launches a workflow as a review, each entry becomes a column in the
 * created review. `format` is intentionally a free string here — the
 * workflows package stays generic; the host (suzielaw) validates the
 * value against its own cell-format enum (`@teamsuzie/grid-review`).
 */
export interface WorkflowColumnConfig {
  title: string;
  prompt: string;
  format: string;
}

/**
 * One workflow — a reusable prompt the user can launch from the
 * Library. System rows are seeded at app startup from code; user rows
 * are created via the UI. Both share the same schema; the only
 * structural difference is `ownerId`: null for system, user-id for
 * user. A future sharing layer (S workstream) lives on top of this
 * via a separate `workflow_members` table.
 */
export interface Workflow {
  id: string;
  source: WorkflowSource;
  /** Null for system rows; the user's id (typically email) for user rows. */
  ownerId: string | null;
  name: string;
  description: string;
  /** The prompt sent to the assistant when the workflow is launched. */
  prompt: string;
  /** Practice-area tags. Stored as JSON; surfaced as a string array. */
  practiceAreas: string[];
  /**
   * Optional review template. When non-null, the host can launch this
   * workflow as a review — one column per entry, run against a
   * caller-chosen set of documents. Null for free-form prompts. (W3.)
   */
  columnConfig: WorkflowColumnConfig[] | null;
  /** WD2 — see {@link WorkflowOutputMode}. */
  outputMode: WorkflowOutputMode;
  createdAt: number;
  updatedAt: number;
  /** Non-null when the workflow has been archived (still visible in "show archived"). */
  archivedAt: number | null;
}

export interface CreateUserWorkflowInput {
  ownerId: string;
  name: string;
  description?: string;
  prompt: string;
  practiceAreas?: string[];
  /** Optional review template — see `Workflow.columnConfig`. */
  columnConfig?: WorkflowColumnConfig[] | null;
  /** WD2 — defaults to `'inline_chat'` when omitted. */
  outputMode?: WorkflowOutputMode;
}

/**
 * Idempotent input for seeding system workflows at startup. The `id`
 * is stable and host-defined (e.g. the slug of the workflow's name),
 * so re-running the seed updates the row in-place rather than
 * inserting duplicates.
 */
export interface UpsertSystemWorkflowInput {
  id: string;
  name: string;
  description?: string;
  prompt: string;
  practiceAreas?: string[];
  columnConfig?: WorkflowColumnConfig[] | null;
  /** WD2 — defaults to `'inline_chat'` when omitted. */
  outputMode?: WorkflowOutputMode;
}

/**
 * Input for seedAsUserIfEmpty — same shape as UpsertSystemWorkflowInput
 * (requires `id`, all other fields optional except `name` and `prompt`)
 * but semantically these become user-owned rows, not system rows.
 */
export type WorkflowSeed = UpsertSystemWorkflowInput;

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  prompt?: string;
  practiceAreas?: string[];
  /**
   * Pass `null` to clear an existing review template; pass an array to
   * replace it; omit to leave it untouched.
   */
  columnConfig?: WorkflowColumnConfig[] | null;
  /** WD2 — omit to leave alone, or pass a new mode to replace. */
  outputMode?: WorkflowOutputMode;
}

export interface ListWorkflowsOptions {
  /**
   * Owner whose visibility to compute. User rows owned by this id are
   * included; system rows hidden by this owner are excluded; user rows
   * owned by anyone else are excluded.
   */
  ownerId: string;
  /** Default false — exclude archived rows. */
  includeArchived?: boolean;
}

/**
 * WD5 — why a version was captured. `'update'` means the row above was
 * captured immediately before a `PATCH` overwrote it; `'restore'` means
 * the user restored a prior version and the row above is the state
 * just before the restore (so the restore itself is undo-able).
 */
export type WorkflowVersionReason = 'update' | 'restore';

/**
 * One snapshot of a workflow's editable state. Captured automatically
 * on every successful update or restore. System workflows are never
 * versioned — they're code-of-truth and re-seed on boot.
 */
export interface WorkflowVersion {
  id: string;
  workflowId: string;
  name: string;
  description: string;
  prompt: string;
  practiceAreas: string[];
  columnConfig: WorkflowColumnConfig[] | null;
  outputMode: WorkflowOutputMode;
  capturedAt: number;
  /** User id (typically email) — null when the host didn't supply one. */
  capturedBy: string | null;
  reason: WorkflowVersionReason;
}
