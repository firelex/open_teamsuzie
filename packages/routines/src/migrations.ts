import type { Migration } from '@teamsuzie/db-sqlite';

export const ROUTINES_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_routines',
        up: `
            CREATE TABLE IF NOT EXISTS routines (
                id            TEXT PRIMARY KEY,
                subject_type  TEXT NOT NULL,
                subject_id    TEXT NOT NULL,
                name          TEXT NOT NULL,
                schedule      TEXT NOT NULL,
                timezone      TEXT NOT NULL,
                enabled       INTEGER NOT NULL,
                overlap       TEXT NOT NULL CHECK (overlap IN ('skip', 'allow')),
                catch_up      TEXT NOT NULL CHECK (catch_up IN ('skip', 'run_once')),
                payload       TEXT NOT NULL,
                webhook_hash  TEXT,
                next_run_at   INTEGER,
                last_run_at   INTEGER,
                created_by    TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_routines_subject ON routines(subject_type, subject_id);
            CREATE INDEX IF NOT EXISTS idx_routines_due ON routines(enabled, next_run_at);

            CREATE TABLE IF NOT EXISTS routine_runs (
                id          TEXT PRIMARY KEY,
                routine_id  TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
                trigger     TEXT NOT NULL,
                actor       TEXT NOT NULL,
                due_at      INTEGER NOT NULL,
                fired_at    INTEGER NOT NULL,
                status      TEXT NOT NULL,
                ref         TEXT,
                detail      TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_routine_runs_routine ON routine_runs(routine_id, fired_at);
        `,
    },
];
