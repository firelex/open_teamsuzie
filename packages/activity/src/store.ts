import { randomUUID } from 'node:crypto';
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
}

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
        prepareCached<
            [
                string,
                string,
                string,
                string,
                string | null,
                string | null,
                string,
                string,
                string | null,
                string,
                number,
            ]
        >(
            this.db,
            `INSERT INTO activity_entries
                (id, org_id, subject_type, subject_id,
                 actor_id, actor_type, kind, summary, body, metadata, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.orgId,
            input.subject.type,
            input.subject.id,
            input.actor?.id ?? null,
            input.actor?.type ?? null,
            input.kind,
            input.summary,
            input.body ?? null,
            jsonColumn.serialize(input.metadata ?? {}),
            at,
        );
        return this.get(id)!;
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
