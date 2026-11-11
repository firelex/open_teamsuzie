import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

export const AI_CONTROLS_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_ai_controls',
        up: `
            CREATE TABLE IF NOT EXISTS ai_controls (
                name      TEXT PRIMARY KEY,
                paused    INTEGER NOT NULL,
                reason    TEXT NOT NULL,
                set_by    TEXT NOT NULL,
                set_at    INTEGER NOT NULL
            );
        `,
    },
];

export interface ControlState {
    name: string;
    paused: boolean;
    reason: string;
    setBy: string | null;
    setAt: number | null;
}

/**
 * Named pause switches that survive restarts, e.g. 'all' (every AI call)
 * and 'agents' (background work). Each change records who, why and when.
 */
export class AiControls {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;

    constructor(opts: { db: DatabaseInstance; now?: () => number }) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
    }

    get(name: string): ControlState {
        const row = prepareCached<[string], { name: string; paused: number; reason: string; set_by: string; set_at: number }>(
            this.db,
            `SELECT * FROM ai_controls WHERE name = ?`,
        ).get(name);
        return row
            ? { name, paused: row.paused === 1, reason: row.reason, setBy: row.set_by, setAt: row.set_at }
            : { name, paused: false, reason: '', setBy: null, setAt: null };
    }

    set(name: string, paused: boolean, by: string, reason: string): ControlState {
        if (paused && !reason.trim()) throw new Error('say why you are pausing, for the record');
        prepareCached(
            this.db,
            `INSERT INTO ai_controls (name, paused, reason, set_by, set_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(name) DO UPDATE SET paused = excluded.paused, reason = excluded.reason, set_by = excluded.set_by, set_at = excluded.set_at`,
        ).run(name, paused ? 1 : 0, reason.trim(), by, this.clock());
        return this.get(name);
    }
}

/** What is registered: an abort handle plus a label for the "stopped" report. */
export interface RunningWork {
    kind: string;
    label: string;
    startedAt: number;
}

/**
 * In-process registry of running AI work (chat turns, task runs, ...), so
 * a kill switch can stop all of it, or all of one kind, at once.
 */
export class AbortRegistry {
    private readonly running = new Map<number, RunningWork & { controller: AbortController }>();
    private next = 1;

    /** Register work; returns its signal and a function to call when it ends. */
    start(kind: string, label: string, parent?: AbortSignal): { signal: AbortSignal; done: () => void } {
        const id = this.next++;
        const controller = new AbortController();
        if (parent) {
            if (parent.aborted) controller.abort(parent.reason);
            else parent.addEventListener('abort', () => controller.abort(parent.reason), { once: true });
        }
        this.running.set(id, { kind, label, startedAt: Date.now(), controller });
        return { signal: controller.signal, done: () => this.running.delete(id) };
    }

    list(): RunningWork[] {
        return [...this.running.values()].map(({ kind, label, startedAt }) => ({ kind, label, startedAt }));
    }

    /** Abort everything (or everything of `kinds`); returns what was stopped. */
    abortAll(reason: string, kinds?: string[]): RunningWork[] {
        const stopped: RunningWork[] = [];
        for (const [id, work] of this.running) {
            if (kinds && !kinds.includes(work.kind)) continue;
            work.controller.abort(new Error(reason));
            this.running.delete(id);
            stopped.push({ kind: work.kind, label: work.label, startedAt: work.startedAt });
        }
        return stopped;
    }
}
