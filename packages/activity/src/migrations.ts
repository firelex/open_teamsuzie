import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * One activity table — append-only. No FKs to other packages; subject
 * refs are opaque (subject_type, subject_id) pairs to match
 * `@teamsuzie/sharing` and `@teamsuzie/pipelines`. Host apps that
 * delete a subject should call `removeForSubject` to cascade.
 */
export const ACTIVITY_MIGRATIONS: Migration[] = [
    {
        name: '20260607_create_activity_entries',
        up: `
            CREATE TABLE IF NOT EXISTS activity_entries (
                id            TEXT PRIMARY KEY,
                org_id        TEXT NOT NULL,
                subject_type  TEXT NOT NULL,
                subject_id    TEXT NOT NULL,
                actor_id      TEXT,
                actor_type    TEXT,
                kind          TEXT NOT NULL,
                summary       TEXT NOT NULL,
                body          TEXT,
                /* JSON object — opaque to the store. */
                metadata      TEXT NOT NULL DEFAULT '{}',
                at            INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_activity_subject
                ON activity_entries(org_id, subject_type, subject_id, at DESC);
            CREATE INDEX IF NOT EXISTS idx_activity_org_time
                ON activity_entries(org_id, at DESC);
            CREATE INDEX IF NOT EXISTS idx_activity_kind
                ON activity_entries(org_id, kind, at DESC);
        `,
    },
];
