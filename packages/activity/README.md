# @teamsuzie/activity

Append-only durable activity timeline. Org-scoped entries against
opaque `(subject_type, subject_id)` refs with actor metadata, an
event `kind`, summary/body text, and arbitrary JSON metadata.

Coexists with the file-backed `ActivityLog` in `@teamsuzie/artifacts`;
neither replaces the other.

## Exports

- `ACTIVITY_MIGRATIONS` — pass to `openDb({ migrations })`.
- `ActivityStore` — `new ActivityStore({ db, idFactory?, now? })`.

## Org scoping

Every entry stores `org_id`; every read takes `orgId` as the first
filter. The store does not enforce that the actor belongs to the org —
hosts validate at their boundary before calling `append`.

## Usage

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { ACTIVITY_MIGRATIONS, ActivityStore } from '@teamsuzie/activity';

const db = openDb({ path: 'app.db', migrations: ACTIVITY_MIGRATIONS });
const activity = new ActivityStore({ db });

activity.append({
  orgId: 'org-1',
  subject: { type: 'record', id: 'r-1' },
  kind: 'comment.added',
  summary: 'Alice left a comment',
  body: 'Looks good to me',
  actor: { id: 'alice@x', type: 'user' },
  metadata: { mentions: ['bob@x'] },
});

activity.listBySubject({ orgId: 'org-1', subject: { type: 'record', id: 'r-1' } });
```
