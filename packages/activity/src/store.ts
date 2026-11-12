import { createHash, randomUUID } from 'node:crypto';
import {
    jsonColumn,
    prepareCached,
    type DatabaseInstance,
} from '@teamsuzie/db-sqlite';

import type {
    ActivityEntry,
    AppendActivityInput,
    ListByOrgOptions,
    ListBySubjectOptions,
    SubjectRef,
} from './types.js';

interface ActivityRow {
    id: string;
    org_id: string;
    subject_type: string;
    subject_id: string;
    actor_id: string | null;
    actor_type: string | null;
    kind: string;
    summary: string;
    body: string | null;
    metadata: string;
    at: number;
    seq: number | null;
    prev_hash: string | null;
    hash: string | null;
}

/** The hash before the first entry of every org's chain. */
export const GENESIS_HASH = '0'.repeat(64);

/** What `verify` found. `firstBreak` names the first entry that does not fit the chain. */
export interface ChainVerification {
    ok: boolean;
    /** Entries checked. */
    checked: number;
    /** Entries not yet chained (written before chaining; run sealUnchained). */
    unchained: number;
    head: { seq: number; hash: string } | null;
    firstBreak: { seq: number; id: string | null; reason: string } | null;
}

/** The exact text each entry's hash covers: its position, the previous hash, and every stored field. */
function chainText(row: Omit<ActivityRow, 'hash'>): string {
    return JSON.stringify([
        row.seq,
        row.prev_hash,
        row.id,
        row.org_id,
        row.subject_type,
        row.subject_id,
        row.actor_id,
        row.actor_type,
        row.kind,
        row.summary,
        row.body,
        row.metadata,
        row.at,
    ]);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export interface ActivityStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

/**
 * Append-only writer + read API over `activity_entries`. There is no
 * update path; corrections are modeled as new entries with their own
 * `kind` (e.g. `comment.edited`).
 */
export class ActivityStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: ActivityStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    append(input: AppendActivityInput): ActivityEntry {
        const id = this.newId();
        const at = input.at ?? this.clock();
        this.db.transaction(() => {
            const tip = this.tip(input.orgId);
            const row = {
                id,
                org_id: input.orgId,
                subject_type: input.subject.type,
                subject_id: input.subject.id,
                actor_id: input.actor?.id ?? null,
                actor_type: input.actor?.type ?? null,
                kind: input.kind,
                summary: input.summary,
                body: input.body ?? null,
                metadata: jsonColumn.serialize(input.metadata ?? {}),
                at,
                seq: (tip?.seq ?? 0) + 1,
                prev_hash: tip?.hash ?? GENESIS_HASH,
            };
            prepareCached(
                this.db,
                `INSERT INTO activity_entries
                    (id, org_id, subject_type, subject_id,
                     actor_id, actor_type, kind, summary, body, metadata, at, seq, prev_hash, hash)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(
                row.id,
                row.org_id,
                row.subject_type,
                row.subject_id,
                row.actor_id,
                row.actor_type,
                row.kind,
                row.summary,
                row.body,
                row.metadata,
                row.at,
                row.seq,
                row.prev_hash,
                sha256(chainText(row)),
            );
        })();
        return this.get(id)!;
    }

    /** The last chained entry of an org: record it somewhere else to detect truncation later. */
    head(orgId: string): { seq: number; hash: string } | null {
        return this.tip(orgId);
    }

    private tip(orgId: string): { seq: number; hash: string } | null {
        return (
            prepareCached<[string], { seq: number; hash: string }>(
                this.db,
                `SELECT seq, hash FROM activity_entries WHERE org_id = ? AND seq IS NOT NULL ORDER BY seq DESC LIMIT 1`,
            ).get(orgId) ?? null
        );
    }

    /**
     * Chain every entry written before chaining existed, oldest first, after
     * the org's current tip. Run once at start-up. Returns how many it sealed.
     */
    sealUnchained(): number {
        let sealed = 0;
        this.db.transaction(() => {
            const rows = prepareCached<[], ActivityRow>(
                this.db,
                `SELECT * FROM activity_entries WHERE seq IS NULL ORDER BY at ASC, ROWID ASC`,
            ).all();
            for (const r of rows) {
                const tip = this.tip(r.org_id);
                const row = { ...r, seq: (tip?.seq ?? 0) + 1, prev_hash: tip?.hash ?? GENESIS_HASH };
                prepareCached(this.db, `UPDATE activity_entries SET seq = ?, prev_hash = ?, hash = ? WHERE id = ?`).run(
                    row.seq,
                    row.prev_hash,
                    sha256(chainText(row)),
                    r.id,
                );
                sealed++;
            }
        })();
        return sealed;
    }

    /**
     * Walk an org's chain and check every link: each entry's hash matches its
     * content, points at the entry before, and no position is missing. A
     * changed field, an inserted row or a deleted row shows as a break.
     * Deleting the newest entries is only caught against a head recorded
     * elsewhere (`head`), which `expectHead` can check.
     */
    verify(orgId: string, expectHead?: { seq: number; hash: string }): ChainVerification {
        const unchained = (
            prepareCached<[string], { n: number }>(
                this.db,
                `SELECT count(*) AS n FROM activity_entries WHERE org_id = ? AND seq IS NULL`,
            ).get(orgId)!
        ).n;
        let prev = GENESIS_HASH;
        let expected = 1;
        let checked = 0;
        let last: { seq: number; hash: string } | null = null;
        const rows = prepareCached<[string], ActivityRow>(
            this.db,
            `SELECT * FROM activity_entries WHERE org_id = ? AND seq IS NOT NULL ORDER BY seq ASC`,
        ).iterate(orgId) as IterableIterator<ActivityRow>;
        for (const row of rows) {
            const brk = (reason: string) => ({ ok: false, checked, unchained, head: last, firstBreak: { seq: row.seq!, id: row.id, reason } });
            if (row.seq !== expected) return brk(`entry ${expected} is missing (next entry is ${row.seq})`);
            if (row.prev_hash !== prev) return brk('does not point at the entry before it');
            if (sha256(chainText(row)) !== row.hash) return brk('its content no longer matches its hash');
            prev = row.hash!;
            expected++;
            checked++;
            last = { seq: row.seq!, hash: row.hash! };
        }
        if (expectHead) {
            const reached = last?.seq ?? 0;
            if (reached < expectHead.seq) {
                return { ok: false, checked, unchained, head: last, firstBreak: { seq: reached + 1, id: null, reason: `entries after ${reached} are missing (recorded head is ${expectHead.seq})` } };
            }
            const atHead = prepareCached<[string, number], { hash: string }>(
                this.db,
                `SELECT hash FROM activity_entries WHERE org_id = ? AND seq = ?`,
            ).get(orgId, expectHead.seq);
            if (atHead?.hash !== expectHead.hash) {
                return { ok: false, checked, unchained, head: last, firstBreak: { seq: expectHead.seq, id: null, reason: 'differs from the recorded head' } };
            }
        }
        return { ok: true, checked, unchained, head: last, firstBreak: null };
    }

    get(id: string): ActivityEntry | null {
        const row = prepareCached<[string], ActivityRow>(
            this.db,
            `SELECT * FROM activity_entries WHERE id = ?`,
        ).get(id);
        return row ? rowToEntry(row) : null;
    }

    listBySubject(opts: ListBySubjectOptions): ActivityEntry[] {
        const limit = Math.min(
            Math.max(1, opts.limit ?? DEFAULT_LIMIT),
            MAX_LIMIT,
        );
        const where: string[] = [
            'org_id = ?',
            'subject_type = ?',
            'subject_id = ?',
        ];
        const params: unknown[] = [
            opts.orgId,
            opts.subject.type,
            opts.subject.id,
        ];
        if (opts.before !== undefined) {
            where.push('at < ?');
            params.push(opts.before);
        }
        if (opts.kinds && opts.kinds.length > 0) {
            const placeholders = opts.kinds.map(() => '?').join(', ');
            where.push(`kind IN (${placeholders})`);
            for (const k of opts.kinds) params.push(k);
        }
        params.push(limit);
        const rows = prepareCached<unknown[], ActivityRow>(
            this.db,
            `SELECT * FROM activity_entries
             WHERE ${where.join(' AND ')}
             ORDER BY at DESC, ROWID DESC
             LIMIT ?`,
        ).all(...params);
        return rows.map(rowToEntry);
    }

    listByOrg(opts: ListByOrgOptions): ActivityEntry[] {
        const limit = Math.min(
            Math.max(1, opts.limit ?? DEFAULT_LIMIT),
            MAX_LIMIT,
        );
        const where: string[] = ['org_id = ?'];
        const params: unknown[] = [opts.orgId];
        if (opts.before !== undefined) {
            where.push('at < ?');
            params.push(opts.before);
        }
        if (opts.kinds && opts.kinds.length > 0) {
            const placeholders = opts.kinds.map(() => '?').join(', ');
            where.push(`kind IN (${placeholders})`);
            for (const k of opts.kinds) params.push(k);
        }
        params.push(limit);
        const rows = prepareCached<unknown[], ActivityRow>(
            this.db,
            `SELECT * FROM activity_entries
             WHERE ${where.join(' AND ')}
             ORDER BY at DESC, ROWID DESC
             LIMIT ?`,
        ).all(...params);
        return rows.map(rowToEntry);
    }

    /** Everyone who did something in an org between two times (ms), e.g. to find whose day to summarise. */
    actorsBetween(orgId: string, from: number, to: number): string[] {
        return prepareCached<[string, number, number], { actor_id: string }>(
            this.db,
            `SELECT DISTINCT actor_id FROM activity_entries WHERE org_id = ? AND at >= ? AND at < ? AND actor_id IS NOT NULL ORDER BY actor_id`,
        )
            .all(orgId, from, to)
            .map((r) => r.actor_id);
    }

    /** Entries one actor performed in an org, newest first. */
    listByActor(opts: ListByOrgOptions & { actorId: string }): ActivityEntry[] {
        const limit = Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
        const where: string[] = ['org_id = ?', 'actor_id = ?'];
        const params: unknown[] = [opts.orgId, opts.actorId];
        if (opts.before !== undefined) {
            where.push('at < ?');
            params.push(opts.before);
        }
        if (opts.kinds && opts.kinds.length > 0) {
            where.push(`kind IN (${opts.kinds.map(() => '?').join(', ')})`);
            for (const k of opts.kinds) params.push(k);
        }
        params.push(limit);
        return prepareCached<unknown[], ActivityRow>(
            this.db,
            `SELECT * FROM activity_entries
             WHERE ${where.join(' AND ')}
             ORDER BY at DESC, ROWID DESC
             LIMIT ?`,
        )
            .all(...params)
            .map(rowToEntry);
    }

    countBySubject(orgId: string, subject: SubjectRef): number {
        const row = prepareCached<[string, string, string], { c: number }>(
            this.db,
            `SELECT COUNT(*) AS c FROM activity_entries
             WHERE org_id = ? AND subject_type = ? AND subject_id = ?`,
        ).get(orgId, subject.type, subject.id);
        return row?.c ?? 0;
    }

    /**
     * Cascade-delete every entry tied to a subject. Host calls this
     * when the underlying record / matter / ticket is deleted. There is
     * no FK across packages, so cleanup is the host's responsibility.
     * Deleting entries breaks the org's hash chain (verify reports the
     * gap), so hosts that rely on verify should keep entries instead.
     */
    removeForSubject(orgId: string, subject: SubjectRef): number {
        const result = prepareCached<[string, string, string]>(
            this.db,
            `DELETE FROM activity_entries
             WHERE org_id = ? AND subject_type = ? AND subject_id = ?`,
        ).run(orgId, subject.type, subject.id);
        return result.changes;
    }
}

function rowToEntry(row: ActivityRow): ActivityEntry {
    let metadata: Record<string, unknown> = {};
    try {
        const parsed = jsonColumn.parse<unknown>(row.metadata);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
        }
    } catch {
        /* tolerate corrupt JSON */
    }
    return {
        id: row.id,
        orgId: row.org_id,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        actorId: row.actor_id,
        actorType: row.actor_type,
        kind: row.kind,
        summary: row.summary,
        body: row.body,
        metadata,
        at: row.at,
    };
}
