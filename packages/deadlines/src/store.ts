import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

/** A deadline that cannot be accepted as given (bad date, time, title or reminders). */
export class DeadlineInputError extends Error {
    readonly code = 'invalid_deadline';
}

export interface SubjectRef {
    type: string;
    id: string;
}

export type DeadlineStatus = 'open' | 'done' | 'dismissed';

/** Where a deadline came from, so a person can check it. */
export interface DeadlineSource {
    /** Host id of the document, e.g. a matter document id. */
    documentId: string;
    documentName: string;
    /** The words in the document the date is based on. */
    quote: string;
    /** True when the date was worked out (e.g. "14 days after service") rather than written. */
    computed: boolean;
}

export interface Deadline {
    id: string;
    subject: SubjectRef;
    title: string;
    /** Calendar date, YYYY-MM-DD. */
    date: string;
    /** Local time HH:MM, or null for the whole day. */
    time: string | null;
    /** Host-defined kind, e.g. 'filing', 'hearing', 'notice', 'renewal'. */
    kind: string;
    notes: string;
    source: DeadlineSource | null;
    /** Days before the date to remind, e.g. [7, 1]. */
    remindDays: number[];
    status: DeadlineStatus;
    createdBy: string;
    createdAt: number;
    updatedAt: number;
    completedBy: string | null;
}

export interface CreateDeadlineInput {
    subject: SubjectRef;
    title: string;
    date: string;
    time?: string | null;
    kind: string;
    notes?: string;
    source?: DeadlineSource | null;
    remindDays?: number[];
    createdBy: string;
}

export type DeadlinePatch = Partial<Pick<Deadline, 'title' | 'date' | 'time' | 'kind' | 'notes' | 'remindDays'>>;

export const DEADLINES_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_deadlines',
        up: `
            CREATE TABLE IF NOT EXISTS deadlines (
                id           TEXT PRIMARY KEY,
                subject_type TEXT NOT NULL,
                subject_id   TEXT NOT NULL,
                title        TEXT NOT NULL,
                date         TEXT NOT NULL,
                time         TEXT,
                kind         TEXT NOT NULL,
                notes        TEXT NOT NULL DEFAULT '',
                source       TEXT,
                remind_days  TEXT NOT NULL DEFAULT '[]',
                status       TEXT NOT NULL CHECK (status IN ('open', 'done', 'dismissed')),
                created_by   TEXT NOT NULL,
                created_at   INTEGER NOT NULL,
                updated_at   INTEGER NOT NULL,
                completed_by TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_deadlines_subject ON deadlines(subject_type, subject_id, date);
            CREATE INDEX IF NOT EXISTS idx_deadlines_open ON deadlines(status, date);
        `,
    },
];

interface Row {
    id: string;
    subject_type: string;
    subject_id: string;
    title: string;
    date: string;
    time: string | null;
    kind: string;
    notes: string;
    source: string | null;
    remind_days: string;
    status: DeadlineStatus;
    created_by: string;
    created_at: number;
    updated_at: number;
    completed_by: string | null;
}

const toDeadline = (r: Row): Deadline => ({
    id: r.id,
    subject: { type: r.subject_type, id: r.subject_id },
    title: r.title,
    date: r.date,
    time: r.time,
    kind: r.kind,
    notes: r.notes,
    source: r.source ? (JSON.parse(r.source) as DeadlineSource) : null,
    remindDays: JSON.parse(r.remind_days) as number[],
    status: r.status,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    completedBy: r.completed_by,
});

/** Throws unless `date` is a real calendar date written YYYY-MM-DD. */
export function checkDate(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DeadlineInputError(`"${date}" is not a date written YYYY-MM-DD`);
    const d = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) throw new DeadlineInputError(`${date} is not a real date`);
}

function checkTime(time: string | null | undefined): void {
    if (time == null) return;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new DeadlineInputError(`"${time}" is not a time written HH:MM`);
}

function checkRemind(days: number[]): number[] {
    if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 365)) {
        throw new DeadlineInputError('reminder days must be whole numbers from 0 to 365');
    }
    return [...new Set(days)].sort((a, b) => b - a);
}

/** Calendar date `days` after `date` (both YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

export interface DeadlineStoreOptions {
    db: DatabaseInstance;
    now?: () => number;
    idFactory?: () => string;
}

/** Deadlines and key dates per subject. */
export class DeadlineStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;
    private readonly newId: () => string;

    constructor(opts: DeadlineStoreOptions) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
        this.newId = opts.idFactory ?? (() => randomUUID());
    }

    create(input: CreateDeadlineInput): Deadline {
        const title = input.title.trim();
        if (!title) throw new DeadlineInputError('a deadline needs a title');
        checkDate(input.date);
        checkTime(input.time);
        if (!input.kind.trim()) throw new DeadlineInputError('a deadline needs a kind');
        const id = this.newId();
        const now = this.clock();
        prepareCached(
            this.db,
            `INSERT INTO deadlines (id, subject_type, subject_id, title, date, time, kind, notes, source, remind_days, status,
               created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
        ).run(
            id,
            input.subject.type,
            input.subject.id,
            title,
            input.date,
            input.time ?? null,
            input.kind.trim(),
            (input.notes ?? '').trim(),
            input.source ? JSON.stringify(input.source) : null,
            JSON.stringify(checkRemind(input.remindDays ?? [7, 1])),
            input.createdBy,
            now,
            now,
        );
        return this.get(id)!;
    }

    get(id: string): Deadline | null {
        const row = prepareCached<[string], Row>(this.db, `SELECT * FROM deadlines WHERE id = ?`).get(id);
        return row ? toDeadline(row) : null;
    }

    listFor(subject: SubjectRef): Deadline[] {
        return prepareCached<[string, string], Row>(
            this.db,
            `SELECT * FROM deadlines WHERE subject_type = ? AND subject_id = ? ORDER BY date, coalesce(time, '99:99'), rowid`,
        )
            .all(subject.type, subject.id)
            .map(toDeadline);
    }

    /** Open deadlines on or before `until` (YYYY-MM-DD), overdue ones included, earliest first. */
    upcoming(until: string, subjects?: SubjectRef[]): Deadline[] {
        checkDate(until);
        const rows = prepareCached<[string], Row>(
            this.db,
            `SELECT * FROM deadlines WHERE status = 'open' AND date <= ? ORDER BY date, coalesce(time, '99:99'), rowid`,
        )
            .all(until)
            .map(toDeadline);
        if (!subjects) return rows;
        const keys = new Set(subjects.map((s) => `${s.type}:${s.id}`));
        return rows.filter((d) => keys.has(`${d.subject.type}:${d.subject.id}`));
    }

    /** Open deadlines whose reminder falls on `today`, or that are due or overdue. */
    remindersFor(today: string, subjects?: SubjectRef[]): Array<{ deadline: Deadline; daysLeft: number }> {
        checkDate(today);
        const horizon = addDays(today, 365);
        return this.upcoming(horizon, subjects)
            .map((deadline) => ({
                deadline,
                daysLeft: Math.round((Date.parse(`${deadline.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
            }))
            .filter(({ deadline, daysLeft }) => daysLeft <= 0 || deadline.remindDays.some((d) => daysLeft <= d));
    }

    update(id: string, patch: DeadlinePatch): Deadline {
        const current = this.get(id);
        if (!current) throw new Error(`No deadline with id ${id}.`);
        const next = { ...current, ...patch };
        if (!next.title.trim()) throw new DeadlineInputError('a deadline needs a title');
        checkDate(next.date);
        checkTime(next.time);
        prepareCached(
            this.db,
            `UPDATE deadlines SET title = ?, date = ?, time = ?, kind = ?, notes = ?, remind_days = ?, updated_at = ? WHERE id = ?`,
        ).run(next.title.trim(), next.date, next.time, next.kind, next.notes.trim(), JSON.stringify(checkRemind(next.remindDays)), this.clock(), id);
        return this.get(id)!;
    }

    setStatus(id: string, status: DeadlineStatus, by: string): Deadline {
        if (!['open', 'done', 'dismissed'].includes(status)) throw new DeadlineInputError("status must be 'open', 'done' or 'dismissed'");
        const changed = prepareCached(
            this.db,
            `UPDATE deadlines SET status = ?, completed_by = ?, updated_at = ? WHERE id = ?`,
        ).run(status, status === 'open' ? null : by, this.clock(), id).changes;
        if (changed === 0) throw new Error(`No deadline with id ${id}.`);
        return this.get(id)!;
    }

    delete(id: string): boolean {
        return prepareCached(this.db, `DELETE FROM deadlines WHERE id = ?`).run(id).changes > 0;
    }

    deleteFor(subject: SubjectRef): number {
        return prepareCached(this.db, `DELETE FROM deadlines WHERE subject_type = ? AND subject_id = ?`).run(
            subject.type,
            subject.id,
        ).changes;
    }
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Fold a content line at 75 octets as RFC 5545 asks. */
function fold(line: string): string {
    const out: string[] = [];
    let rest = line;
    while (Buffer.byteLength(rest) > 75) {
        let cut = 75;
        while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
        out.push(rest.slice(0, cut));
        rest = ` ${rest.slice(cut)}`;
    }
    out.push(rest);
    return out.join('\r\n');
}

/**
 * An iCalendar file of open deadlines: all-day events, or timed events in
 * floating local time when a time is set, with an alarm per reminder day.
 */
export function toIcs(deadlines: Deadline[], opts: { calendarName: string; productId: string; describe?: (d: Deadline) => string }): string {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        `PRODID:${opts.productId}`,
        'CALSCALE:GREGORIAN',
        `X-WR-CALNAME:${icsText(opts.calendarName)}`,
    ];
    for (const d of deadlines.filter((x) => x.status === 'open')) {
        const day = d.date.replace(/-/g, '');
        lines.push('BEGIN:VEVENT', `UID:${d.id}@deadlines`, `DTSTAMP:${stamp}`);
        if (d.time) {
            lines.push(`DTSTART:${day}T${d.time.replace(':', '')}00`, `DURATION:PT30M`);
        } else {
            lines.push(`DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${addDays(d.date, 1).replace(/-/g, '')}`);
        }
        lines.push(`SUMMARY:${icsText(d.title)}`);
        const description = opts.describe?.(d) ?? d.notes;
        if (description) lines.push(`DESCRIPTION:${icsText(description)}`);
        lines.push(`CATEGORIES:${icsText(d.kind)}`);
        for (const days of d.remindDays) {
            lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(d.title)}`, `TRIGGER:-P${days}D`, 'END:VALARM');
        }
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n') + '\r\n';
}
