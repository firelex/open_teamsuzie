import { prepareCached, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

/**
 * The commitments store, per owner (the person whose mail and chats they
 * come from). Ported from Jeff Desk (jeff_desk/tools/commitments.py), with
 * an owner and an optional subject (e.g. the matter a commitment belongs to)
 * for hosts serving many people.
 */

/** owed_to_you: someone promised the owner; you_owe: the owner promised; assistant_owes: the owner asked their assistant. */
export const DIRECTIONS = ['owed_to_you', 'you_owe', 'assistant_owes'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export type CommitmentStatus = 'open' | 'done' | 'dropped';

/** Where a commitment was found. */
export interface CommitmentSource {
    kind: 'email' | 'sent_email' | 'chat' | 'teams' | 'whatsapp' | 'manual' | (string & {});
    account?: string;
    messageId?: string;
    subject?: string;
    chatId?: string;
    conversation?: string;
}

export interface FollowUp {
    kind: 'manual' | 'auto';
    /** When it was drafted (ms). */
    at: number;
    status: 'pending' | 'sent' | 'rejected';
    /** The host's id for the draft (e.g. an approval or email job). */
    ref: string | null;
}

export interface Commitment {
    id: number;
    ownerId: string;
    direction: Direction;
    text: string;
    counterparty: string | null;
    due: string | null;
    evidence: string | null;
    source: CommitmentSource;
    subject: { type: string; id: string } | null;
    status: CommitmentStatus;
    closedWhy: string | null;
    createdAt: number;
    updatedAt: number;
    followUps: FollowUp[];
    followUpsStopped: boolean;
    overdue: boolean;
}

export const COMMITMENTS_MIGRATIONS: Migration[] = [
    {
        name: '20261112_create_commitments',
        up: `
            CREATE TABLE IF NOT EXISTS commitments (
                id                 INTEGER PRIMARY KEY,
                owner_id           TEXT NOT NULL,
                direction          TEXT NOT NULL CHECK (direction IN ('owed_to_you', 'you_owe', 'assistant_owes')),
                text               TEXT NOT NULL,
                counterparty       TEXT,
                due                TEXT,
                evidence           TEXT,
                source             TEXT NOT NULL,
                subject_type       TEXT,
                subject_id         TEXT,
                status             TEXT NOT NULL CHECK (status IN ('open', 'done', 'dropped')),
                closed_why         TEXT,
                created_at         INTEGER NOT NULL,
                updated_at         INTEGER NOT NULL,
                follow_ups         TEXT NOT NULL DEFAULT '[]',
                follow_ups_stopped INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_commitments_owner ON commitments(owner_id, status);
            CREATE INDEX IF NOT EXISTS idx_commitments_subject ON commitments(subject_type, subject_id, status);
        `,
    },
];

interface Row {
    id: number;
    owner_id: string;
    direction: Direction;
    text: string;
    counterparty: string | null;
    due: string | null;
    evidence: string | null;
    source: string;
    subject_type: string | null;
    subject_id: string | null;
    status: CommitmentStatus;
    closed_why: string | null;
    created_at: number;
    updated_at: number;
    follow_ups: string;
    follow_ups_stopped: number;
}

export class CommitmentError extends Error {
    readonly code = 'invalid_commitment';
}

function checkDate(due: string): void {
    const d = new Date(`${due}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== due) {
        throw new CommitmentError(`"${due}" is not a date written YYYY-MM-DD`);
    }
}

export interface AddCommitment {
    ownerId: string;
    direction: Direction;
    text: string;
    counterparty: string | null;
    due: string | null;
    evidence: string | null;
    source: CommitmentSource;
    subject?: { type: string; id: string } | null;
}

export class CommitmentStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => number;

    constructor(opts: { db: DatabaseInstance; now?: () => number }) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => Date.now());
    }

    private today(): string {
        return new Date(this.clock()).toISOString().slice(0, 10);
    }

    private shown(r: Row): Commitment {
        return {
            id: r.id,
            ownerId: r.owner_id,
            direction: r.direction,
            text: r.text,
            counterparty: r.counterparty,
            due: r.due,
            evidence: r.evidence,
            source: JSON.parse(r.source) as CommitmentSource,
            subject: r.subject_type && r.subject_id ? { type: r.subject_type, id: r.subject_id } : null,
            status: r.status,
            closedWhy: r.closed_why,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            followUps: JSON.parse(r.follow_ups) as FollowUp[],
            followUpsStopped: r.follow_ups_stopped === 1,
            overdue: r.status === 'open' && !!r.due && r.due < this.today(),
        };
    }

    get(id: number): Commitment {
        const r = prepareCached<[number], Row>(this.db, `SELECT * FROM commitments WHERE id = ?`).get(id);
        if (!r) throw new CommitmentError(`No commitment ${id}`);
        return this.shown(r);
    }

    /** Open ones first: by due date (none last), then newest. */
    list(filter: { ownerId?: string; direction?: Direction; subject?: { type: string; id: string }; includeClosed?: boolean }): Commitment[] {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.ownerId) {
            where.push('lower(owner_id) = lower(?)');
            params.push(filter.ownerId);
        }
        if (filter.direction) {
            where.push('direction = ?');
            params.push(filter.direction);
        }
        if (filter.subject) {
            where.push('subject_type = ? AND subject_id = ?');
            params.push(filter.subject.type, filter.subject.id);
        }
        if (!filter.includeClosed) where.push(`status = 'open'`);
        const rows = this.db.prepare(`SELECT * FROM commitments ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`).all(...params) as Row[];
        return rows
            .map((r) => this.shown(r))
            .sort(
                (a, b) =>
                    Number(a.status !== 'open') - Number(b.status !== 'open') ||
                    Number(a.due === null) - Number(b.due === null) ||
                    (a.due ?? '').localeCompare(b.due ?? '') ||
                    b.createdAt - a.createdAt,
            );
    }

    /** Add one; the same promise, still open for the same owner and person, is the one already kept (its id is returned). */
    add(input: AddCommitment): number {
        if (!DIRECTIONS.includes(input.direction)) throw new CommitmentError(`A commitment is ${DIRECTIONS.join(', ')}, not ${input.direction}`);
        const text = input.text.split(/\s+/).filter(Boolean).join(' ');
        if (text.length < 3) throw new CommitmentError('A commitment needs a text');
        if (input.due !== null) checkDate(input.due);
        const same = prepareCached<[string, string, string, string], { id: number }>(
            this.db,
            `SELECT id FROM commitments WHERE status = 'open' AND lower(owner_id) = lower(?) AND direction = ? AND lower(text) = lower(?)
               AND lower(coalesce(counterparty, '')) = lower(?)`,
        ).get(input.ownerId, input.direction, text, input.counterparty ?? '');
        if (same) return same.id;
        const now = this.clock();
        return Number(
            prepareCached(
                this.db,
                `INSERT INTO commitments (owner_id, direction, text, counterparty, due, evidence, source, subject_type, subject_id, status, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
            ).run(
                input.ownerId,
                input.direction,
                text,
                input.counterparty,
                input.due,
                input.evidence,
                JSON.stringify(input.source),
                input.subject?.type ?? null,
                input.subject?.id ?? null,
                now,
                now,
            ).lastInsertRowid,
        );
    }

    update(id: number, fields: { text?: string; counterparty?: string | null; due?: string | null; subject?: { type: string; id: string } | null }): Commitment {
        const c = this.get(id);
        if (fields.due) checkDate(fields.due);
        const text = fields.text === undefined ? c.text : fields.text.split(/\s+/).filter(Boolean).join(' ');
        if (text.length < 3) throw new CommitmentError('A commitment needs a text');
        const subject = fields.subject === undefined ? c.subject : fields.subject;
        prepareCached(
            this.db,
            `UPDATE commitments SET text = ?, counterparty = ?, due = ?, subject_type = ?, subject_id = ?, updated_at = ? WHERE id = ?`,
        ).run(
            text,
            fields.counterparty === undefined ? c.counterparty : fields.counterparty,
            fields.due === undefined ? c.due : fields.due,
            subject?.type ?? null,
            subject?.id ?? null,
            this.clock(),
            id,
        );
        return this.get(id);
    }

    /** Close (done or dropped), or reopen with 'open'. */
    finish(id: number, status: CommitmentStatus, why: string): Commitment {
        if (!['open', 'done', 'dropped'].includes(status)) throw new CommitmentError(`A commitment is done, dropped or open, not ${status}`);
        this.get(id);
        prepareCached(this.db, `UPDATE commitments SET status = ?, closed_why = ?, updated_at = ? WHERE id = ?`).run(
            status,
            status === 'open' ? null : why,
            this.clock(),
            id,
        );
        return this.get(id);
    }

    addFollowUp(id: number, followUp: FollowUp): void {
        const c = this.get(id);
        prepareCached(this.db, `UPDATE commitments SET follow_ups = ?, updated_at = ? WHERE id = ?`).run(
            JSON.stringify([...c.followUps, followUp]),
            this.clock(),
            id,
        );
    }

    /** Update the follow-up with this host ref (its status, or a new ref for an edited draft). The commitment's id, or null. */
    updateFollowUp(ref: string, fields: Partial<Pick<FollowUp, 'status' | 'ref'>>): number | null {
        const rows = prepareCached<[], { id: number; follow_ups: string }>(this.db, `SELECT id, follow_ups FROM commitments WHERE follow_ups LIKE '%"ref"%'`).all();
        for (const r of rows) {
            const list = JSON.parse(r.follow_ups) as FollowUp[];
            if (!list.some((f) => f.ref === ref)) continue;
            prepareCached(this.db, `UPDATE commitments SET follow_ups = ? WHERE id = ?`).run(
                JSON.stringify(list.map((f) => (f.ref === ref ? { ...f, ...fields } : f))),
                r.id,
            );
            return r.id;
        }
        return null;
    }

    stopFollowUps(id: number): void {
        prepareCached(this.db, `UPDATE commitments SET follow_ups_stopped = 1, updated_at = ? WHERE id = ?`).run(this.clock(), id);
    }

    delete(id: number): void {
        if (prepareCached(this.db, `DELETE FROM commitments WHERE id = ?`).run(id).changes !== 1) throw new CommitmentError(`No commitment ${id}`);
    }
}
