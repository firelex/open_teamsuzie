import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

export const TIMEKEEPING_MIGRATIONS: Migration[] = [
    {
        name: '20261112_create_timekeeping',
        up: `
            CREATE TABLE IF NOT EXISTS time_rates (
                id           TEXT PRIMARY KEY,
                level        TEXT NOT NULL CHECK (level IN ('person', 'client', 'matter')),
                level_id     TEXT NOT NULL,
                person_id    TEXT,
                hourly_minor INTEGER NOT NULL CHECK (hourly_minor >= 0),
                currency     TEXT NOT NULL,
                set_by       TEXT NOT NULL,
                set_at       INTEGER NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_time_rates_key ON time_rates(level, level_id, coalesce(person_id, ''));

            CREATE TABLE IF NOT EXISTS time_entries (
                id            TEXT PRIMARY KEY,
                matter_id     TEXT NOT NULL,
                client_id     TEXT,
                person_id     TEXT NOT NULL,
                date          TEXT NOT NULL,
                raw_minutes   INTEGER NOT NULL CHECK (raw_minutes > 0),
                minutes       INTEGER NOT NULL CHECK (minutes > 0),
                narrative     TEXT NOT NULL,
                billable      INTEGER NOT NULL,
                task_code     TEXT,
                activity_code TEXT,
                rate_minor    INTEGER NOT NULL,
                rate_source   TEXT NOT NULL,
                amount_minor  INTEGER NOT NULL,
                currency      TEXT NOT NULL,
                status        TEXT NOT NULL CHECK (status IN ('unbilled', 'billed', 'written_off')),
                invoice_id    TEXT,
                write_off_reason TEXT,
                source        TEXT NOT NULL,
                created_by    TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_time_entries_matter ON time_entries(matter_id, status, date);
            CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(person_id, date);

            CREATE TABLE IF NOT EXISTS time_timers (
                person_id  TEXT PRIMARY KEY,
                matter_id  TEXT NOT NULL,
                narrative  TEXT NOT NULL,
                started_at INTEGER NOT NULL
            );
        `,
    },
    {
        // 'proposed': drafted by an assistant from the person's activity, not yet confirmed by them.
        name: '20261112_time_entries_proposed',
        rebuildsTables: true,
        up: `
            CREATE TABLE time_entries_new (
                id            TEXT PRIMARY KEY,
                matter_id     TEXT NOT NULL,
                client_id     TEXT,
                person_id     TEXT NOT NULL,
                date          TEXT NOT NULL,
                raw_minutes   INTEGER NOT NULL CHECK (raw_minutes > 0),
                minutes       INTEGER NOT NULL CHECK (minutes > 0),
                narrative     TEXT NOT NULL,
                billable      INTEGER NOT NULL,
                task_code     TEXT,
                activity_code TEXT,
                rate_minor    INTEGER NOT NULL,
                rate_source   TEXT NOT NULL,
                amount_minor  INTEGER NOT NULL,
                currency      TEXT NOT NULL,
                status        TEXT NOT NULL CHECK (status IN ('proposed', 'unbilled', 'billed', 'written_off')),
                invoice_id    TEXT,
                write_off_reason TEXT,
                source        TEXT NOT NULL,
                created_by    TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL,
                basis         TEXT
            );
            INSERT INTO time_entries_new (id, matter_id, client_id, person_id, date, raw_minutes, minutes, narrative, billable, task_code,
              activity_code, rate_minor, rate_source, amount_minor, currency, status, invoice_id, write_off_reason, source, created_by,
              created_at, updated_at)
              SELECT id, matter_id, client_id, person_id, date, raw_minutes, minutes, narrative, billable, task_code, activity_code,
                rate_minor, rate_source, amount_minor, currency, status, invoice_id, write_off_reason, source, created_by, created_at, updated_at
              FROM time_entries;
            DROP TABLE time_entries;
            ALTER TABLE time_entries_new RENAME TO time_entries;
            CREATE INDEX IF NOT EXISTS idx_time_entries_matter ON time_entries(matter_id, status, date);
            CREATE INDEX IF NOT EXISTS idx_time_entries_person ON time_entries(person_id, date);
        `,
    },
];

export type RateLevel = 'person' | 'client' | 'matter';
/** proposed: drafted from activity, waiting for the person to confirm; it counts nowhere until then. */
export type EntryStatus = 'proposed' | 'unbilled' | 'billed' | 'written_off';

export interface Rate {
    id: string;
    level: RateLevel;
    levelId: string;
    /** For client and matter rates: the person it applies to, or null for everyone. */
    personId: string | null;
    hourlyMinor: number;
    currency: string;
    setBy: string;
    setAt: number;
}

export interface TimeEntry {
    id: string;
    matterId: string;
    clientId: string | null;
    personId: string;
    /** YYYY-MM-DD */
    date: string;
    /** Minutes actually worked, as entered. */
    rawMinutes: number;
    /** Minutes charged: rawMinutes rounded up to the billing unit. */
    minutes: number;
    narrative: string;
    billable: boolean;
    taskCode: string | null;
    activityCode: string | null;
    /** Hourly rate fixed when the entry was recorded, in minor units. */
    rateMinor: number;
    /** Which rate applied, e.g. "matter rate for jane@firm.test". */
    rateSource: string;
    /** minutes x rate, in minor units; 0 when not billable. */
    amountMinor: number;
    currency: string;
    status: EntryStatus;
    invoiceId: string | null;
    writeOffReason: string | null;
    source: string;
    /** For proposed entries: what the proposal was based on (shown to the person). */
    basis: string[] | null;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
}

export interface RecordInput {
    matterId: string;
    /** The matter's client, used to find client rates. */
    clientId: string | null;
    personId: string;
    date: string;
    rawMinutes: number;
    narrative: string;
    billable: boolean;
    taskCode?: string | null;
    activityCode?: string | null;
    /** How the entry was made, e.g. 'manual', 'timer', 'suggested'. */
    source: string;
    createdBy: string;
    /** Record it as proposed (not counted until `confirm`), with what it was based on. */
    proposed?: { basis: string[] };
}

export type EntryPatch = Partial<Pick<RecordInput, 'date' | 'rawMinutes' | 'narrative' | 'billable' | 'taskCode' | 'activityCode'>>;

export interface Timer {
    personId: string;
    matterId: string;
    narrative: string;
    startedAt: number;
}

/** A request the current state does not allow, or bad input; safe to show to the user. */
export class TimeInputError extends Error {
    readonly code = 'invalid_time';
}

interface EntryRow {
    id: string;
    matter_id: string;
    client_id: string | null;
    person_id: string;
    date: string;
    raw_minutes: number;
    minutes: number;
    narrative: string;
    billable: number;
    task_code: string | null;
    activity_code: string | null;
    rate_minor: number;
    rate_source: string;
    amount_minor: number;
    currency: string;
    status: EntryStatus;
    invoice_id: string | null;
    write_off_reason: string | null;
    source: string;
    created_by: string;
    created_at: number;
    updated_at: number;
    basis: string | null;
}

const toEntry = (r: EntryRow): TimeEntry => ({
    id: r.id,
    matterId: r.matter_id,
    clientId: r.client_id,
    personId: r.person_id,
    date: r.date,
    rawMinutes: r.raw_minutes,
    minutes: r.minutes,
    narrative: r.narrative,
    billable: r.billable === 1,
    taskCode: r.task_code,
    activityCode: r.activity_code,
    rateMinor: r.rate_minor,
    rateSource: r.rate_source,
    amountMinor: r.amount_minor,
    currency: r.currency,
    status: r.status,
    invoiceId: r.invoice_id,
    writeOffReason: r.write_off_reason,
    source: r.source,
    basis: r.basis ? (JSON.parse(r.basis) as string[]) : null,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
});

const toRate = (r: {
    id: string;
    level: RateLevel;
    level_id: string;
    person_id: string | null;
    hourly_minor: number;
    currency: string;
    set_by: string;
    set_at: number;
}): Rate => ({
    id: r.id,
    level: r.level,
    levelId: r.level_id,
    personId: r.person_id,
    hourlyMinor: r.hourly_minor,
    currency: r.currency,
    setBy: r.set_by,
    setAt: r.set_at,
});

function checkDate(date: string): void {
    const d = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) {
        throw new TimeInputError(`"${date}" is not a date written YYYY-MM-DD`);
    }
}

/** Minutes charged for `raw` minutes worked: rounded up to whole billing units. */
export function roundToUnit(raw: number, unitMinutes: number): number {
    return Math.ceil(raw / unitMinutes) * unitMinutes;
}

/** minutes x hourly rate, rounded half up to a whole minor unit. */
export function amountFor(minutes: number, hourlyMinor: number): number {
    return Math.round((minutes * hourlyMinor) / 60);
}

export interface TimeStoreOptions {
    db: DatabaseInstance;
    /** Three-letter currency code all rates and amounts are in. */
    currency: string;
    /** Billing unit in minutes, e.g. 6 for tenths of an hour. */
    unitMinutes: number;
    now?: () => number;
    idFactory?: () => string;
}

/**
 * Time entries, rates and timers. The rate for an entry is the most
 * specific that exists, in this order: the matter's rate for the person,
 * the matter's rate for everyone, the client's rate for the person, the
 * client's rate for everyone, the person's own rate. It is fixed on the
 * entry when recorded, so later rate changes do not alter recorded work.
 */
export class TimeStore {
    private readonly db: DatabaseInstance;
    readonly currency: string;
    readonly unitMinutes: number;
    private readonly clock: () => number;
    private readonly newId: () => string;

    constructor(opts: TimeStoreOptions) {
        if (!/^[A-Z]{3}$/.test(opts.currency)) throw new Error(`currency must be a three-letter code, not "${opts.currency}"`);
        if (!Number.isInteger(opts.unitMinutes) || opts.unitMinutes < 1 || opts.unitMinutes > 60) {
            throw new Error('the billing unit must be a whole number of minutes from 1 to 60');
        }
        this.db = opts.db;
        this.currency = opts.currency;
        this.unitMinutes = opts.unitMinutes;
        this.clock = opts.now ?? (() => Date.now());
        this.newId = opts.idFactory ?? (() => randomUUID());
    }

    // ---- rates ----

    setRate(input: { level: RateLevel; levelId: string; personId?: string | null; hourlyMinor: number; setBy: string }): Rate {
        if (!['person', 'client', 'matter'].includes(input.level)) throw new TimeInputError('level must be person, client or matter');
        if (!Number.isInteger(input.hourlyMinor) || input.hourlyMinor < 0) {
            throw new TimeInputError('an hourly rate must be a whole number of minor units (e.g. pence) of at least 0');
        }
        const personId = input.level === 'person' ? null : (input.personId ?? null);
        prepareCached(
            this.db,
            `INSERT INTO time_rates (id, level, level_id, person_id, hourly_minor, currency, set_by, set_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(level, level_id, coalesce(person_id, '')) DO UPDATE SET hourly_minor = excluded.hourly_minor,
               currency = excluded.currency, set_by = excluded.set_by, set_at = excluded.set_at`,
        ).run(this.newId(), input.level, input.levelId, personId, input.hourlyMinor, this.currency, input.setBy, this.clock());
        return this.rates({ level: input.level, levelId: input.levelId }).find((r) => r.personId === personId)!;
    }

    removeRate(id: string): boolean {
        return prepareCached(this.db, `DELETE FROM time_rates WHERE id = ?`).run(id).changes > 0;
    }

    rates(filter: { level?: RateLevel; levelId?: string } = {}): Rate[] {
        const where: string[] = [];
        const params: string[] = [];
        if (filter.level) {
            where.push('level = ?');
            params.push(filter.level);
        }
        if (filter.levelId) {
            where.push('level_id = ?');
            params.push(filter.levelId);
        }
        return (
            this.db
                .prepare(`SELECT * FROM time_rates ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY level, level_id, person_id`)
                .all(...params) as Parameters<typeof toRate>[0][]
        ).map(toRate);
    }

    /** The rate that applies, most specific first, or null when none is set. */
    resolveRate(personId: string, matterId: string, clientId: string | null): { hourlyMinor: number; source: string } | null {
        const find = (level: RateLevel, levelId: string, person: string | null) =>
            prepareCached<[string, string, string], { hourly_minor: number; currency: string }>(
                this.db,
                `SELECT hourly_minor, currency FROM time_rates WHERE level = ? AND level_id = ? AND coalesce(person_id, '') = ?`,
            ).get(level, levelId, person ?? '');
        const candidates: Array<[RateLevel, string, string | null, string]> = [
            ['matter', matterId, personId, `matter rate for ${personId}`],
            ['matter', matterId, null, 'matter rate'],
            ...(clientId
                ? ([
                      ['client', clientId, personId, `client rate for ${personId}`],
                      ['client', clientId, null, 'client rate'],
                  ] as Array<[RateLevel, string, string | null, string]>)
                : []),
            ['person', personId, null, `standard rate of ${personId}`],
        ];
        for (const [level, levelId, person, source] of candidates) {
            const row = find(level, levelId, person);
            if (!row) continue;
            if (row.currency !== this.currency) {
                throw new Error(`The ${source} is in ${row.currency} but the firm bills in ${this.currency}; set it again.`);
            }
            return { hourlyMinor: row.hourly_minor, source };
        }
        return null;
    }

    // ---- entries ----

    record(input: RecordInput): TimeEntry {
        checkDate(input.date);
        if (!Number.isInteger(input.rawMinutes) || input.rawMinutes < 1 || input.rawMinutes > 24 * 60) {
            throw new TimeInputError('time must be a whole number of minutes from 1 to 1440');
        }
        const narrative = input.narrative.trim();
        if (!narrative) throw new TimeInputError('say what the time was spent on');
        const rate = this.resolveRate(input.personId, input.matterId, input.clientId);
        if (input.billable && !rate) {
            throw new TimeInputError(`No hourly rate is set for ${input.personId} on this matter; set one before recording billable time.`);
        }
        const minutes = roundToUnit(input.rawMinutes, this.unitMinutes);
        const now = this.clock();
        const id = this.newId();
        prepareCached(
            this.db,
            `INSERT INTO time_entries (id, matter_id, client_id, person_id, date, raw_minutes, minutes, narrative, billable, task_code,
               activity_code, rate_minor, rate_source, amount_minor, currency, status, source, created_by, created_at, updated_at, basis)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.matterId,
            input.clientId,
            input.personId,
            input.date,
            input.rawMinutes,
            minutes,
            narrative,
            input.billable ? 1 : 0,
            input.taskCode ?? null,
            input.activityCode ?? null,
            rate?.hourlyMinor ?? 0,
            rate?.source ?? 'no rate (not billable)',
            input.billable ? amountFor(minutes, rate!.hourlyMinor) : 0,
            this.currency,
            input.proposed ? 'proposed' : 'unbilled',
            input.source,
            input.createdBy,
            now,
            now,
            input.proposed ? JSON.stringify(input.proposed.basis) : null,
        );
        return this.get(id)!;
    }

    get(id: string): TimeEntry | null {
        const row = prepareCached<[string], EntryRow>(this.db, `SELECT * FROM time_entries WHERE id = ?`).get(id);
        return row ? toEntry(row) : null;
    }

    /** An entry that may still change: unbilled, or proposed and not yet confirmed. */
    private mustBeUnbilled(id: string, action: string): TimeEntry {
        const e = this.get(id);
        if (!e) throw new TimeInputError(`No time entry with id ${id}.`);
        if (e.status !== 'unbilled' && e.status !== 'proposed') throw new TimeInputError(`This entry is ${e.status.replace('_', ' ')}, so it cannot be ${action}.`);
        return e;
    }

    /** The person confirms a proposed entry (after any edits): it becomes ordinary unbilled time. */
    confirm(id: string): TimeEntry {
        const e = this.get(id);
        if (!e) throw new TimeInputError(`No time entry with id ${id}.`);
        if (e.status !== 'proposed') throw new TimeInputError('Only a proposed entry can be confirmed.');
        prepareCached(this.db, `UPDATE time_entries SET status = 'unbilled', updated_at = ? WHERE id = ? AND status = 'proposed'`).run(this.clock(), id);
        return this.get(id)!;
    }

    /** Change an unbilled entry. The rate stays as recorded; minutes and amount are worked out again. */
    update(id: string, patch: EntryPatch): TimeEntry {
        const e = this.mustBeUnbilled(id, 'changed');
        const next = {
            date: patch.date ?? e.date,
            rawMinutes: patch.rawMinutes ?? e.rawMinutes,
            narrative: (patch.narrative ?? e.narrative).trim(),
            billable: patch.billable ?? e.billable,
            taskCode: patch.taskCode === undefined ? e.taskCode : patch.taskCode,
            activityCode: patch.activityCode === undefined ? e.activityCode : patch.activityCode,
        };
        checkDate(next.date);
        if (!Number.isInteger(next.rawMinutes) || next.rawMinutes < 1 || next.rawMinutes > 24 * 60) {
            throw new TimeInputError('time must be a whole number of minutes from 1 to 1440');
        }
        if (!next.narrative) throw new TimeInputError('say what the time was spent on');
        if (next.billable && e.rateSource === 'no rate (not billable)') {
            throw new TimeInputError('This entry was recorded without a rate; record it again once a rate is set.');
        }
        const minutes = roundToUnit(next.rawMinutes, this.unitMinutes);
        prepareCached(
            this.db,
            `UPDATE time_entries SET date = ?, raw_minutes = ?, minutes = ?, narrative = ?, billable = ?, task_code = ?, activity_code = ?,
               amount_minor = ?, updated_at = ? WHERE id = ? AND status IN ('unbilled', 'proposed')`,
        ).run(
            next.date,
            next.rawMinutes,
            minutes,
            next.narrative,
            next.billable ? 1 : 0,
            next.taskCode,
            next.activityCode,
            next.billable ? amountFor(minutes, e.rateMinor) : 0,
            this.clock(),
            id,
        );
        return this.get(id)!;
    }

    delete(id: string): void {
        this.mustBeUnbilled(id, 'deleted');
        prepareCached(this.db, `DELETE FROM time_entries WHERE id = ? AND status IN ('unbilled', 'proposed')`).run(id);
    }

    writeOff(id: string, reason: string): TimeEntry {
        const e = this.mustBeUnbilled(id, 'written off');
        if (e.status === 'proposed') throw new TimeInputError('A proposed entry is confirmed or deleted, not written off.');
        if (!reason.trim()) throw new TimeInputError('say why the time is written off');
        prepareCached(
            this.db,
            `UPDATE time_entries SET status = 'written_off', write_off_reason = ?, updated_at = ? WHERE id = ? AND status = 'unbilled'`,
        ).run(reason.trim(), this.clock(), id);
        return this.get(id)!;
    }

    /** Undo a write-off. */
    reinstate(id: string): TimeEntry {
        const e = this.get(id);
        if (!e || e.status !== 'written_off') throw new TimeInputError('Only a written-off entry can be reinstated.');
        prepareCached(
            this.db,
            `UPDATE time_entries SET status = 'unbilled', write_off_reason = NULL, updated_at = ? WHERE id = ?`,
        ).run(this.clock(), id);
        return this.get(id)!;
    }

    /** Put unbilled billable entries on an invoice. All or none: throws if any is not unbilled. */
    markBilled(ids: string[], invoiceId: string): void {
        this.db.transaction(() => {
            for (const id of ids) {
                const changed = prepareCached(
                    this.db,
                    `UPDATE time_entries SET status = 'billed', invoice_id = ?, updated_at = ? WHERE id = ? AND status = 'unbilled' AND billable = 1`,
                ).run(invoiceId, this.clock(), id).changes;
                if (changed === 0) throw new TimeInputError(`Time entry ${id} is not unbilled billable time.`);
            }
        })();
    }

    /** Return an invoice's entries to unbilled (when a draft is discarded or an invoice is credited in full). */
    releaseInvoice(invoiceId: string): number {
        return prepareCached(
            this.db,
            `UPDATE time_entries SET status = 'unbilled', invoice_id = NULL, updated_at = ? WHERE invoice_id = ? AND status = 'billed'`,
        ).run(this.clock(), invoiceId).changes;
    }

    list(filter: { matterId?: string; personId?: string; from?: string; to?: string; status?: EntryStatus; invoiceId?: string } = {}): TimeEntry[] {
        const where: string[] = [];
        const params: unknown[] = [];
        const add = (sql: string, v: unknown) => {
            where.push(sql);
            params.push(v);
        };
        if (filter.matterId) add('matter_id = ?', filter.matterId);
        if (filter.personId) add('lower(person_id) = lower(?)', filter.personId);
        if (filter.from) add('date >= ?', filter.from);
        if (filter.to) add('date <= ?', filter.to);
        if (filter.status) add('status = ?', filter.status);
        if (filter.invoiceId) add('invoice_id = ?', filter.invoiceId);
        return (
            this.db
                .prepare(`SELECT * FROM time_entries ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date, created_at, rowid`)
                .all(...params) as EntryRow[]
        ).map(toEntry);
    }

    /** Unbilled billable work per matter: minutes and value. */
    wip(matterIds?: string[]): Array<{ matterId: string; minutes: number; amountMinor: number; entries: number }> {
        const rows = prepareCached<[], { matterId: string; minutes: number; amountMinor: number; entries: number }>(
            this.db,
            `SELECT matter_id AS matterId, sum(minutes) AS minutes, sum(amount_minor) AS amountMinor, count(*) AS entries
             FROM time_entries WHERE status = 'unbilled' AND billable = 1 GROUP BY matter_id ORDER BY amountMinor DESC`,
        ).all();
        return matterIds ? rows.filter((r) => matterIds.includes(r.matterId)) : rows;
    }

    /** Remove a matter's unbilled and written-off entries (when the matter is deleted). Billed entries are kept. */
    deleteUnbilledFor(matterId: string): number {
        return prepareCached(this.db, `DELETE FROM time_entries WHERE matter_id = ? AND status != 'billed'`).run(matterId).changes;
    }

    // ---- timers ----

    timer(personId: string): Timer | null {
        const row = prepareCached<[string], { person_id: string; matter_id: string; narrative: string; started_at: number }>(
            this.db,
            `SELECT * FROM time_timers WHERE lower(person_id) = lower(?)`,
        ).get(personId);
        return row ? { personId: row.person_id, matterId: row.matter_id, narrative: row.narrative, startedAt: row.started_at } : null;
    }

    startTimer(personId: string, matterId: string, narrative: string): Timer {
        const running = this.timer(personId);
        if (running) throw new TimeInputError('A timer is already running; stop it first.');
        prepareCached(this.db, `INSERT INTO time_timers (person_id, matter_id, narrative, started_at) VALUES (?, ?, ?, ?)`).run(
            personId,
            matterId,
            narrative.trim(),
            this.clock(),
        );
        return this.timer(personId)!;
    }

    /** Stop the person's timer; returns it with the whole minutes elapsed (at least 1). The host records the entry. */
    stopTimer(personId: string): Timer & { elapsedMinutes: number } {
        const t = this.timer(personId);
        if (!t) throw new TimeInputError('No timer is running.');
        prepareCached(this.db, `DELETE FROM time_timers WHERE lower(person_id) = lower(?)`).run(personId);
        return { ...t, elapsedMinutes: Math.max(1, Math.round((this.clock() - t.startedAt) / 60_000)) };
    }

    discardTimer(personId: string): boolean {
        return prepareCached(this.db, `DELETE FROM time_timers WHERE lower(person_id) = lower(?)`).run(personId).changes > 0;
    }
}
