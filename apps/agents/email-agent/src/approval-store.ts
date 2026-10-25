import { randomUUID } from 'node:crypto';
import type { ApprovalItem, ApprovalStore, ListFilter, ProposeInput } from '@teamsuzie/approvals';
import type { DatabaseInstance } from './db.js';

interface Row {
    id: string;
    job_id: string | null;
    subject_id: string;
    action_type: string;
    payload_json: string;
    status: ApprovalItem['status'];
    review_json: string | null;
    dispatch_json: string | null;
    metadata_json: string | null;
    created_at: string;
    updated_at: string;
}

function toItem<T>(row: Row): ApprovalItem<T> {
    const item: ApprovalItem<T> = {
        id: row.id,
        subject_id: row.subject_id,
        action_type: row.action_type,
        payload: JSON.parse(row.payload_json) as T,
        status: row.status,
        created_at: new Date(row.created_at),
        updated_at: new Date(row.updated_at),
    };
    if (row.metadata_json !== null) item.metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
    if (row.review_json !== null) {
        const review = JSON.parse(row.review_json) as ApprovalItem<T>['review'] & { reviewed_at: string };
        item.review = { ...review, reviewed_at: new Date(review.reviewed_at) };
    }
    if (row.dispatch_json !== null) {
        const dispatch = JSON.parse(row.dispatch_json) as ApprovalItem['dispatch'] & { dispatched_at: string };
        item.dispatch = { ...dispatch, dispatched_at: new Date(dispatch.dispatched_at) };
    }
    return item;
}

/**
 * Durable approvals in the service's SQLite database. Items carry the queued job's id in `metadata.job_id`, so a
 * job awaiting approval can be found by its id.
 */
export class SqliteApprovalStore implements ApprovalStore {
    constructor(private readonly db: DatabaseInstance, private readonly now: () => Date) {}

    async create<T = unknown>(input: ProposeInput<T>): Promise<ApprovalItem<T>> {
        const now = this.now().toISOString();
        const id = `apr-${randomUUID()}`;
        const jobId = input.metadata?.job_id;
        this.db.prepare(`
            INSERT INTO approvals (id, job_id, subject_id, action_type, payload_json, status, metadata_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
            id,
            typeof jobId === 'string' ? jobId : null,
            input.subject_id,
            input.action_type,
            JSON.stringify(input.payload),
            input.metadata === undefined ? null : JSON.stringify(input.metadata),
            now,
            now,
        );
        return (await this.get<T>(id))!;
    }

    async get<T = unknown>(id: string): Promise<ApprovalItem<T> | null> {
        const row = this.db.prepare<[string], Row>('SELECT * FROM approvals WHERE id = ?').get(id);
        return row ? toItem<T>(row) : null;
    }

    async findByJobId<T = unknown>(jobId: string): Promise<ApprovalItem<T> | null> {
        const row = this.db.prepare<[string], Row>('SELECT * FROM approvals WHERE job_id = ?').get(jobId);
        return row ? toItem<T>(row) : null;
    }

    async update<T = unknown>(id: string, patch: Partial<ApprovalItem<T>>): Promise<ApprovalItem<T>> {
        const existing = await this.get<T>(id);
        if (!existing) throw new Error(`Approval item ${id} not found`);
        const next: ApprovalItem<T> = { ...existing, ...patch, id: existing.id, created_at: existing.created_at };
        this.db.prepare(`
            UPDATE approvals
            SET payload_json = ?, status = ?, review_json = ?, dispatch_json = ?, metadata_json = ?, updated_at = ?
            WHERE id = ?
        `).run(
            JSON.stringify(next.payload),
            next.status,
            next.review === undefined ? null : JSON.stringify(next.review),
            next.dispatch === undefined ? null : JSON.stringify(next.dispatch),
            next.metadata === undefined ? null : JSON.stringify(next.metadata),
            this.now().toISOString(),
            id,
        );
        return (await this.get<T>(id))!;
    }

    async list(filter: ListFilter): Promise<ApprovalItem[]> {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.status !== undefined) {
            const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
            where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
            params.push(...statuses);
        }
        if (filter.subject_id !== undefined) {
            where.push('subject_id = ?');
            params.push(filter.subject_id);
        }
        if (filter.action_type !== undefined) {
            where.push('action_type = ?');
            params.push(filter.action_type);
        }
        const sql = `SELECT * FROM approvals ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(filter.limit ?? -1, filter.offset ?? 0);
        return this.db.prepare<unknown[], Row>(sql).all(...params).map((row) => toItem(row));
    }
}
