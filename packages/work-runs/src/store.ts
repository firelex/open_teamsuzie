import { randomUUID } from 'node:crypto';
import type { WorkRunsStorage } from './storage.js';
import type {
  CreateWorkRunInput,
  WorkRun,
  WorkRunPatch,
  WorkRunStatus,
} from './types.js';

const LIVE_STATUSES: ReadonlySet<WorkRunStatus> = new Set([
  'running',
  'paused',
  'blocked',
]);

export interface WorkRunsStoreOptions {
  storage: WorkRunsStorage;
  now?: () => string;
  idFactory?: () => string;
}

export interface RecoverInterruptedOptions {
  reason?: string;
  /**
   * Optional gate on which `failed` run to actually recover. The store
   * only considers runs that already have an `activeItemId`; this
   * predicate is the host's chance to add domain-specific checks (e.g.
   * "is the underlying item still in progress?"). Defaults to accepting
   * any failed run with an active item.
   */
  predicate?: (run: WorkRun) => boolean;
}

/** Thrown by lifecycle methods. `.status` is an HTTP-friendly numeric code. */
export class WorkRunError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'WorkRunError';
    this.status = status;
  }
}

/**
 * State + lifecycle for a set of work runs scoped to one persistence
 * boundary (e.g. one workspace). Each mutation reads the storage, computes
 * the next state, and writes it back; the storage decides how that
 * round-trip is serialized.
 */
export class WorkRunsStore {
  private readonly storage: WorkRunsStorage;
  private readonly clock: () => string;
  private readonly newId: () => string;

  constructor(opts: WorkRunsStoreOptions) {
    this.storage = opts.storage;
    this.clock = opts.now ?? (() => new Date().toISOString());
    this.newId = opts.idFactory ?? (() => `run-${randomUUID().slice(0, 8)}`);
  }

  /** All runs, newest-first by `startedAt`. */
  list(): WorkRun[] {
    return this.storage
      .readAll()
      .slice()
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  get(id: string): WorkRun | null {
    return this.storage.readAll().find((r) => r.id === id) ?? null;
  }

  /** First non-terminal run (running | paused | blocked), or null. */
  current(): WorkRun | null {
    return this.list().find((r) => LIVE_STATUSES.has(r.status)) ?? null;
  }

  /**
   * Start a new run, superseding any existing live runs (running, paused,
   * blocked) as `completed`. Matches the IT/codex flow where only one
   * run is "current" at a time per subject.
   */
  create(input: CreateWorkRunInput): WorkRun {
    const now = this.clock();
    const supersededNote = 'Superseded by a newer work run.';
    const runs = this.storage.readAll().map((run) =>
      LIVE_STATUSES.has(run.status)
        ? {
            ...run,
            status: 'completed' as const,
            endedAt: now,
            notes: run.notes || supersededNote,
          }
        : run,
    );
    const run: WorkRun = {
      id: this.newId(),
      subjectId: input.subjectId,
      status: 'running',
      mode: input.mode,
      scope: input.scope ?? '',
      startedAt: now,
      endedAt: null,
      startedBy: input.startedBy ?? 'user',
      activeItemId: input.activeItemId ?? null,
      completedItemIds: [],
      blockedItemIds: [],
      createdItemIds: [],
      notes: input.notes ?? '',
    };
    this.storage.writeAll([run, ...runs]);
    return run;
  }

  /** Patch a run by id; returns the updated row, or null if not found. */
  update(id: string, patch: WorkRunPatch): WorkRun | null {
    const runs = this.storage.readAll();
    const index = runs.findIndex((r) => r.id === id);
    if (index < 0) return null;
    const next = { ...runs[index], ...patch };
    runs[index] = next;
    this.storage.writeAll(runs);
    return next;
  }

  /**
   * Sweep `running`/`blocked` runs to `failed`. Intended for server
   * startup: the orchestrator process is gone, but persisted state still
   * claims live work — leaving it as-is makes dashboards lie. `paused`
   * is kept; it reflects a deliberate user choice.
   *
   * Returns the number of rows changed.
   */
  markInterruptedFailed(): number {
    const runs = this.storage.readAll();
    if (runs.length === 0) return 0;
    const now = this.clock();
    let changed = 0;
    const swept = runs.map((run) => {
      if (run.status === 'running' || run.status === 'blocked') {
        changed += 1;
        return {
          ...run,
          status: 'failed' as const,
          endedAt: run.endedAt ?? now,
          notes: run.notes
            ? `${run.notes} · interrupted by server restart`
            : 'Interrupted by server restart',
        };
      }
      return run;
    });
    if (changed > 0) this.storage.writeAll(swept);
    return changed;
  }

  /**
   * Resume a previously-interrupted run.
   *
   * If a live run already exists, returns it unchanged. Otherwise, looks
   * for a `failed` run with an `activeItemId` that passes the optional
   * `predicate`, flips it back to `running`, appends `reason` to its
   * notes, and returns it. Returns null when no recoverable run exists.
   */
  recoverInterrupted(opts: RecoverInterruptedOptions = {}): WorkRun | null {
    const live = this.current();
    if (live) return live;
    const reason = opts.reason ?? 'Recovered interrupted work run.';
    const predicate = opts.predicate ?? (() => true);
    const candidate = this.list().find(
      (run) =>
        run.status === 'failed' &&
        run.activeItemId !== null &&
        predicate(run),
    );
    if (!candidate) return null;
    const notes = candidate.notes ? `${candidate.notes} · ${reason}` : reason;
    return this.update(candidate.id, {
      status: 'running',
      endedAt: null,
      notes,
    });
  }

  // ---- Lifecycle transitions ------------------------------------------

  /**
   * Claim an item for the current run.
   *
   * The store only enforces run-state invariants: the run must exist and
   * be `running`, and you can only replace an already-claimed item when
   * `replaceActive` is set. Item-side validation (does it exist, is it
   * in scope, are dependencies satisfied) is the host's job — the
   * package never reads the host's item store.
   */
  claimItem(itemId: string, opts: { replaceActive?: boolean } = {}): WorkRun {
    const run = this.requireRunning();
    if (
      run.activeItemId &&
      run.activeItemId !== itemId &&
      !opts.replaceActive
    ) {
      throw new WorkRunError(
        `work run already has activeItemId=${run.activeItemId}`,
        409,
      );
    }
    return this.update(run.id, { activeItemId: itemId })!;
  }

  /**
   * Mark the currently-active item as completed: clears `activeItemId`
   * and adds the item to `completedItemIds` (dedup-preserving).
   */
  completeActiveItem(): WorkRun {
    const run = this.requireRunning();
    if (!run.activeItemId) {
      throw new WorkRunError('work run has no active item', 409);
    }
    const completedItemIds = Array.from(
      new Set([...(run.completedItemIds ?? []), run.activeItemId]),
    );
    return this.update(run.id, { activeItemId: null, completedItemIds })!;
  }

  /**
   * Block the currently-active item. The active id is retained on the
   * run (the run is paused on a specific item) and added to
   * `blockedItemIds`. The run's status flips to `blocked`. Host-supplied
   * `notes` typically describe what the run is waiting on.
   */
  blockActiveItem(opts: { notes: string }): WorkRun {
    const run = this.requireRunning();
    if (!run.activeItemId) {
      throw new WorkRunError('work run has no active item', 409);
    }
    const blockedItemIds = Array.from(
      new Set([...(run.blockedItemIds ?? []), run.activeItemId]),
    );
    return this.update(run.id, {
      status: 'blocked',
      activeItemId: run.activeItemId,
      blockedItemIds,
      notes: opts.notes,
    })!;
  }

  /**
   * Finish an empty run — used when the host has determined no eligible
   * items remain. The store rejects this when an item is still active;
   * the caller should complete or block it first.
   */
  finishEmpty(opts: { notes: string }): WorkRun {
    const run = this.requireRunning();
    if (run.activeItemId) {
      throw new WorkRunError(
        'work run still has an active item; complete or block it first',
        409,
      );
    }
    return this.update(run.id, {
      status: 'completed',
      endedAt: this.clock(),
      activeItemId: null,
      notes: opts.notes,
    })!;
  }

  private requireRunning(): WorkRun {
    const run = this.current();
    if (!run) throw new WorkRunError('no active work run', 409);
    if (run.status !== 'running') {
      throw new WorkRunError(`work run is ${run.status}`, 409);
    }
    return run;
  }
}
