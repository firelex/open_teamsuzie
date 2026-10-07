# @teamsuzie/personas

Persona registry: read-only "builtin" personas loaded from `<id>/PERSONA.md` files on disk, merged at runtime with per-owner, SQLite-backed "user" personas. Use it whenever an app lets a caller pick (or author) an agent identity — a system prompt plus optional model/tool overrides — rather than hard-coding one system prompt for every chat.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import {
  PersonaRegistry,
  PERSONAS_MIGRATIONS,
  createPersonasRouter,
  applyPersona,
} from '@teamsuzie/personas';

const db = openDb({ path: './data/app.db', migrations: PERSONAS_MIGRATIONS });

const registry = new PersonaRegistry({
  filesystemDir: './personas', // each entry is <id>/PERSONA.md
  db,
});

// Seeded builtins become editable per-owner copies on first use.
registry.seedFromBuiltinsIfNeeded('user@example.com');

const persona = registry.get('research-analyst', 'user@example.com');
const { systemPrompt, tools, modelOverride } = applyPersona({
  defaultSystemPrompt: 'You are Counsel, a legal assistant.',
  tools: allServerTools,
  persona,
});

app.use('/api/personas', requireAuth, createPersonasRouter({
  registry,
  getOwnerId: (req) => req.session?.user?.email,
}));
```

## Main exports

- `PersonaRegistry` — merges `filesystemDir` builtins with optional `inlinePersonas` (for manifest-only builds) and SQLite user personas; `listBuiltins`, `listForOwner`, `listVisibleTo`, `get`, `create`, `update`, `delete`, `isSeeded`, `seedFromBuiltinsIfNeeded`.
- `PersonaStore` — the SQLite CRUD layer `PersonaRegistry` uses internally for user personas; ownership (`ownerId`) is enforced by the caller on every read.
- `loadPersonasFromDir`, `parsePersonaFile` — read `PERSONA.md` files and their YAML-like frontmatter.
- `createPersonasRouter` — REST endpoints: `GET /`, `GET /:id`, `POST /`, `PATCH /:id`, `DELETE /:id` (builtins are immutable and return 403 on patch/delete).
- `filterToolsForPersona`, `applyPersona` — pure helpers that resolve a persona's tool allow/block lists and merge its system prompt with a default and a skill prompt.
- `PERSONAS_MIGRATIONS` — the `personas` and `personas_seeded` table migrations an app adds to its own `openDb({ migrations })` call.

## PERSONA.md format

A builtin lives at `<filesystemDir>/<id>/PERSONA.md`: optional `---` frontmatter (`name`, `description`, `avatar`, `model`, `allowedTools`, `blockedTools` — lists as `a, b, c` or a JSON array) followed by the system-prompt body. A file with no body after the frontmatter is skipped. `allowedTools`/`blockedTools` containing `"*"` means "all tools"; `filterToolsForPersona` treats a missing `allowedTools` the same way.

## Notable behaviour

- Once an owner has been seeded (`seedFromBuiltinsIfNeeded`), `listVisibleTo`/the router's `source=all|builtin` views stop returning the file-based originals — the owner now has editable copies, so re-listing the originals would duplicate them.
- `PersonaRegistry.create/update/delete` throw if constructed without a `db`, and `update`/`delete` refuse to touch a builtin id.
- The router's `GET /` supports optional `?page`/`?pageSize` (paging is opt-in; omit both for the full list) and a case-insensitive `?q` substring filter against name + description.

Used by `@teamsuzie/agent-runtime` (persona-aware chat routing), `@teamsuzie/ui`'s `use-personas` hook, and the `starter-*` example apps.
