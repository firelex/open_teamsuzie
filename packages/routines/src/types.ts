/**
 * What to do when a run falls due while the previous one is still going.
 * - `skip`: record a skipped run and wait for the next time.
 * - `allow`: start another run anyway.
 */
export type OverlapPolicy = 'skip' | 'allow';

/**
 * What to do with runs missed while the scheduler was not running (e.g. the
 * server was down at 09:00).
 * - `skip`: record one skipped run and wait for the next time.
 * - `run_once`: run once now for everything missed.
 */
export type CatchUpPolicy = 'skip' | 'run_once';

export type RoutineTrigger = 'schedule' | 'manual' | 'webhook';

export interface Routine<TPayload = Record<string, unknown>> {
    id: string;
    /** What the routine belongs to, e.g. ('matter', matterId). Opaque to the package. */
    subjectType: string;
    subjectId: string;
    name: string;
    /** Five-field cron expression: minute hour day-of-month month day-of-week. */
    schedule: string;
    /** IANA time zone the schedule is read in, e.g. 'Europe/London'. */
    timezone: string;
    enabled: boolean;
    overlap: OverlapPolicy;
    catchUp: CatchUpPolicy;
    /** What a run does; host-defined. */
    payload: TPayload;
    /** Whether a webhook token is set (the token itself is only shown once). */
    hasWebhook: boolean;
    /** The next scheduled time, or null when disabled. */
    nextRunAt: number | null;
    lastRunAt: number | null;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

export type RoutineRunStatus = 'started' | 'skipped' | 'failed';

export interface RoutineRun {
    id: string;
    routineId: string;
    trigger: RoutineTrigger;
    /** Who triggered a manual run; 'scheduler' or 'webhook' otherwise. */
    actor: string;
    /** When the run was due (scheduled runs) or asked for. */
    dueAt: number;
    firedAt: number;
    status: RoutineRunStatus;
    /** The host's id for what the run started, e.g. a task id. */
    ref: string | null;
    /** Why a run was skipped or failed. */
    detail: string;
}

export interface CreateRoutineInput<TPayload = Record<string, unknown>> {
    subjectType: string;
    subjectId: string;
    name: string;
    schedule: string;
    timezone: string;
    enabled?: boolean;
    overlap?: OverlapPolicy;
    catchUp?: CatchUpPolicy;
    payload: TPayload;
    createdBy: string;
}

export type RoutinePatch<TPayload = Record<string, unknown>> = Partial<
    Pick<Routine<TPayload>, 'name' | 'schedule' | 'timezone' | 'enabled' | 'overlap' | 'catchUp' | 'payload'>
>;

export interface ListRoutinesFilter {
    subjectType?: string;
    subjectId?: string;
}
