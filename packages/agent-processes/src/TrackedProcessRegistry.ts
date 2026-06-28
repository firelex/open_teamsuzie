import type { ChildProcess, SpawnOptions } from 'node:child_process';
import {
  findDescendantProcessGroups,
  killProcessGroups,
  listProcessRows,
  type ProcessRow,
  type WorkspaceProcessGroup,
} from './processTree.js';

export type SpawnFn = (cmd: string, args: string[], opts: unknown) => ChildProcess;

export interface TrackedProcessSnapshot {
  pid: number | null;
  command: string;
  ageMs: number;
}

interface TrackedEntry {
  child: ChildProcess;
  command: string;
  detached: boolean;
  startedAt: number;
}

export interface TrackedProcessRegistryOptions {
  /** Host process pid used to avoid signalling self when enumerating the tree.
   *  Defaults to `process.pid`. Tests can pin this. */
  currentPid?: number;
  /** Wall-clock provider; defaults to `Date.now`. Tests can pin this. */
  now?: () => number;
  /** Process-tree enumeration; defaults to ps/lsof-backed `listProcessRows`.
   *  Tests can stub this to avoid touching the real OS. */
  listProcessRows?: () => ProcessRow[];
  /** Process-group killer; defaults to `process.kill(-pgid, signal)`.
   *  Tests can stub this. */
  killProcessGroups?: (groups: WorkspaceProcessGroup[], signal: NodeJS.Signals) => number;
  /** Signal sender used for direct-pid fallbacks; defaults to `process.kill`. */
  killPid?: (pid: number, signal: NodeJS.Signals) => void;
}

/**
 * Tracks externally spawned child processes so a host shutdown does not leave
 * descendants carrying on after the parent is gone.
 *
 * The registry is intentionally generic: it knows nothing about which CLI it
 * is spawning. Hosts wire in their own `spawn` function (typically Node's
 * `child_process.spawn`).
 */
export class TrackedProcessRegistry {
  private children = new Set<TrackedEntry>();
  private readonly currentPid: number;
  private readonly nowFn: () => number;
  private readonly listRows: () => ProcessRow[];
  private readonly killGroups: (groups: WorkspaceProcessGroup[], signal: NodeJS.Signals) => number;
  private readonly killPid: (pid: number, signal: NodeJS.Signals) => void;

  constructor(private spawnFn: SpawnFn, options: TrackedProcessRegistryOptions = {}) {
    this.currentPid = options.currentPid ?? process.pid;
    this.nowFn = options.now ?? Date.now;
    this.listRows = options.listProcessRows ?? listProcessRows;
    this.killGroups = options.killProcessGroups ?? killProcessGroups;
    this.killPid = options.killPid ?? ((pid, signal) => {
      process.kill(pid, signal);
    });
  }

  spawn: SpawnFn = (cmd, args, opts) => {
    const spawnOpts = {
      ...((opts ?? {}) as SpawnOptions),
      detached: true,
    };
    const child = this.spawnFn(cmd, args, spawnOpts);
    const tracked: TrackedEntry = {
      child,
      command: cmd,
      detached: spawnOpts.detached === true,
      startedAt: this.nowFn(),
    };
    this.children.add(tracked);
    const remove = () => this.children.delete(tracked);
    child.once('exit', remove);
    child.once('close', remove);
    return child;
  };

  /** Soft shutdown: SIGTERM the whole descendant tree of every tracked child. */
  shutdownAll(): void {
    for (const tracked of [...this.children]) {
      this.killTracked(tracked, 'SIGTERM');
    }
  }

  /** Hard shutdown: SIGKILL the whole descendant tree of every tracked child. */
  killAllHard(): void {
    for (const tracked of [...this.children]) {
      this.killTracked(tracked, 'SIGKILL');
    }
  }

  /** Read-only view of currently tracked children. */
  snapshot(): TrackedProcessSnapshot[] {
    const now = this.nowFn();
    return [...this.children].map((tracked) => ({
      pid: tracked.child.pid ?? null,
      command: tracked.command,
      ageMs: now - tracked.startedAt,
    }));
  }

  /** Number of tracked children currently alive in the registry. */
  size(): number {
    return this.children.size;
  }

  private killTracked(tracked: TrackedEntry, signal: NodeJS.Signals): void {
    const pid = tracked.child.pid;
    if (pid) {
      try {
        this.killGroups(
          findDescendantProcessGroups(this.listRows(), pid, this.currentPid),
          signal,
        );
      } catch {
        // Process-tree enumeration is best-effort. The direct process group
        // kill below still handles the common case.
      }
    }
    if (pid && tracked.detached) {
      try {
        this.killPid(-pid, signal);
        return;
      } catch {
        // Fall back to killing the direct child below.
      }
    }
    try {
      tracked.child.kill(signal);
    } catch {
      this.children.delete(tracked);
    }
  }
}
