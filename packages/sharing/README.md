# @teamsuzie/sharing

SQLite schema + store for cross-subject membership and role-based access. Subjects are opaque `(subject_type, subject_id)` pairs — matters, reviews, workflows, anything — so the store has no FK or schema dependency on the host's own tables.

Use it when an app needs to grant users roles (`owner` / `editor` / `viewer`) on some subject and check access, without coupling that access model to the subject's own package.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { SHARING_MIGRATIONS, MembersStore } from '@teamsuzie/sharing';

const db = openDb({ path: './data/app.db', migrations: SHARING_MIGRATIONS });
const members = new MembersStore({ db });

const subject = { type: 'matter', id: 'matter-1' };

members.addMember({
  subjectType: subject.type,
  subjectId: subject.id,
  userId: 'alice@example.com',
  role: 'owner',
  grantedBy: 'alice@example.com',
});

const role = members.getRole(subject, 'alice@example.com'); // 'owner'

// Combine explicit grants with an implicit "owner from creation" lookup:
const effectiveRole = await members.canAccess(subject, 'bob@example.com', async (s) => {
  return lookUpMatterCreator(s.id); // host-provided callback, or null
});
```

## Main exports

- `MembersStore` — `addMember(input)` (upsert, keyed by `subjectType + subjectId + userId`), `getMember(id)`, `removeMember(subjectType, subjectId, userId)`, `removeMembersFor(subject)`, `listMembersFor(subject)`, `listSubjectsFor(userId, subjectType)`, `getRole(subject, userId)`, `canAccess(subject, userId, ownerLookup?)`.
- `SHARING_MIGRATIONS` — the `Migration[]` that creates the `members` table; pass to `openDb({ migrations })`.
- `ROLES` — `['owner', 'editor', 'viewer']`.
- `ROLE_RANK` — `{ owner: 3, editor: 2, viewer: 1 }`, used to resolve precedence when a user has more than one grant path to a subject.
- Types: `Role`, `SubjectRef` (`{ type, id }`), `Member`, `AddMemberInput`, `OwnerLookup` (`(subject) => string | null | Promise<string | null>`).

## Notable behaviour

- `addMember` validates `role` against `ROLES` and throws on an invalid value.
- `canAccess` checks explicit member rows first (an explicit `'owner'` short-circuits), then consults `ownerLookup` (if passed) for implicit ownership, and returns the stronger of the two by `ROLE_RANK`. Pass `null`/`undefined` to skip implicit-owner resolution entirely.
- `listSubjectsFor` only returns subjects with an explicit member row — it does not union in implicit ownership from `ownerLookup`.
- `removeMembersFor(subject)` is the cascade hook hosts call when deleting the underlying subject, since there's no cross-package foreign key to do it automatically.

## Used by

`@teamsuzie/matters` (access middleware, members router) and `@teamsuzie/agent-runtime` (matter membership).
