import { prepareCached, jsonColumn, type DatabaseInstance } from '@teamsuzie/db-sqlite';
import type { AppendEventInput, DepartmentEvent } from './types.js';

interface EventRow {
    id: number;
    subject_id: string;
    chat_id: string | null;
    ts: string;
    source: string;
    kind: string;
    payload: string;
    correlation_id: string | null;
}

function fromRow(r: EventRow): DepartmentEvent {
    return {
        id: r.id,
        subjectId: r.subject_id,
        chatId: r.chat_id,
        ts: r.ts,
        source: r.source,
        kind: r.kind,
        payload: jsonColumn.parse(r.payload),
        correlationId: r.correlation_id,
    };
}

export interface EventsStoreOptions {
    db: DatabaseInstance;
    /** Override the timestamp source — useful for tests. Returns an ISO string. */
    now?: () => string;
}

export class EventsStore {
    private readonly db: DatabaseInstance;
    private readonly clock: () => string;

    constructor(opts: EventsStoreOptions) {
        this.db = opts.db;
        this.clock = opts.now ?? (() => new Date().toISOString());
    }

    append(input: AppendEventInput): DepartmentEvent {
        const ts = this.clock();
        const info = prepareCached(
            this.db,
            `INSERT INTO events (subject_id, chat_id, ts, source, kind, payload, correlation_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            input.subjectId,
            input.chatId ?? null,
            ts,
            input.source,
            input.kind,
            jsonColumn.serialize(input.payload),
            input.correlationId ?? null,
        );
        return {
            id: Number(info.lastInsertRowid),
            subjectId: input.subjectId,
            chatId: input.chatId ?? null,
            ts,
            source: input.source,
            kind: input.kind,
            payload: input.payload,
            correlationId: input.correlationId ?? null,
        };
    }

    /**
     * Most recent `limit` events for one chat, returned in chronological
     * (id ASC) order. Takes the TAIL of the table — a long-lived chat can
     * accumulate thousands of events and consumers care about what
     * happened recently.
     */
    listByChat(chatId: string, limit = 1000): DepartmentEvent[] {
        const rows = prepareCached<[string, number], EventRow>(
            this.db,
            `SELECT * FROM (
                SELECT * FROM events WHERE chat_id = ? ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`,
        ).all(chatId, limit);
        return rows.map(fromRow);
    }

    /** All events for a chat with id > sinceId, in chronological order. */
    listSinceForChat(chatId: string, sinceId: number): DepartmentEvent[] {
        const rows = prepareCached<[string, number], EventRow>(
            this.db,
            `SELECT * FROM events WHERE chat_id = ? AND id > ? ORDER BY id ASC`,
        ).all(chatId, sinceId);
        return rows.map(fromRow);
    }

    /** Events for a chat filtered to the given kinds. */
    listByKindsForChat(chatId: string, kinds: string[]): DepartmentEvent[] {
        if (kinds.length === 0) return [];
        // prepareCached intentionally skipped: the placeholder count varies
        // with the kinds array length, so each call shape is a different SQL
        // string and caching would explode.
        const placeholders = kinds.map(() => '?').join(',');
        const rows = this.db.prepare(
            `SELECT * FROM events WHERE chat_id = ? AND kind IN (${placeholders}) ORDER BY id ASC`,
        ).all(chatId, ...kinds) as EventRow[];
        return rows.map(fromRow);
    }

    /** All events for a subject (across all its chats), in chronological order. */
    listBySubject(subjectId: string, limit = 1000): DepartmentEvent[] {
        const rows = prepareCached<[string, number], EventRow>(
            this.db,
            `SELECT * FROM (
                SELECT * FROM events WHERE subject_id = ? ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC`,
        ).all(subjectId, limit);
        return rows.map(fromRow);
    }

    /** All events with the given correlation id, in chronological order. */
    listByCorrelation(correlationId: string): DepartmentEvent[] {
        const rows = prepareCached<[string], EventRow>(
            this.db,
            `SELECT * FROM events WHERE correlation_id = ? ORDER BY id ASC`,
        ).all(correlationId);
        return rows.map(fromRow);
    }

    clearForChat(chatId: string): void {
        prepareCached(this.db, `DELETE FROM events WHERE chat_id = ?`).run(chatId);
    }

    clearForSubject(subjectId: string): void {
        prepareCached(this.db, `DELETE FROM events WHERE subject_id = ?`).run(subjectId);
    }
}
