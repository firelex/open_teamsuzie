import { randomUUID } from 'node:crypto';
import {
    jsonColumn,
    prepareCached,
    type DatabaseInstance,
} from '@teamsuzie/db-sqlite';

import type {
    BusinessRecord,
    CreateRecordInput,
    CreateRecordTypeInput,
    ListRecordsOptions,
    RecordType,
    UpdateRecordInput,
    UpdateRecordTypeInput,
} from './types.js';

interface RecordTypeRow {
    id: string;
    org_id: string;
    key: string;
    name: string;
    description: string;
    created_at: number;
    updated_at: number;
}

interface RecordRow {
    id: string;
    org_id: string;
    type_id: string;
    title: string;
    custom_fields: string;
    created_by: string | null;
    created_at: number;
    updated_at: number;
    archived_at: number | null;
}

export interface RecordsStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 50;

/**
 * CRUD over the `record_types` + `records` tables. Stays auth-agnostic
 * — the host passes `orgId` and `createdBy` explicitly. No host-side
 * validation of `customFields` happens here; the store treats it as
 * opaque JSON and round-trips it.
 */
export class RecordsStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: RecordsStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    // --- Record types ---------------------------------------------------

    createRecordType(input: CreateRecordTypeInput): RecordType {
        const id = this.newId();
        const now = this.clock();
        prepareCached<[string, string, string, string, string, number, number]>(
            this.db,
            `INSERT INTO record_types
                (id, org_id, key, name, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.orgId,
            input.key,
            input.name,
            input.description ?? '',
            now,
            now,
        );
        return this.getRecordType(id)!;
    }

    getRecordType(id: string): RecordType | null {
        const row = prepareCached<[string], RecordTypeRow>(
            this.db,
            `SELECT * FROM record_types WHERE id = ?`,
        ).get(id);
        return row ? rowToRecordType(row) : null;
    }

    getRecordTypeByKey(orgId: string, key: string): RecordType | null {
        const row = prepareCached<[string, string], RecordTypeRow>(
            this.db,
            `SELECT * FROM record_types WHERE org_id = ? AND key = ?`,
        ).get(orgId, key);
        return row ? rowToRecordType(row) : null;
    }

    listRecordTypes(orgId: string): RecordType[] {
        return prepareCached<[string], RecordTypeRow>(
            this.db,
            `SELECT * FROM record_types
             WHERE org_id = ?
             ORDER BY name COLLATE NOCASE`,
        )
            .all(orgId)
            .map(rowToRecordType);
    }

    updateRecordType(id: string, patch: UpdateRecordTypeInput): RecordType | null {
        const existing = this.getRecordType(id);
        if (!existing) return null;
        const now = this.clock();
        prepareCached<[string, string, number, string]>(
            this.db,
            `UPDATE record_types SET name = ?, description = ?, updated_at = ?
             WHERE id = ?`,
        ).run(
            patch.name ?? existing.name,
            patch.description ?? existing.description,
            now,
            id,
        );
        return this.getRecordType(id);
    }

    /**
     * Delete a record type and cascade-delete every record of that
     * type. Returns true when a row was removed.
     */
    deleteRecordType(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM record_types WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Records --------------------------------------------------------

    createRecord(input: CreateRecordInput): BusinessRecord {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [string, string, string, string, string, string | null, number, number]
        >(
            this.db,
            `INSERT INTO records
                (id, org_id, type_id, title, custom_fields, created_by, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.orgId,
            input.typeId,
            input.title,
            jsonColumn.serialize(input.customFields ?? {}),
            input.createdBy ?? null,
            now,
            now,
        );
        return this.getRecord(id)!;
    }

    getRecord(id: string): BusinessRecord | null {
        const row = prepareCached<[string], RecordRow>(
            this.db,
            `SELECT * FROM records WHERE id = ?`,
        ).get(id);
        return row ? rowToRecord(row) : null;
    }

    updateRecord(id: string, patch: UpdateRecordInput): BusinessRecord | null {
        const existing = this.getRecord(id);
        if (!existing) return null;
        const now = this.clock();
        const nextTitle = patch.title ?? existing.title;
        const nextFieldsJson =
            patch.customFields === undefined
                ? jsonColumn.serialize(existing.customFields)
                : jsonColumn.serialize(patch.customFields);
        prepareCached<[string, string, number, string]>(
            this.db,
            `UPDATE records SET title = ?, custom_fields = ?, updated_at = ?
             WHERE id = ?`,
        ).run(nextTitle, nextFieldsJson, now, id);
        return this.getRecord(id);
    }

    archiveRecord(id: string): BusinessRecord | null {
        const existing = this.getRecord(id);
        if (!existing) return null;
        const now = this.clock();
        prepareCached<[number, number, string]>(
            this.db,
            `UPDATE records SET archived_at = ?, updated_at = ? WHERE id = ?`,
        ).run(now, now, id);
        return this.getRecord(id);
    }

    unarchiveRecord(id: string): BusinessRecord | null {
        const existing = this.getRecord(id);
        if (!existing) return null;
        const now = this.clock();
        prepareCached<[number, string]>(
            this.db,
            `UPDATE records SET archived_at = NULL, updated_at = ? WHERE id = ?`,
        ).run(now, id);
        return this.getRecord(id);
    }

    deleteRecord(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM records WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    /**
     * List records for an org with optional type filter, title search,
     * and ordering. Pagination via limit/offset; `limit` is capped at
     * {@link MAX_LIMIT} to avoid pathological reads. Archived rows are
     * excluded unless `includeArchived` is set.
     */
    listRecords(opts: ListRecordsOptions): BusinessRecord[] {
        const limit = Math.min(
            Math.max(1, opts.limit ?? DEFAULT_LIMIT),
            MAX_LIMIT,
        );
        const offset = Math.max(0, opts.offset ?? 0);
        const where: string[] = ['org_id = ?'];
        const params: unknown[] = [opts.orgId];
        if (opts.typeId) {
            where.push('type_id = ?');
            params.push(opts.typeId);
        }
        if (!opts.includeArchived) {
            where.push('archived_at IS NULL');
        }
        if (opts.search && opts.search.trim() !== '') {
            where.push('title LIKE ? COLLATE NOCASE');
            params.push(`%${opts.search.trim()}%`);
        }
        const orderBy =
            opts.order === 'title_asc'
                ? 'title COLLATE NOCASE ASC'
                : opts.order === 'created_desc'
                  ? 'created_at DESC'
                  : 'updated_at DESC';
        const sql = `SELECT * FROM records
                     WHERE ${where.join(' AND ')}
                     ORDER BY ${orderBy}
                     LIMIT ? OFFSET ?`;
        params.push(limit, offset);
        const rows = prepareCached<unknown[], RecordRow>(this.db, sql).all(
            ...params,
        );
        return rows.map(rowToRecord);
    }

    /** Count matching the same filter set as {@link listRecords}. */
    countRecords(opts: Omit<ListRecordsOptions, 'limit' | 'offset' | 'order'>): number {
        const where: string[] = ['org_id = ?'];
        const params: unknown[] = [opts.orgId];
        if (opts.typeId) {
            where.push('type_id = ?');
            params.push(opts.typeId);
        }
        if (!opts.includeArchived) {
            where.push('archived_at IS NULL');
        }
        if (opts.search && opts.search.trim() !== '') {
            where.push('title LIKE ? COLLATE NOCASE');
            params.push(`%${opts.search.trim()}%`);
        }
        const row = prepareCached<unknown[], { c: number }>(
            this.db,
            `SELECT COUNT(*) AS c FROM records WHERE ${where.join(' AND ')}`,
        ).get(...params);
        return row?.c ?? 0;
    }
}

function rowToRecordType(row: RecordTypeRow): RecordType {
    return {
        id: row.id,
        orgId: row.org_id,
        key: row.key,
        name: row.name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToRecord(row: RecordRow): BusinessRecord {
    let customFields: Record<string, unknown> = {};
    try {
        const parsed = jsonColumn.parse<unknown>(row.custom_fields);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            customFields = parsed as Record<string, unknown>;
        }
    } catch {
        /* tolerate corrupt JSON — surface as empty object */
    }
    return {
        id: row.id,
        orgId: row.org_id,
        typeId: row.type_id,
        title: row.title,
        customFields,
        createdBy: row.created_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at,
    };
}
