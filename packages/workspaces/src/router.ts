import { Router } from 'express';

import type { WorkspacesStore } from './store.js';
import type { Workspace, WorkspaceDocument } from './types.js';

export interface CreateWorkspacesRouterOptions {
    store: WorkspacesStore;
    /**
     * Optional fire-and-forget callback invoked after a `workspace_documents`
     * row is successfully removed (via `DELETE /:id/documents/:docId`). Hosts
     * use this to drop side-effects keyed off the doc — for suzielaw, the
     * RAG index for the matter doc.
     */
    onDocumentRemoved?: (
        workspace: Workspace,
        doc: WorkspaceDocument,
    ) => void | Promise<void>;
    /**
     * Optional fire-and-forget callback invoked after a workspace is
     * deleted. Useful for cleaning up matter-scoped state outside this
     * package (e.g. all KB indexes for the matter).
     */
    onWorkspaceRemoved?: (workspaceId: string) => void | Promise<void>;
}

/**
 * REST endpoints for workspace CRUD. Folder + document endpoints come in
 * a follow-up — this router covers just workspace-level operations needed
 * for "list / create / rename / archive" UIs.
 *
 * Mount under any prefix:
 *   app.use('/api/matters', requireAuth, createWorkspacesRouter({ store }))
 *
 *   GET    /                — list (?archived=true to include archived)
 *   POST   /                — create { name, description? }
 *   GET    /:id             — fetch one
 *   PATCH  /:id             — update { name?, description? }
 *   POST   /:id/archive     — archive
 *   POST   /:id/unarchive   — unarchive
 *   DELETE /:id             — delete (cascades to folders + documents)
 */
export function createWorkspacesRouter(opts: CreateWorkspacesRouterOptions): Router {
    const { store, onDocumentRemoved, onWorkspaceRemoved } = opts;
    const router: Router = Router();

    router.get('/', (req, res) => {
        const includeArchived = req.query.archived === 'true';
        res.json({ items: store.listWorkspaces({ includeArchived }) });
    });

    router.post('/', (req, res) => {
        const body = req.body as Record<string, unknown> | undefined;
        const name = String(body?.name || '').trim();
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const descriptionInput = body?.description;
        const description =
            typeof descriptionInput === 'string' ? descriptionInput.trim() : null;
        const created = store.createWorkspace({
            name,
            description: description && description.length > 0 ? description : null,
        });
        res.status(201).json({ item: created });
    });

    router.get('/:id', (req, res) => {
        const item = store.getWorkspace(req.params.id);
        if (!item) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ item });
    });

    router.patch('/:id', (req, res) => {
        const body = req.body as Record<string, unknown> | undefined;
        const patch: { name?: string; description?: string | null } = {};
        if (typeof body?.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            patch.name = trimmed;
        }
        if ('description' in (body ?? {})) {
            const d = body!.description;
            if (d === null) {
                patch.description = null;
            } else if (typeof d === 'string') {
                const trimmed = d.trim();
                patch.description = trimmed.length > 0 ? trimmed : null;
            } else {
                res.status(400).json({ error: 'description must be a string or null' });
                return;
            }
        }
        const updated = store.updateWorkspace(req.params.id, patch);
        if (!updated) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ item: updated });
    });

    router.post('/:id/archive', (req, res) => {
        if (!store.getWorkspace(req.params.id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.archiveWorkspace(req.params.id);
        res.json({ item: store.getWorkspace(req.params.id) });
    });

    router.post('/:id/unarchive', (req, res) => {
        if (!store.getWorkspace(req.params.id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.unarchiveWorkspace(req.params.id);
        res.json({ item: store.getWorkspace(req.params.id) });
    });

    router.delete('/:id', async (req, res) => {
        const id = String(req.params.id ?? '');
        const ok = store.deleteWorkspace(id);
        if (!ok) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        if (onWorkspaceRemoved) {
            try {
                await onWorkspaceRemoved(id);
            } catch (err) {
                console.warn('onWorkspaceRemoved failed:', err);
            }
        }
        res.json({ ok: true });
    });

    // --- Folders ----------------------------------------------------------

    router.get('/:id/folders', (req, res) => {
        if (!store.getWorkspace(req.params.id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        // ?parent=null lists the root; ?parent=<id> lists children of that folder;
        // omit ?parent for the full flat list (any depth).
        const parentRaw = req.query.parent;
        let parent: string | null | undefined;
        if (parentRaw === undefined) {
            parent = undefined;
        } else if (parentRaw === 'null' || parentRaw === '') {
            parent = null;
        } else if (typeof parentRaw === 'string') {
            parent = parentRaw;
        } else {
            res.status(400).json({ error: 'parent must be a string' });
            return;
        }
        res.json({ items: store.listFolders(req.params.id, parent) });
    });

    router.post('/:id/folders', (req, res) => {
        if (!store.getWorkspace(req.params.id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const name = String(body?.name || '').trim();
        if (!name) {
            res.status(400).json({ error: 'name is required' });
            return;
        }
        const parentRaw = body?.parentFolderId;
        let parentFolderId: string | null = null;
        if (typeof parentRaw === 'string' && parentRaw.length > 0) {
            const parent = store.getFolder(parentRaw);
            if (!parent || parent.workspaceId !== req.params.id) {
                res.status(400).json({ error: 'parentFolderId does not belong to this workspace' });
                return;
            }
            parentFolderId = parentRaw;
        }
        const created = store.createFolder({
            workspaceId: req.params.id,
            parentFolderId,
            name,
        });
        res.status(201).json({ item: created });
    });

    // --- Documents --------------------------------------------------------

    router.get('/:id/documents', (req, res) => {
        if (!store.getWorkspace(req.params.id)) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const folderRaw = req.query.folder;
        let folderId: string | null | undefined;
        if (folderRaw === undefined) {
            folderId = undefined;
        } else if (folderRaw === 'null' || folderRaw === '') {
            folderId = null;
        } else if (typeof folderRaw === 'string') {
            folderId = folderRaw;
        } else {
            res.status(400).json({ error: 'folder must be a string' });
            return;
        }
        res.json({ items: store.listDocuments(req.params.id, { folderId }) });
    });

    router.patch('/:id/folders/:folderId', (req, res) => {
        const folder = store.getFolder(req.params.folderId);
        if (!folder || folder.workspaceId !== req.params.id) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const patch: { name?: string; parentFolderId?: string | null; position?: number } = {};

        if (typeof body?.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            patch.name = trimmed;
        }

        if ('parentFolderId' in (body ?? {})) {
            const p = body!.parentFolderId;
            let parentFolderId: string | null;
            if (p === null) {
                parentFolderId = null;
            } else if (typeof p === 'string') {
                if (p.length === 0) {
                    parentFolderId = null;
                } else {
                    const parent = store.getFolder(p);
                    if (!parent || parent.workspaceId !== req.params.id) {
                        res.status(400).json({
                            error: 'parentFolderId does not belong to this workspace',
                        });
                        return;
                    }
                    parentFolderId = p;
                }
            } else {
                res.status(400).json({ error: 'parentFolderId must be a string or null' });
                return;
            }
            if (wouldCreateCycle(store, req.params.folderId, parentFolderId)) {
                res.status(400).json({ error: 'parentFolderId would create a cycle' });
                return;
            }
            patch.parentFolderId = parentFolderId;
        }

        if (typeof body?.position === 'number' && Number.isInteger(body.position)) {
            patch.position = body.position;
        }

        const updated = store.updateFolder(req.params.folderId, patch);
        if (!updated) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ item: updated });
    });

    router.delete('/:id/folders/:folderId', (req, res) => {
        const folder = store.getFolder(req.params.folderId);
        if (!folder || folder.workspaceId !== req.params.id) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.deleteFolder(req.params.folderId);
        res.json({ ok: true });
    });

    router.patch('/:id/documents/:docId', (req, res) => {
        const doc = store.getDocument(req.params.docId);
        if (!doc || doc.workspaceId !== req.params.id) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        const patch: { folderId?: string | null; name?: string; position?: number } = {};

        if ('folderId' in (body ?? {})) {
            const f = body!.folderId;
            if (f === null) {
                patch.folderId = null;
            } else if (typeof f === 'string') {
                if (f.length === 0) {
                    patch.folderId = null;
                } else {
                    const folder = store.getFolder(f);
                    if (!folder || folder.workspaceId !== req.params.id) {
                        res.status(400).json({
                            error: 'folderId does not belong to this workspace',
                        });
                        return;
                    }
                    patch.folderId = f;
                }
            } else {
                res.status(400).json({ error: 'folderId must be a string or null' });
                return;
            }
        }

        if (typeof body?.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                res.status(400).json({ error: 'name cannot be empty' });
                return;
            }
            patch.name = trimmed;
        }

        if (typeof body?.position === 'number' && Number.isInteger(body.position)) {
            patch.position = body.position;
        }

        const updated = store.updateDocument(req.params.docId, patch);
        if (!updated) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        res.json({ item: updated });
    });

    router.delete('/:id/documents/:docId', async (req, res) => {
        const doc = store.getDocument(req.params.docId);
        if (!doc || doc.workspaceId !== req.params.id) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        store.removeDocument(req.params.docId);
        if (onDocumentRemoved) {
            const workspace = store.getWorkspace(doc.workspaceId);
            if (workspace) {
                try {
                    await onDocumentRemoved(workspace, doc);
                } catch (err) {
                    console.warn('onDocumentRemoved failed:', err);
                }
            }
        }
        res.json({ ok: true });
    });

    return router;
}

function wouldCreateCycle(
    store: WorkspacesStore,
    folderId: string,
    newParentId: string | null,
): boolean {
    if (newParentId === null) return false;
    if (newParentId === folderId) return true;
    let cursor: string | null = newParentId;
    const seen = new Set<string>();
    while (cursor !== null && !seen.has(cursor)) {
        if (cursor === folderId) return true;
        seen.add(cursor);
        const node = store.getFolder(cursor);
        cursor = node?.parentFolderId ?? null;
    }
    return false;
}
