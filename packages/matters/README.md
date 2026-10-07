# @teamsuzie/matters

Composition layer that turns the generic `@teamsuzie/workspaces` (doc-container) and `@teamsuzie/sharing` (membership) stores into a "matter" workspace — the user-facing label for a multi-document case/deal/engagement. It defines no new tables of its own (metadata is the one exception); use it when a build mounts `modules.matters` behind an agent-runtime server.

```ts
import express from 'express';
import { openDb } from '@teamsuzie/db-sqlite';
import { WorkspacesStore, WORKSPACES_MIGRATIONS } from '@teamsuzie/workspaces';
import { MembersStore, SHARING_MIGRATIONS } from '@teamsuzie/sharing';
import {
  SUBJECT_MATTER,
  createRequireMatterAccess,
  createMatterUploadsRouter,
  createMatterMembersRouter,
  backfillMatterOwnership,
  type MatterFileStore,
  type MatterFileRecord,
} from '@teamsuzie/matters';

const db = openDb({
  path: './data/app.db',
  migrations: [...WORKSPACES_MIGRATIONS, ...SHARING_MIGRATIONS],
});
const workspaces = new WorkspacesStore({ db });
const members = new MembersStore({ db });

// Minimal MatterFileStore — the agent-runtime's InMemoryFileStore already
// satisfies this interface structurally.
const files = new Map<string, MatterFileRecord>();
const fileStore: MatterFileStore = {
  put: (record) => void files.set(`${record.sessionId}:${record.id}`, record),
  get: (sessionId, fileId) => files.get(`${sessionId}:${fileId}`),
};

const getSessionUser = (req: express.Request) =>
  (req as unknown as { session?: { user?: { email: string } } }).session?.user;

const app = express();
app.use(
  '/api/matters/:matterId',
  createRequireMatterAccess({ members, workspaces, getSessionUser }),
);
app.use(
  '/api/matters',
  createMatterUploadsRouter({ fileStore, workspaces, maxUploadBytes: 20 * 1024 * 1024 }),
);
app.use(
  '/api/matters/:matterId/members',
  createMatterMembersRouter({ members, workspaces, getSessionUser }),
);

// One-off: give every un-owned matter (created before access-gating shipped)
// an owner so it stays reachable.
backfillMatterOwnership({ members, workspaces, ownerEmail: 'demo@example.com' });
```

## Main exports

- `SUBJECT_MATTER` — the `SubjectRef.type` string (`'matter'`) used against `@teamsuzie/sharing`'s `MembersStore`.
- `createRequireMatterAccess` / `backfillMatterOwnership` — membership-gating middleware and the one-off ownership backfill.
- `createMatterUploadsRouter` — multipart upload → matter file bucket → `workspaces.addDocument` → optional `documentVersions.addVersion('upload')`.
- `createMatterMembersRouter` — owner-only member CRUD, with a last-owner-removal guard.
- `createMatterMetadataRouter` / `MatterMetadataStore` / `MATTERS_METADATA_MIGRATIONS` — sidecar `matter_metadata` table for a matter's type + custom-field values (schema-on-read; the manifest-driven field validation is the host's job).
- `createReviewsExportRouter` / `buildReviewWorkbook` — streams a matter-scoped `@teamsuzie/grid-review` review as an `.xlsx` workbook, citations rendered as cell comments.
- `createReviewsFromWorkflowRouter` — pre-populates a grid review's columns/rows from a `@teamsuzie/workflows` column config.

## Notable behaviour

- Uploads are restricted to `.csv .docx .epub .htm .html .json .md .markdown .pdf .pptx .txt .xlsx`; anything else is rejected with 415.
- `createRequireMatterAccess` returns 400 (missing `:matterId`), 401 (no session user), 404 (matter not found), or 403 (no role), and stashes the resolved role at `req._matterRole` on success.
- `backfillMatterOwnership` is a demo/single-user bridge — multi-user production deployments should fail-closed instead of calling it.
- The members router blocks removing the last owner so a matter can never be orphaned.
- The reviews-export and reviews-from-workflow routers expect the parent `requireMatterAccess`/sub-router mount to have already stashed `_matterId` on the request (same pattern as the chats/grid-review mounts); they fall back to `req.params.matterId` for direct test mounts.

Used by `@teamsuzie/agent-runtime` to mount the matters feature.
