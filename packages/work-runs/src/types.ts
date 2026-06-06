/**
 * Status of a work run.
 *
 * - `running`  — actively claiming/processing items.
 * - `paused`   — deliberately halted by a user; can be resumed by hand.
 * - `blocked`  — paused on a specific item that needs a decision or input.
 * - `completed`/`failed` — terminal.
 */
export type WorkRunStatus = 'running' | 'paused' | 'blocked' | 'completed' | 'failed';

/**
 * One unit of work, scoped to a host-defined `subjectId` (project id in a
 * project-shaped host, user id elsewhere). `mode` and `scope` are opaque
 * strings owned by the host — the package does not interpret them, so
 * different departments can pick their own vocabularies (single_ticket,
 * ready_queue, inbox_triage, …) without changes here.
 *
 * Items the run touches are tracked as bag-of-id lists. `activeItemId`
 * is the at-most-one currently-claimed item; the three id arrays are
 * the running tallies of what was completed / blocked / created during
 * the run.
 */
export interface WorkRun {
  id: string;
  subjectId: string;
  status: WorkRunStatus;
  mode: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  startedBy: string;
  activeItemId: string | null;
  completedItemIds: string[];
  blockedItemIds: string[];
  createdItemIds: string[];
  notes: string;
}

export interface CreateWorkRunInput {
  subjectId: string;
  mode: string;
  scope?: string;
  startedBy?: string;
  activeItemId?: string | null;
  notes?: string;
}

export interface WorkRunPatch {
  status?: WorkRunStatus;
  activeItemId?: string | null;
  completedItemIds?: string[];
  blockedItemIds?: string[];
  createdItemIds?: string[];
  notes?: string;
  endedAt?: string | null;
}
