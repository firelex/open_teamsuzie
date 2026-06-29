import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { EVENTS_MIGRATIONS } from '@teamsuzie/events';

/**
 * Open the app's SQLite database. Creates the session table the OAuth layer
 * needs and applies the @teamsuzie/events migrations (the events/audit table is
 * owned by that package). The build agent adds its own domain tables here.
 */
export function openDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      session_id              TEXT PRIMARY KEY,
      sub                     TEXT NOT NULL,
      email                   TEXT NOT NULL,
      name                    TEXT NOT NULL DEFAULT '',
      refresh_token_enc       TEXT NOT NULL,
      access_token            TEXT NOT NULL,
      access_token_expires_at TEXT NOT NULL,
      last_seen_at            TEXT NOT NULL,
      expires_at              TEXT NOT NULL,
      created_at              TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_sub ON user_sessions(sub);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
  `);

  // Events/audit table is owned by @teamsuzie/events (idempotent).
  for (const m of EVENTS_MIGRATIONS) db.exec(m.up);

  return db;
}
