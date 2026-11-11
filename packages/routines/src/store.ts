import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Cron } from 'croner';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import type {
    CatchUpPolicy,
    CreateRoutineInput,
    ListRoutinesFilter,
    OverlapPolicy,
    Routine,
    RoutinePatch,
    RoutineRun,
    RoutineRunStatus,
    RoutineTrigger,
} from './types.js';

export interface RoutineStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

interface RoutineRow {
    id: string;
    subject_type: string;
    subject_id: string;
    name: string;
    schedule: string;
    timezone: string;
    enabled: number;
    overlap: OverlapPolicy;
    catch_up: CatchUpPolicy;
    payload: string;
    webhook_hash: string | null;
    next_run_at: number | null;
    last_run_at: number | null;
    created_by: string;
    created_at: number;
    updated_at: number;
}

interface RunRow {
    id: string;
    routine_id: string;
    trigger: RoutineTrigger;
    actor: string;
    due_at: number;
    fired_at: number;
    status: RoutineRunStatus;
    ref: string | null;
    detail: string;
}

const OVERLAPS: OverlapPolicy[] = ['skip', 'allow'];
const CATCH_UPS: CatchUpPolicy[] = ['skip', 'run_once'];

function toRoutine<T>(r: RoutineRow): Routine<T> {
    return {
        id: r.id,
        subjectType: r.subject_type,
        subjectId: r.subject_id,
        name: r.name,
        schedule: r.schedule,
        timezone: r.timezone,
        enabled: r.enabled === 1,
        overlap: r.overlap,
        catchUp: r.catch_up,
        payload: JSON.parse(r.payload) as T,
        hasWebhook: r.webhook_hash !== null,
        nextRunAt: r.next_run_at,
        lastRunAt: r.last_run_at,
        createdBy: r.created_by,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
    };
}

function toRun(r: RunRow): RoutineRun {
    return {
        id: r.id,
        routineId: r.routine_id,
        trigger: r.trigger,
        actor: r.actor,
        dueAt: r.due_at,
        firedAt: r.fired_at,
        status: r.status,
        ref: r.ref,
        detail: r.detail,
    };
}

/**
 * The next time `schedule` falls due after `after`, read in `timezone`.
 * Throws with a plain message when the schedule or time zone is invalid,
 * or the schedule never falls due.
 */
export function nextOccurrence(schedule: string, timezone: string, after: number): number {
    const fields = schedule.trim().split(/\s+/);
    if (fields.length !== 5) {
        throw new Error(`The schedule "${schedule}" must have five parts: minute hour day-of-month month day-of-week.`);
    }
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    } catch {
        throw new Error(`Unknown time zone: ${timezone}`);
    }
    let cron: Cron;
    try {
        cron = new Cron(schedule.trim(), { timezone, paused: true });
    } catch (err) {
        throw new Error(`The schedule "${schedule}" is not valid: ${err instanceof Error ? err.message : String(err)}`);
    }
    const next = cron.nextRun(new Date(after));
    if (!next) throw new Error(`The schedule "${schedule}" never falls due.`);
    return next.getTime();
}

const hashToken = (token: string) => createHash('sha256').update(token).digest();

/** Routines and their run history. */
export class RoutineStore<TPayload = Record<string, unknown>> {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: RoutineStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    create(input: CreateRoutineInput<TPayload>): Routine<TPayload> {
        const name = input.name.trim();
        if (!name) throw new Error('name is required');
        const overlap = input.overlap ?? 'skip';
        const catchUp = input.catchUp ?? 'skip';
        this.checkPolicies(overlap, catchUp);
        const enabled = input.enabled ?? true;
        const now = this.clock();
        const next = nextOccurrence(input.schedule, input.timezone, now);
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO routines (id, subject_type, subject_id, name, schedule, timezone, enabled, overlap, catch_up, payload,
               next_run_at, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.subjectType,
            input.subjectId,
            name,
            input.schedule.trim(),
            input.timezone,
            enabled ? 1 : 0,
            overlap,
            catchUp,
            JSON.stringify(input.payload),
            enabled ? next : null,
            input.createdBy,
            now,
            now,
        );
        return this.mustGet(id);
    }

    get(id: string): Routine<TPayload> | null {
        const row = prepareCached<[string], RoutineRow>(this.db, `SELECT * FROM routines WHERE id = ?`).get(id);
        return row ? toRoutine<TPayload>(row) : null;
    }

    list(filter: ListRoutinesFilter = {}): Routine<TPayload>[] {
        const where: string[] = [];
        const params: string[] = [];
        if (filter.subjectType) {
            where.push('subject_type = ?');
            params.push(filter.subjectType);
        }
        if (filter.subjectId) {
            where.push('subject_id = ?');
            params.push(filter.subjectId);
        }
        return (
            this.db
                .prepare(`SELECT * FROM routines ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at ASC, rowid ASC`)
                .all(...params) as RoutineRow[]
        ).map((r) => toRoutine<TPayload>(r));
    }

    /**
     * Change a routine. A new schedule, time zone or re-enabling recomputes
     * the next run from now; disabling clears it.
     */
    update(id: string, patch: RoutinePatch<TPayload>): Routine<TPayload> {
        const current = this.mustGet(id);
        const next: Routine<TPayload> = { ...current, ...patch };
        if (!next.name.trim()) throw new Error('name is required');
        this.checkPolicies(next.overlap, next.catchUp);
        const nextRunAt = next.enabled ? nextOccurrence(next.schedule, next.timezone, this.clock()) : null;
        prepareCached(
            this.db,
            `UPDATE routines SET name = ?, schedule = ?, timezone = ?, enabled = ?, overlap = ?, catch_up = ?, payload = ?,
               next_run_at = ?, updated_at = ? WHERE id = ?`,
        ).run(
            next.name.trim(),
            next.schedule.trim(),
            next.timezone,
            next.enabled ? 1 : 0,
            next.overlap,
            next.catchUp,
            JSON.stringify(next.payload),
            nextRunAt,
            this.clock(),
            id,
        );
        return this.mustGet(id);
    }

    delete(id: string): boolean {
        return prepareCached(this.db, `DELETE FROM routines WHERE id = ?`).run(id).changes > 0;
    }

    deleteFor(subjectType: string, subjectId: string): number {
        return prepareCached(this.db, `DELETE FROM routines WHERE subject_type = ? AND subject_id = ?`).run(
            subjectType,
            subjectId,
        ).changes;
    }

    /** Enabled routines whose next run is at or before `now`, earliest first. */
    due(now: number): Routine<TPayload>[] {
        return prepareCached<[number], RoutineRow>(
            this.db,
            `SELECT * FROM routines WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC`,
        )
            .all(now)
            .map((r) => toRoutine<TPayload>(r));
    }

    /** Move a routine's next run to the first occurrence after `after`. */
    advance(id: string, after: number): void {
        const r = this.mustGet(id);
        prepareCached(this.db, `UPDATE routines SET next_run_at = ? WHERE id = ?`).run(
            r.enabled ? nextOccurrence(r.schedule, r.timezone, after) : null,
            id,
        );
    }

    recordRun(run: Omit<RoutineRun, 'id' | 'firedAt'>): RoutineRun {
        const firedAt = this.clock();
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO routine_runs (id, routine_id, trigger, actor, due_at, fired_at, status, ref, detail)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, run.routineId, run.trigger, run.actor, run.dueAt, firedAt, run.status, run.ref, run.detail);
        if (run.status === 'started') {
            prepareCached(this.db, `UPDATE routines SET last_run_at = ? WHERE id = ?`).run(firedAt, run.routineId);
        }
        return { ...run, id, firedAt };
    }

    runs(routineId: string, limit = 50): RoutineRun[] {
        return prepareCached<[string, number], RunRow>(
            this.db,
            `SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY fired_at DESC, rowid DESC LIMIT ?`,
        )
            .all(routineId, limit)
            .map(toRun);
    }

    /** The most recent run that started something. */
    lastStarted(routineId: string): RoutineRun | null {
        const row = prepareCached<[string], RunRow>(
            this.db,
            `SELECT * FROM routine_runs WHERE routine_id = ? AND status = 'started' ORDER BY fired_at DESC, rowid DESC LIMIT 1`,
        ).get(routineId);
        return row ? toRun(row) : null;
    }

    /** Set a new webhook token and return it; only its hash is kept. */
    rotateWebhookToken(id: string): string {
        this.mustGet(id);
        const token = randomBytes(32).toString('base64url');
        prepareCached(this.db, `UPDATE routines SET webhook_hash = ?, updated_at = ? WHERE id = ?`).run(
            hashToken(token).toString('hex'),
            this.clock(),
            id,
        );
        return token;
    }

    removeWebhookToken(id: string): void {
        prepareCached(this.db, `UPDATE routines SET webhook_hash = NULL, updated_at = ? WHERE id = ?`).run(this.clock(), id);
    }

    /** Whether `token` is the routine's webhook token. */
    verifyWebhookToken(id: string, token: string): boolean {
        const row = prepareCached<[string], { webhook_hash: string | null }>(
            this.db,
            `SELECT webhook_hash FROM routines WHERE id = ?`,
        ).get(id);
        if (!row?.webhook_hash || !token) return false;
        return timingSafeEqual(Buffer.from(row.webhook_hash, 'hex'), hashToken(token));
    }

    private mustGet(id: string): Routine<TPayload> {
        const r = this.get(id);
        if (!r) throw new Error(`No routine with id ${id}.`);
        return r;
    }

    private checkPolicies(overlap: OverlapPolicy, catchUp: CatchUpPolicy): void {
        if (!OVERLAPS.includes(overlap)) throw new Error(`overlap must be one of: ${OVERLAPS.join(', ')}`);
        if (!CATCH_UPS.includes(catchUp)) throw new Error(`catchUp must be one of: ${CATCH_UPS.join(', ')}`);
    }
}
