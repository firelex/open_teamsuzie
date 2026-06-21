import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Two tables: `record_types` (per-org type catalog) and `records` (rows
 * of any type). No foreign keys to other packages — `org_id` and
 * `created_by` are opaque strings, matching the loose-coupling pattern
 * used by `@teamsuzie/workflows` and `@teamsuzie/sharing`. Type
 * deletion cascades to records via `ON DELETE CASCADE` since records
 * cannot exist without their type definition.
 */
export const RECORDS_MIGRATIONS: Migration[] = [
    {
        name: '20260607_create_record_types',
        up: `
            CREATE TABLE IF NOT EXISTS record_types (
                id          TEXT PRIMARY KEY,
                org_id      TEXT NOT NULL,
                key         TEXT NOT NULL,
                name        TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                created_at  INTEGER NOT NULL,
                updated_at  INTEGER NOT NULL,
                UNIQUE (org_id, key)
            );
            CREATE INDEX IF NOT EXISTS idx_record_types_org
                ON record_types(org_id);
        `,
    },
    {
        name: '20260607_create_records',
        up: `
            CREATE TABLE IF NOT EXISTS records (
                id            TEXT PRIMARY KEY,
                org_id        TEXT NOT NULL,
                type_id       TEXT NOT NULL REFERENCES record_types(id) ON DELETE CASCADE,
                title         TEXT NOT NULL DEFAULT '',
                /* JSON object — opaque to the store. */
                custom_fields TEXT NOT NULL DEFAULT '{}',
                created_by    TEXT,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL,
                archived_at   INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_records_org_type_updated
                ON records(org_id, type_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_records_org_updated
                ON records(org_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_records_archived
                ON records(org_id, archived_at);
        `,
    },
];
