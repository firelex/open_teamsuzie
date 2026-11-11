import type { Migration } from '@teamsuzie/db-sqlite';

export const AGENT_TASKS_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_agent_tasks',
        up: `
            CREATE TABLE IF NOT EXISTS agent_tasks (
                id                TEXT PRIMARY KEY,
                subject_type      TEXT NOT NULL,
                subject_id        TEXT NOT NULL,
                title             TEXT NOT NULL,
                instructions      TEXT NOT NULL,
                owner_id          TEXT NOT NULL,
                created_by        TEXT NOT NULL,
                agent             TEXT NOT NULL,
                model             TEXT,
                sign_off_required INTEGER NOT NULL,
                status            TEXT NOT NULL CHECK (status IN ('queued','running','blocked','in_review','done','failed','cancelled')),
                conversation_id   TEXT,
                next_prompt       TEXT NOT NULL,
                blocker           TEXT,
                error             TEXT,
                run_count         INTEGER NOT NULL DEFAULT 0,
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL,
                started_at        INTEGER,
                finished_at       INTEGER,
                signed_off_by     TEXT,
                signed_off_at     INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_agent_tasks_subject ON agent_tasks(subject_type, subject_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_agent_tasks_owner ON agent_tasks(owner_id, status);
            CREATE INDEX IF NOT EXISTS idx_agent_tasks_queue ON agent_tasks(status, created_at);

            CREATE TABLE IF NOT EXISTS agent_task_events (
                id         TEXT PRIMARY KEY,
                task_id    TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
                kind       TEXT NOT NULL,
                actor      TEXT NOT NULL,
                text       TEXT NOT NULL,
                data       TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_agent_task_events_task ON agent_task_events(task_id, created_at);
        `,
    },
];
