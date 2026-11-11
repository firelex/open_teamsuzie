# @teamsuzie/events

A generic, append-only department event log (SQLite-backed), an in-memory pub/sub bus, and an SSE helper for streaming events to clients. Reusable substrate for any app that needs a typed event stream scoped by subject and (optionally) chat.

Use it when a department-style app needs to record what happened (`EventsStore`), fan events out to live subscribers (`EventBus`), and push them to the browser over Server-Sent Events (`subscribeSse`).

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import {
  EVENTS_MIGRATIONS,
  EventsStore,
  EventBus,
  subscribeSse,
} from '@teamsuzie/events';

const db = openDb({ path: './data/app.db', migrations: EVENTS_MIGRATIONS });
const store = new EventsStore({ db });
const bus = new EventBus();

// Record + fan out an event.
const event = store.append({
  subjectId: 'project-1',
  chatId: 'chat-42',
  source: 'agent',
  kind: 'task.completed',
  payload: { taskId: 't-1' },
});
bus.publish(event);

// In an Express SSE route:
app.get('/api/events/:chatId/stream', (req, res) => {
  const chatId = req.params.chatId;
  const backfill = store.listByChat(chatId);
  subscribeSse({ res, bus, chatId, backfill });
});
```

## Main exports

- `EventsStore` — CRUD over the `events` table: `append(input)`, `listByChat(chatId, limit?)`, `listSinceForChat(chatId, sinceId)`, `listByKindsForChat(chatId, kinds)`, `listBySubject(subjectId, limit?)`, `listByCorrelation(correlationId)`, `clearForChat(chatId)`, `clearForSubject(subjectId)`.
- `EVENTS_MIGRATIONS` — the `Migration[]` (from `@teamsuzie/db-sqlite`) that creates the `events` table and its indexes; pass it to `openDb({ migrations })`.
- `EventBus` — in-memory fan-out: `subscribe(chatId | null, listener)` returns an unsubscribe function (`chatId: null` registers a wildcard listener that sees every event); `publish(event)` delivers to the matching chat's listeners plus all wildcards.
- `subscribeSse(opts)` — wires up the SSE protocol for one client: sets headers, flushes `backfill`, subscribes to `bus`, sends heartbeats, and cleans up on `req` close. Returns a teardown function. Options: `res`, `bus`, `chatId`, `backfill`, `heartbeatMs` (default 15000, `0` disables), `serialize`.
- Types: `DepartmentEvent`, `AppendEventInput`, `EventSource` (`'user' | 'system' | 'agent'` or any other string), `EventListener`.

## Notable behaviour

- `subjectId` is the top-level scope a host owns (project id, matter id, user id); `chatId` is an optional finer scope used for SSE fan-out and can be `null` for events that don't belong to a chat.
- Listeners that throw inside `EventBus.publish` are caught and logged (`console.error`), so one broken subscriber can't break delivery to the others.
- The `events` table has no foreign keys to a host's subject/chat tables; hosts that want cascade-on-delete call `clearForSubject` / `clearForChat` explicitly.
- `listByChat` / `listBySubject` return the most recent `limit` rows (default 1000) but in chronological (ascending) order.

## Used by

`apps/starters/starter-workspace-app` wires `EventBus` into its app context.
