import type { Migration } from '@teamsuzie/db-sqlite';

export const AI_SPEND_MIGRATIONS: Migration[] = [
    {
        name: '20261111_create_ai_spend',
        up: `
            CREATE TABLE IF NOT EXISTS ai_spend (
                id            TEXT PRIMARY KEY,
                at            INTEGER NOT NULL,
                actor         TEXT NOT NULL,
                source        TEXT NOT NULL,
                model         TEXT NOT NULL,
                input_tokens  INTEGER NOT NULL,
                output_tokens INTEGER NOT NULL,
                cost_micros   INTEGER,
                currency      TEXT NOT NULL,
                scope_type    TEXT,
                scope_id      TEXT,
                ref_type      TEXT,
                ref_id        TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_spend_scope ON ai_spend(scope_type, scope_id, at);
            CREATE INDEX IF NOT EXISTS idx_ai_spend_at ON ai_spend(at);

            CREATE TABLE IF NOT EXISTS ai_budgets (
                scope_type    TEXT NOT NULL,
                scope_id      TEXT NOT NULL,
                amount_micros INTEGER NOT NULL,
                currency      TEXT NOT NULL,
                period        TEXT NOT NULL CHECK (period IN ('total', 'month')),
                warn_ratio    REAL NOT NULL,
                set_by        TEXT NOT NULL,
                set_at        INTEGER NOT NULL,
                PRIMARY KEY (scope_type, scope_id)
            );
        `,
    },
];
