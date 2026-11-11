# @teamsuzie/document-versions

SQLite-backed store for immutable document version chains. Each version points at its parent and carries a `source` tag (`upload`, `proposal`, `accept`, `reject`, `generated`); a per-document head pointer makes "restore an old version" a single `setHead` call without rewriting history. Use it whenever an app needs to track how a document evolved (uploads, LLM-proposed redlines, accept/reject resolutions) and let users roll back.

```ts
import { openDb } from '@teamsuzie/db-sqlite';
import { DocumentVersionsStore, DOCUMENT_VERSIONS_MIGRATIONS } from '@teamsuzie/document-versions';

const db = openDb({ path: './data/app.db', migrations: DOCUMENT_VERSIONS_MIGRATIONS });
const versions = new DocumentVersionsStore({ db });

const v1 = versions.addVersion({
  externalDocId: 'doc-123',
  source: 'upload',
  storageId: 'file-abc',
  byteSize: 20480,
  notes: 'Original upload',
});

const v2 = versions.addVersion({
  externalDocId: 'doc-123',
  parentId: v1.id,
  source: 'proposal',
  storageId: 'file-def',
});

versions.getHead('doc-123'); // v2 — adding a version always re-points the head

versions.setHead('doc-123', v1.id); // restore v1 without deleting v2's chain

versions.listVersions('doc-123'); // oldest first
versions.walkAncestors(v2.id); // [v2, v1]
versions.walkDescendants(v1.id); // [v2]
```

## Main exports

- `DocumentVersionsStore` — `addVersion`, `getVersion`, `listVersions`, `getHead`, `setHead`, `walkAncestors`, `walkDescendants`, `deleteAllForDocument`.
- `DOCUMENT_VERSIONS_MIGRATIONS` — the `Migration[]` (for `@teamsuzie/db-sqlite`'s `openDb`) that creates `document_versions` and `document_heads`.
- `VERSION_SOURCES` — the array of valid `VersionSource` values, used for runtime validation.
- Types: `DocumentVersion`, `AddVersionInput`, `VersionSource`, `DocumentVersionsStoreOptions`.

## Notable behaviour

- `externalDocId` and `storageId` are opaque pointers the host assigns and interprets — this package does no foreign-key join into another package's tables.
- `addVersion` always re-points the document's head at the new version; use `setHead` to move the head without adding a version (the "restore" case — the chain itself is preserved).
- `addVersion` throws if `source` isn't one of `VERSION_SOURCES`, or if `parentId` doesn't exist or belongs to a different `externalDocId`.
- `deleteAllForDocument` removes every version and the head pointer for one document in a single transaction, deleting children before parents to satisfy the `parent_id` foreign key.
- `walkAncestors` is cycle-safe (stops if a `parent_id` chain revisits an id), which can only happen from data inserted outside the store's own checks.

## Used by

`@teamsuzie/agent-runtime` (server routes, redline round-trip) and `@teamsuzie/matters` (uploads router).
