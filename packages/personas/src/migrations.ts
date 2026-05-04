import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Migrations a consuming app should add to its `openDb({ migrations })` call
 * to use the SQLite-backed user-personas store. Idempotent — `IF NOT EXISTS`
 * everywhere — but each migration name is also recorded in `_migrations` so
 * it runs exactly once.
 */
export const PERSONAS_MIGRATIONS: Migration[] = [
  {
    name: '20260427_create_personas',
    up: `
      CREATE TABLE IF NOT EXISTS personas (
        id            TEXT PRIMARY KEY,
        owner_id      TEXT NOT NULL,
        name          TEXT NOT NULL,
        description   TEXT NOT NULL DEFAULT '',
        avatar        TEXT,
        model         TEXT,
        allowed_tools TEXT,
        blocked_tools TEXT,
        system_prompt TEXT NOT NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_personas_owner ON personas(owner_id);
    `,
  },
];
