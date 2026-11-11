# @teamsuzie/workflows

SQLite schema + CRUD for workflows-as-data: reusable prompts a user can
launch from a library. System workflows (seeded from code) and user
workflows (created in the UI) share one table; use this when an app needs
a "Library" of launchable prompts with per-user hiding of system entries.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { WORKFLOWS_MIGRATIONS, WorkflowsStore, createWorkflowsRouter } from '@teamsuzie/workflows';

const db = openDb({ path: './data/app.db', migrations: WORKFLOWS_MIGRATIONS });
const store = new WorkflowsStore({ db });

// Seed system workflows at startup — re-running updates in place.
store.seedSystem([
  { id: 'summarize-matter', name: 'Summarize matter', prompt: 'Summarize this matter...' },
]);

const workflow = store.createUserWorkflow({
  ownerId: 'alice@example.com',
  name: 'Weekly client update',
  prompt: 'Draft a weekly update for the client covering...',
  practiceAreas: ['litigation'],
});

store.listVisible({ ownerId: 'alice@example.com' });

const router = createWorkflowsRouter({
  store,
  getOwnerId: (req) => (req as any).user?.email ?? null,
});
app.use('/api/workflows', router);
```

## Main exports

- `WorkflowsStore` — `upsertSystem` / `seedSystem` (bulk, removes stale
  system rows not in the seed list) for code-seeded rows; `seedAsUserIfEmpty`
  for copy-on-first-run user-owned defaults (idempotent via a seed-key
  marker); `createUserWorkflow`, `updateUserWorkflow`, `archive`,
  `unarchive`, `deleteUserWorkflow` for user rows; `hide` / `unhide` /
  `listHiddenIds` for per-user hiding of system rows; `get`, `listVisible`,
  `listBySource`; `listVersions` / `restoreVersion` for version history.
- `WORKFLOWS_MIGRATIONS` — pass to `openDb({ migrations })`.
- `createWorkflowsRouter` — mounts REST endpoints (list, create, get,
  patch, delete, archive/unarchive, hide/unhide, version list/restore); see
  the JSDoc on `router.ts` for the full route table.
- `WORKFLOW_OUTPUT_MODES` — the three `WorkflowOutputMode` values:
  `'inline_chat'` (default), `'generate_docx'`, `'tabular_review'`.

## Notable behaviour

- System rows are read-only through `updateUserWorkflow`/`archive`/etc. —
  they can only be hidden per-user, never edited or deleted. "Editing" one
  means forking it into a new user row.
- `outputMode` and `columnConfig` are opaque to this package; routing
  semantics (e.g. injecting a `generate_docx` tool, or launching a
  `tabular_review` via `@teamsuzie/grid-review`) are the host's concern.
- Every update and restore captures a `workflow_versions` snapshot in the
  same transaction, so a snapshot is never orphaned; system workflows are
  never versioned.
- `createWorkflowsRouter`'s `getOwnerId` returning falsy responds 401 on
  every endpoint that requires an owner.
