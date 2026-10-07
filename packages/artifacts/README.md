# @teamsuzie/artifacts

Filesystem primitives for host apps that store markdown "artifacts" with frontmatter metadata, scoped file uploads, attachments, and a per-subject JSON activity log. The package handles serialization and path safety; each host supplies its own metadata shape and directory layout. Use it when an app needs to persist generated documents, user uploads, or an audit trail to local disk without re-writing the same path-sanitization and file I/O each time.

```ts
import {
  MarkdownArtifactStore,
  ScopedUploadStore,
  AttachmentStore,
  ActivityLog,
  sanitizeIdSegment,
} from '@teamsuzie/artifacts';

interface Meta {
  title: string;
  status: 'draft' | 'final';
}

const store = new MarkdownArtifactStore<Meta>({
  dir: './data/memos',
  parseMeta: (data) => ({
    title: String(data.title ?? 'Untitled'),
    status: data.status === 'final' ? 'final' : 'draft',
  }),
  serializeMeta: (meta) => ({ title: meta.title, status: meta.status }),
});

store.write('memo-1', { title: 'Q3 memo', status: 'draft' }, '# Q3 memo\n\nBody text...');
const memo = store.read('memo-1'); // { id, meta, body, updatedAt }

const uploads = new ScopedUploadStore('./data/memo-1/uploads');
uploads.save('spec.pdf', fileBytes);

const attachments = new AttachmentStore({
  root: './data/attachments',
  allowedMime: new Set(['image/png', 'image/jpeg']),
});
const saved = attachments.save({ originalName: 'logo.png', mimeType: 'image/png', bytes: fileBytes });

const activity = new ActivityLog<{ id: string; body: string }>({ dir: './data/memo-1/activity' });
activity.append('memo-1', { id: sanitizeIdSegment('evt-1'), body: 'Created' });
```

## Main exports

- `MarkdownArtifactStore<TMeta>` — CRUD over a directory of `<id>.md` files with YAML-ish frontmatter (`list`, `read`, `write`, `update`, `delete`, `exists`). `reservedFilenames` / `skipDirectoryNames` hide non-artifact files from `list()`.
- `ScopedUploadStore` — saves/reads/deletes files under one root directory, rejecting paths that escape it; cleans up empty parent directories on delete.
- `AttachmentStore` — saves attachments as `<root>/<uuid>/<filename>` plus a sibling `meta.json`, enforcing a MIME allowlist and a size limit (`maxBytes`, default 15 MiB).
- `ActivityLog<TEntry>` — append-only JSON log, one file per subject id (`list`, `append`, `replaceAll`, `delete`); tolerates missing or malformed files by returning `[]`.
- `parseFrontmatter(src)` / `serializeFrontmatter(data, body)` — the `---`-delimited frontmatter codec `MarkdownArtifactStore` uses internally.
- `sanitizeSubpath(rel)`, `sanitizeIdSegment(id)`, `isSafeFilename(name)` — path-safety helpers; the first two throw on an unsafe path/id, the third returns a boolean.

## Notable behaviour

- All stores throw on invalid input (unsupported MIME type, oversized attachment, path escaping the root) rather than silently dropping it.
- `AttachmentStore` sanitizes the original filename to `[A-Za-z0-9._-]` and falls back to `attachment.<ext>` (extension from `extensionByMime`, else `bin`) if nothing usable remains.
- `MarkdownArtifactStore.update()` returns `null` for a missing id instead of throwing, since it's a read-modify-write helper.

## Used by

`@teamsuzie/files` (`officeDocStore`, `imageAttachmentStore`, its router) and the activity timeline component in `@teamsuzie/ui`.
