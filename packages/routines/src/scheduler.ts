import type { RoutineStore } from './store.js';
import type { Routine, RoutineRun, RoutineTrigger } from './types.js';

/** What a host's `fire` did: started something (with its id), or chose not to. */
export type FireResult = { ref: string } | { skipped: string };

export interface RoutineSchedulerOptions<TPayload> {
    store: RoutineStore<TPayload>;
    /**
     * Start one run of the routine (e.g. create an agent task). Throw to
     * record a failed run with the error's message.
     */
    fire: (routine: Routine<TPayload>, trigger: RoutineTrigger, actor: string) => Promise<FireResult> | FireResult;
    /** Whether what `ref` started is still going; used by the `skip` overlap policy. */
    isActive: (ref: string) => boolean;
    now?: () => number;
    /** How late a scheduled run may be before it counts as missed. Default 5 minutes. */
    lateAfterMs?: number;
}

/**
 * Fires due routines. Call `tick()` on an interval (`start`). Each due
 * routine is handled once per tick: missed runs follow the catch-up
 * policy, overlapping runs the overlap policy, and every outcome is
 * recorded in the run history. The next run is always computed from now,
 * so a long outage produces at most one catch-up run.
 */
export class RoutineScheduler<TPayload = Record<string, unknown>> {
    private readonly store: RoutineStore<TPayload>;
    private readonly fireImpl: RoutineSchedulerOptions<TPayload>['fire'];
    private readonly isActive: (ref: string) => boolean;
    private readonly clock: () => number;
    private readonly lateAfterMs: number;
    private timer: ReturnType<typeof setInterval> | null = null;
    private ticking = false;

    constructor(opts: RoutineSchedulerOptions<TPayload>) {
        this.store = opts.store;
        this.fireImpl = opts.fire;
        this.isActive = opts.isActive;
        this.clock = opts.now ?? (() => Date.now());
        this.lateAfterMs = opts.lateAfterMs ?? 5 * 60_000;
    }

    start(intervalMs = 30_000): void {
        if (this.timer) return;
        void this.tick();
        this.timer = setInterval(() => void this.tick(), intervalMs);
    }

    stop(): void {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }

    /** Handle every due routine once. Returns the runs recorded. */
    async tick(): Promise<RoutineRun[]> {
        if (this.ticking) return [];
        this.ticking = true;
        try {
            const now = this.clock();
            const recorded: RoutineRun[] = [];
            for (const routine of this.store.due(now)) {
                const dueAt = routine.nextRunAt!;
                // Move on first, so a run that throws is not retried every tick.
                this.store.advance(routine.id, now);
                if (now - dueAt > this.lateAfterMs && routine.catchUp === 'skip') {
                    recorded.push(
                        this.store.recordRun({
                            routineId: routine.id,
                            trigger: 'schedule',
                            actor: 'scheduler',
                            dueAt,
                            status: 'skipped',
                            ref: null,
                            detail: `Missed: the scheduler was not running when this run was due (${new Date(dueAt).toISOString()}).`,
                        }),
                    );
                    continue;
                }
                recorded.push(await this.run(routine, 'schedule', 'scheduler', dueAt));
            }
            return recorded;
        } finally {
            this.ticking = false;
        }
    }

    /** Run a routine now, outside its schedule (a person or a webhook asked). */
    runNow(routineId: string, trigger: 'manual' | 'webhook', actor: string): Promise<RoutineRun> {
        const routine = this.store.get(routineId);
        if (!routine) throw new Error(`No routine with id ${routineId}.`);
        return this.run(routine, trigger, actor, this.clock());
    }

    private async run(routine: Routine<TPayload>, trigger: RoutineTrigger, actor: string, dueAt: number): Promise<RoutineRun> {
        const base = { routineId: routine.id, trigger, actor, dueAt };
        if (routine.overlap === 'skip') {
            const last = this.store.lastStarted(routine.id);
            if (last?.ref && this.isActive(last.ref)) {
                return this.store.recordRun({
                    ...base,
                    status: 'skipped',
                    ref: null,
                    detail: 'Skipped: the previous run is still in progress.',
                });
            }
        }
        try {
            const result = await this.fireImpl(routine, trigger, actor);
            if ('skipped' in result) {
                return this.store.recordRun({ ...base, status: 'skipped', ref: null, detail: result.skipped });
            }
            return this.store.recordRun({ ...base, status: 'started', ref: result.ref, detail: '' });
        } catch (err) {
            return this.store.recordRun({
                ...base,
                status: 'failed',
                ref: null,
                detail: err instanceof Error ? err.message : String(err),
            });
        }
    }
}
