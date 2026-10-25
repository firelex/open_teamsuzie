import { openDb, type DatabaseInstance, type Migration } from '@teamsuzie/db-sqlite';

const MIGRATIONS: Migration[] = [
    {
        name: '20261025_email_agent',
        up: `
            CREATE TABLE IF NOT EXISTS approvals (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                subject_id TEXT NOT NULL,
                action_type TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                status TEXT NOT NULL,
                review_json TEXT,
                dispatch_json TEXT,
                metadata_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS approvals_job ON approvals (job_id);
            CREATE INDEX IF NOT EXISTS approvals_status ON approvals (status, created_at);

            CREATE TABLE IF NOT EXISTS op_health (
                account TEXT NOT NULL,
                operation TEXT NOT NULL,
                state TEXT NOT NULL,
                since TEXT NOT NULL,
                last_error TEXT,
                send_unconfirmed INTEGER NOT NULL DEFAULT 0,
                last_relearn_at TEXT,
                PRIMARY KEY (account, operation)
            );

            CREATE TABLE IF NOT EXISTS alerts (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL,
                kind TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS new_mail (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                account TEXT NOT NULL,
                message_id TEXT NOT NULL,
                thread_id TEXT,
                sender TEXT NOT NULL,
                subject TEXT NOT NULL,
                date TEXT NOT NULL,
                snippet TEXT,
                seen_at TEXT NOT NULL,
                UNIQUE (account, message_id)
            );

            CREATE TABLE IF NOT EXISTS layout_baseline (
                account TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        `,
    },
];

/** The service's SQLite database: approvals, operation health, alerts, new mail and layout baselines. */
export function openAgentDb(path: string): DatabaseInstance {
    return openDb({ path, migrations: MIGRATIONS });
}

export type { DatabaseInstance };
