# @teamsuzie/files

Office-document and image-attachment storage presets over `@teamsuzie/artifacts`, plus an auth-agnostic Express router for upload/download/delete.

Use it when an app needs to accept file uploads (office docs or images) over HTTP without writing its own multer wiring, mime allowlist, or size-limit handling.

```ts
import express from 'express';
import { createOfficeDocStore, createFileRouter } from '@teamsuzie/files';

const store = createOfficeDocStore({ root: './data/office-docs' });

const app = express();
app.use(
  '/api/files',
  createFileRouter({
    store,
    authMiddleware: requireAuth, // your own middleware; applied before every route
  }),
);
```

This mounts:

- `POST /api/files` — multipart upload (`file` field) → `{ id, filename, mimeType, ... }`
- `GET /api/files/:id/meta` — metadata for a stored file
- `GET /api/files/:id` — download (sets `Content-Type` / `Content-Disposition`)
- `DELETE /api/files/:id` — delete

## Main exports

- `createOfficeDocStore(options)` — an `AttachmentStore` scoped to `OFFICE_DOC_MIME_TYPES` (`.docx`, `.pptx`, `.xlsx`, `.pdf`), 50 MiB max by default. `options: { root, maxBytes? }`.
- `createImageAttachmentStore(options)` — an `AttachmentStore` scoped to `IMAGE_ATTACHMENT_MIME_TYPES` (`png`, `jpeg`, `gif`, `webp`), 15 MiB max by default. `options: { root, maxBytes? }`.
- `createFileRouter(options)` — builds the Express router above. `options`:
  - `store` **or** `resolveStore` (per-request resolver) — exactly one is required.
  - `authMiddleware?` — applied before every route.
  - `maxUploadBytes?` — default 50 MiB.
  - `urlForMeta?` — build the `url` field added to the upload/meta response.
- `OFFICE_DOC_MIME_TYPES`, `IMAGE_ATTACHMENT_MIME_TYPES` — the allowed mime lists, as readonly tuples.

## Notable behaviour

- Uploading an unsupported mime type returns `415`; exceeding the size limit returns `413` (both from the route handler's error message matching, and from a dedicated multer `LIMIT_FILE_SIZE` catch for errors multer raises before the handler runs).
- `store` and `resolveStore` are mutually exclusive; passing both or neither throws at router-construction time.
- The router does no authentication itself — pass `authMiddleware` (or gate access in a custom `resolveStore`) to restrict who can read/write.
