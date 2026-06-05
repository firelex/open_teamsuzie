import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Append-only event log scoped by `subject_id` (top-level host scope —
 * project, matter, user, etc.) and optional `chat_id` (chat fan-out).
 *
 * `source` is intentionally an open TEXT column with no CHECK constraint —
 * hosts plug in their own agent identities (`claude`, `codex`, an EA
 * persona name, …) without needing a schema change here.
 *
 * `payload` and `correlation_id` are host-extensible: the generic store
 * doesn't interpret them, so a host can stash extra context (a
 * `_roadmap_item_id` field, a workflow run id, …) inside `payload` and
 * pull it back out in its own adapter.
 *
 * No foreign keys: the events package doesn't know about the host's
 * subject or chat tables. Hosts wanting cascade-on-delete behavior call
 * `clearForSubject` / `clearForChat` explicitly from their own cleanup
 * paths.
 */
export const EVENTS_MIGRATIONS: Migration[] = [
    {
        name: '20260605_create_events',
        up: `
            CREATE TABLE IF NOT EXISTS events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                subject_id      TEXT NOT NULL,
                chat_id         TEXT,
                ts              TEXT NOT NULL,
                source          TEXT NOT NULL,
                kind            TEXT NOT NULL,
                payload         TEXT NOT NULL,
                correlation_id  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_events_subject_id
                ON events(subject_id, id);
            CREATE INDEX IF NOT EXISTS idx_events_subject_kind
                ON events(subject_id, kind);
            CREATE INDEX IF NOT EXISTS idx_events_chat_id
                ON events(chat_id, id);
            CREATE INDEX IF NOT EXISTS idx_events_correlation
                ON events(correlation_id);
        `,
    },
];
