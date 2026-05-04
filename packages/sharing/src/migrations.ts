import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Cross-subject membership table. One row per (subject, user) grant; a
 * unique constraint prevents duplicate rows so re-granting upserts the
 * role rather than stacking. No cascades — host apps clean up explicitly
 * via `removeMembersFor(subject)` when a subject is deleted.
 */
export const SHARING_MIGRATIONS: Migration[] = [
    {
        name: '20260503_create_members',
        up: `
            CREATE TABLE IF NOT EXISTS members (
                id            TEXT PRIMARY KEY,
                subject_type  TEXT NOT NULL,
                subject_id    TEXT NOT NULL,
                user_id       TEXT NOT NULL,
                role          TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
                granted_at    INTEGER NOT NULL,
                granted_by    TEXT,
                UNIQUE (subject_type, subject_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_members_subject
                ON members(subject_type, subject_id);
            CREATE INDEX IF NOT EXISTS idx_members_user
                ON members(user_id, subject_type);
        `,
    },
];
