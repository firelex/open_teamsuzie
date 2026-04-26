# @teamsuzie/db-sqlite

Thin SQLite plumbing for Team Suzie apps. Wraps `better-sqlite3` with sane defaults, idempotent migrations, a prepared-statement cache, and JSON-column helpers.

## When to use this

- An app needs **local relational state** (saved prompts, session history, draft snapshots, audit trails).
- The state is **per-app**, not shared across apps. Don't use this for multi-tenant production user data — that's `@teamsuzie/shared-auth` + Postgres territory.
- You want to ship without requiring users to run Docker or provision a database.

## When **not** to use this

- You need a remote DB or multi-process write concurrency. SQLite tolerates many readers + one writer; for true concurrent writes from multiple processes, use Postgres.
- You need a full-text search index across millions of rows. Use `vector-db` / `graph-db` services or Postgres + `pgvector`.
- Your data is genuinely shared across services. Put it behind an HTTP service.

## Quickstart

```ts
import { openDb, type Migration } from '@teamsuzie/db-sqlite';

const migrations: Migration[] = [
  {
    name: '20260101_create_user_prompts',
    up: `
      CREATE TABLE IF NOT EXISTS user_prompts (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        practice_areas TEXT NOT NULL,
        prompt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_user_prompts_created ON user_prompts(created_at DESC);
    `,
  },
];

const db = openDb({
  path: './data/lawyer.db',
  migrations,
});

// Use better-sqlite3 directly — no ORM.
db.prepare('INSERT INTO user_prompts (id, title, description, practice_areas, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
  'pmpt_abc',
  'Draft email from notes',
  'Turn notes into an email.',
  JSON.stringify(['general']),
  'Draft a professional email...',
  Date.now(),
);
```

## Defaults set by `openDb`

| Pragma | Value | Why |
|---|---|---|
| `journal_mode` | `WAL` | Multi-reader-friendly; survives crash |
| `foreign_keys` | `ON` | Enforces declared FKs (off by default in SQLite) |
| `synchronous` | `NORMAL` | Reasonable durability without full fsync overhead |

Override or extend with `openDb({ ..., pragma: { cache_size: -64000 } })`.

## Migrations

`openDb` records applied migration names in a `_migrations` table and runs each unapplied one inside a transaction. Migrations are **forward-only** — there are no down migrations. Make `up` SQL idempotent (`IF NOT EXISTS`, `ALTER TABLE` instead of recreate).

## Prepared statement cache

`prepareCached(db, sql)` caches by SQL string per-database. Use it when you'd otherwise re-prepare the same statement in a hot loop:

```ts
import { prepareCached } from '@teamsuzie/db-sqlite';

function lookup(id: string) {
  return prepareCached<[string], { id: string; title: string }>(
    db,
    'SELECT id, title FROM user_prompts WHERE id = ?',
  ).get(id);
}
```

## JSON columns

SQLite stores JSON as TEXT. `jsonColumn.serialize` and `jsonColumn.parse` give typed boundaries so call sites stay honest:

```ts
import { jsonColumn } from '@teamsuzie/db-sqlite';

const row = db.prepare('SELECT practice_areas FROM user_prompts WHERE id = ?').get(id) as { practice_areas: string };
const areas = jsonColumn.parse<string[]>(row.practice_areas);
```

For nullable columns, use `jsonColumn.parseNullable`.

## Why we picked better-sqlite3

Synchronous API (no callback hell, no async noise around transactions), fast, well-maintained, and supports modern Node. Native bindings ship prebuilt for common platforms.
