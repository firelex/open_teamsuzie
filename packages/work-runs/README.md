# @teamsuzie/work-runs

Generic work-run state and lifecycle: a run claims one item at a time out of
a host-defined queue, tracks completed/blocked/created item ids, and
supports pause/resume across restarts. The package is agnostic about what
"items" are and what `mode`/`scope` mean — use it when a host needs that
run bookkeeping without pulling in a specific domain's data model.

```ts
import { WorkRunsStore, JsonFileStorage } from '@teamsuzie/work-runs';

const store = new WorkRunsStore({
  storage: new JsonFileStorage('./data/work-runs.json'),
});

// On server startup: fail runs an interrupted process left "running".
store.markInterruptedFailed();

const run = store.create({
  subjectId: 'project-42',
  mode: 'ready_queue',
  scope: 'all-open-tickets',
});

store.claimItem('ticket-7');
store.completeActiveItem();
store.claimItem('ticket-8');
store.blockActiveItem({ notes: 'Waiting on customer reply' });

store.current(); // the one non-terminal run for this store, or null
store.finishEmpty({ notes: 'No more eligible items.' });
```

## Main exports

- `WorkRunsStore` — `list`, `get`, `current` (first non-terminal run),
  `create` (supersedes any existing live run as `completed`), `update`,
  `markInterruptedFailed` (sweeps `running`/`blocked` runs to `failed` —
  call at startup), `recoverInterrupted` (flips a recoverable `failed` run
  back to `running`), and the lifecycle transitions `claimItem`,
  `completeActiveItem`, `blockActiveItem`, `finishEmpty`.
- `WorkRunError` — thrown by lifecycle methods; carries an HTTP-friendly
  `.status` (e.g. 409 for "no active work run").
- `WorkRunsStorage` — the persistence interface (`readAll`/`writeAll`);
  implement it to back runs with your own store.
- `InMemoryStorage`, `JsonFileStorage` — ship-with-the-package
  implementations: an array for tests, and a single JSON file
  (`{ runs: WorkRun[] }`) for a small host. `JsonFileStorage` creates its
  parent directory on first write.
- `WorkRun`, `WorkRunStatus`, `CreateWorkRunInput`, `WorkRunPatch` — the
  row shape and its five statuses: `running`, `paused`, `blocked`,
  `completed`, `failed`.

## Notable behaviour

- `mode` and `scope` are opaque strings the package never interprets —
  different hosts can use different vocabularies without any change here.
- `create` treats "one live run per store" as the invariant: starting a new
  run marks any existing `running`/`paused`/`blocked` run `completed` with
  a "Superseded by a newer work run." note.
- Lifecycle methods (`claimItem`, `completeActiveItem`, `blockActiveItem`,
  `finishEmpty`) all require a `running` run to exist and throw
  `WorkRunError` otherwise — they don't validate the item ids themselves;
  that's the host's job.
- This package is not yet wired into any app or other package in this
  repo — it has no SQLite migration and no router; persistence is purely
  through the `WorkRunsStorage` interface.
