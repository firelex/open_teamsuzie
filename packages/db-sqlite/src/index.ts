import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database, { type Database as DatabaseInstance, type Statement } from 'better-sqlite3';

/**
 * One forward migration. `up` should be idempotent SQL (typically
 * `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, or `ALTER TABLE
 * ... ADD COLUMN`). Names are recorded in `_migrations` so each runs exactly
 * once — but the SQL itself should still be safe to re-run.
 */
export interface Migration {
  /** Stable identifier — recorded in the `_migrations` table. Use a date or sequence prefix to make ordering obvious, e.g. `20260101_create_user_prompts`. */
  name: string;
  /** SQL to execute. May contain multiple statements separated by semicolons. */
  up: string;
}

export interface OpenDbOptions {
  /** Filesystem path. Use `:memory:` for an in-memory db. The parent directory is created if missing. */
  path: string;
  /** Forward migrations to apply in order. Each runs at most once. */
  migrations?: Migration[];
  /** Extra pragmas to set after opening, in addition to the defaults. */
  pragma?: Record<string, string | number>;
  /** Pass-through better-sqlite3 options. */
  readonly?: boolean;
  fileMustExist?: boolean;
  timeout?: number;
}

const DEFAULT_PRAGMAS: Record<string, string | number> = {
  // Durable, multi-reader-friendly journaling. Safe default for app data.
  journal_mode: 'WAL',
  // Enforce declared foreign keys (off by default in sqlite).
  foreign_keys: 'ON',
  // Reasonable durability without paying full fsync.
  synchronous: 'NORMAL',
};

function applyPragmas(db: DatabaseInstance, pragmas: Record<string, string | number>): void {
  for (const [key, value] of Object.entries(pragmas)) {
    db.pragma(`${key} = ${value}`);
  }
}

function ensureMigrationsTable(db: DatabaseInstance): void {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
}

function runMigrations(db: DatabaseInstance, migrations: Migration[]): void {
  if (migrations.length === 0) return;

  ensureMigrationsTable(db);
  const isApplied = db.prepare<[string], { name: string }>('SELECT name FROM _migrations WHERE name = ?');
  const recordApplied = db.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (isApplied.get(migration.name)) continue;
    const tx = db.transaction(() => {
      db.exec(migration.up);
      recordApplied.run(migration.name, Date.now());
    });
    tx();
  }
}

/**
 * Open a SQLite database with sane defaults (WAL, foreign keys ON, NORMAL
 * sync), apply any migrations, and return the better-sqlite3 instance for
 * direct use.
 *
 * Why this wrapper exists: every Team Suzie app that needs local persistence
 * was about to repeat the same pragmas, the same parent-directory creation,
 * and the same idempotent-migration plumbing. Keeping that plumbing here
 * means apps only write their schemas and queries.
 *
 * Schemas are *not* in this package — each app brings its own.
 */
export function openDb(options: OpenDbOptions): DatabaseInstance {
  const { path, migrations = [], pragma = {}, readonly, fileMustExist, timeout } = options;

  if (path !== ':memory:' && !readonly && !fileMustExist) {
    mkdirSync(dirname(path), { recursive: true });
  }

  // better-sqlite3 strictly type-checks options — only forward defined values.
  const dbOptions: Database.Options = {};
  if (readonly !== undefined) dbOptions.readonly = readonly;
  if (fileMustExist !== undefined) dbOptions.fileMustExist = fileMustExist;
  if (timeout !== undefined) dbOptions.timeout = timeout;

  const db = new Database(path, dbOptions);
  applyPragmas(db, { ...DEFAULT_PRAGMAS, ...pragma });
  runMigrations(db, migrations);
  return db;
}

/**
 * Prepared-statement cache. Re-preparing the same SQL on every call wastes
 * cycles; this caches by SQL string per-database.
 */
const stmtCache = new WeakMap<DatabaseInstance, Map<string, Statement>>();

export function prepareCached<TParams extends unknown[] = unknown[], TResult = unknown>(
  db: DatabaseInstance,
  sql: string,
): Statement<TParams, TResult> {
  let perDb = stmtCache.get(db);
  if (!perDb) {
    perDb = new Map();
    stmtCache.set(db, perDb);
  }
  const cached = perDb.get(sql);
  if (cached) return cached as Statement<TParams, TResult>;
  const stmt = db.prepare<TParams, TResult>(sql);
  perDb.set(sql, stmt as unknown as Statement);
  return stmt;
}

/**
 * SQLite has no native JSON type — values are stored as TEXT. These helpers
 * give a typed serialize/parse boundary so call sites can be explicit.
 */
export const jsonColumn = {
  serialize<T>(value: T): string {
    return JSON.stringify(value);
  },
  parse<T>(value: string): T {
    return JSON.parse(value) as T;
  },
  /** Tolerant of NULL — returns `null` instead of throwing. */
  parseNullable<T>(value: string | null | undefined): T | null {
    if (value == null) return null;
    return JSON.parse(value) as T;
  },
};

export type { DatabaseInstance };
export { Database };
