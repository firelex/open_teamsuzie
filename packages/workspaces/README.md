# @teamsuzie/workspaces

SQLite schema and CRUD for a generic document container: workspace → folder → workspace-document. A "workspace" is the neutral primitive a build re-labels for its domain (legal apps call it a "matter", M&A apps a "deal", etc. — see `@teamsuzie/matters` for that wiring). Use it whenever an app needs a container that groups documents into folders without caring what those documents mean.

```ts
import express from 'express';
import { openDb } from '@teamsuzie/db-sqlite';
import {
  WorkspacesStore,
  WORKSPACES_MIGRATIONS,
  createWorkspacesRouter,
} from '@teamsuzie/workspaces';

const db = openDb({ path: './data/app.db', migrations: WORKSPACES_MIGRATIONS });
const store = new WorkspacesStore({ db });

const workspace = store.createWorkspace({ name: 'Acme Corp', description: 'Due diligence' });
const folder = store.createFolder({ workspaceId: workspace.id, name: 'Contracts' });
store.addDocument({
  workspaceId: workspace.id,
  folderId: folder.id,
  externalDocId: 'file_abc123',
  name: 'MSA.pdf',
  mimeType: 'application/pdf',
  size: 48213,
});

const app = express();
app.use(
  '/api/matters',
  requireAuth,
  createWorkspacesRouter({
    store,
    onWorkspaceRemoved: async (id) => console.log('cleanup for', id),
  }),
);
```

## Main exports

- `WorkspacesStore` — workspace CRUD (`createWorkspace`, `getWorkspace`, `listWorkspaces`, `updateWorkspace`, `archiveWorkspace`, `unarchiveWorkspace`, `deleteWorkspace`), folder CRUD (`createFolder`, `getFolder`, `listFolders`, `updateFolder`, `deleteFolder`), and document CRUD (`addDocument`, `getDocument`, `listDocuments`, `updateDocument`, `deleteDocument`).
- `createWorkspacesRouter` — REST endpoints for workspace-level operations: `GET /` (`?archived=true` includes archived), `POST /`, `GET /:id`, `PATCH /:id`, `POST /:id/archive`, `POST /:id/unarchive`, `DELETE /:id` (cascades to its folders and documents). Folder/document endpoints are not part of this router.
- `WORKSPACES_MIGRATIONS` — the `workspaces`, `folders`, and `workspace_documents` table migrations.
- Types: `Workspace`, `Folder`, `WorkspaceDocument`, and the `Create*Input`/`Update*Input`/`List*Options` shapes for each.

## Notable behaviour

- A document's `externalDocId` is an opaque pointer into the host's own document/file store — this package never looks inside it.
- `archiveWorkspace`/`unarchiveWorkspace` are no-ops (return `false`) if the workspace is already in the target state.
- `createWorkspacesRouter`'s `onDocumentRemoved` and `onWorkspaceRemoved` are fire-and-forget hooks for side-effect cleanup (e.g. dropping a RAG index) outside this package's own tables.
- `WorkspacesStoreOptions` accepts an `idFactory`/`now` override (defaults: `crypto.randomUUID`/`Date.now`) for deterministic tests.

Used by `@teamsuzie/matters` (which layers matter-specific access control and routers on top) and wired into `@teamsuzie/agent-runtime`.
