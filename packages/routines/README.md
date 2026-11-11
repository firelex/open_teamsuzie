# @teamsuzie/routines

Scheduled and triggered agent work. A routine has a five-field cron schedule read in an IANA time zone, a host-defined
payload, and two policies:

- **overlap**: `skip` (default) records a skipped run while the previous run is still going; `allow` starts another.
- **catch-up**: `skip` (default) records one missed run after downtime; `run_once` runs once for everything missed.

`RoutineScheduler.tick()` handles every due routine once and records each outcome (`started` with the host's ref,
`skipped` with why, `failed` with the error). The next run is always computed from now. `runNow` serves manual and
webhook triggers; webhook tokens are stored as SHA-256 hashes and shown once.

```ts
const store = new RoutineStore<MyPayload>({ db });
const scheduler = new RoutineScheduler({ store, fire: (r) => ({ ref: createTask(r.payload).id }), isActive: (ref) => taskIsRunning(ref) });
scheduler.start();
```
