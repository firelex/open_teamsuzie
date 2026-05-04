import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AddDocumentInput,
    CreateFolderInput,
    CreateWorkspaceInput,
    Folder,
    ListDocumentsOptions,
    ListWorkspacesOptions,
    UpdateDocumentInput,
    UpdateFolderInput,
    UpdateWorkspaceInput,
    Workspace,
    WorkspaceDocument,
} from './types.js';

interface WorkspaceRow {
    id: string;
    name: string;
    description: string | null;
    archived_at: number | null;
    created_at: number;
    updated_at: number;
}

interface FolderRow {
    id: string;
    workspace_id: string;
    parent_folder_id: string | null;
    name: string;
    position: number;
    created_at: number;
    updated_at: number;
}

interface DocumentRow {
    id: string;
    workspace_id: string;
    folder_id: string | null;
    external_doc_id: string;
    name: string;
    mime_type: string | null;
    size: number | null;
    position: number;
    added_at: number;
}

export interface WorkspacesStoreOptions {
    db: DatabaseInstance;
    /** Override the id generator. Default: `crypto.randomUUID`. */
    idFactory?: () => string;
    /** Override the clock. Default: `Date.now`. */
    now?: () => number;
}

/**
 * SQLite-backed CRUD for workspaces, folders, and document references.
 *
 * Operates on the schema from `WORKSPACES_MIGRATIONS`. Apps that bundle
 * those migrations into their `openDb({ migrations })` call get this store
 * for free against their own database file.
 */
export class WorkspacesStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: WorkspacesStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    // --- Workspace ---------------------------------------------------------

    createWorkspace(input: CreateWorkspaceInput): Workspace {
        const id = this.newId();
        const now = this.clock();
        prepareCached<[string, string, string | null, number, number]>(
            this.db,
            `INSERT INTO workspaces (id, name, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
        ).run(id, input.name, input.description ?? null, now, now);
        return this.getWorkspace(id)!;
    }

    getWorkspace(id: string): Workspace | null {
        const row = prepareCached<[string], WorkspaceRow>(
            this.db,
            `SELECT * FROM workspaces WHERE id = ?`,
        ).get(id);
        return row ? rowToWorkspace(row) : null;
    }

    listWorkspaces(opts: ListWorkspacesOptions = {}): Workspace[] {
        const sql = opts.includeArchived
            ? `SELECT * FROM workspaces ORDER BY created_at DESC`
            : `SELECT * FROM workspaces WHERE archived_at IS NULL ORDER BY created_at DESC`;
        return prepareCached<[], WorkspaceRow>(this.db, sql)
            .all()
            .map(rowToWorkspace);
    }

    updateWorkspace(id: string, patch: UpdateWorkspaceInput): Workspace | null {
        const existing = this.getWorkspace(id);
        if (!existing) return null;
        const now = this.clock();
        const next = {
            name: patch.name ?? existing.name,
            description:
                patch.description === undefined
                    ? existing.description
                    : patch.description,
        };
        prepareCached<[string, string | null, number, string]>(
            this.db,
            `UPDATE workspaces SET name = ?, description = ?, updated_at = ? WHERE id = ?`,
        ).run(next.name, next.description, now, id);
        return this.getWorkspace(id);
    }

    archiveWorkspace(id: string): boolean {
        const now = this.clock();
        const result = prepareCached<[number, number, string]>(
            this.db,
            `UPDATE workspaces SET archived_at = ?, updated_at = ?
             WHERE id = ? AND archived_at IS NULL`,
        ).run(now, now, id);
        return result.changes > 0;
    }

    unarchiveWorkspace(id: string): boolean {
        const now = this.clock();
        const result = prepareCached<[number, string]>(
            this.db,
            `UPDATE workspaces SET archived_at = NULL, updated_at = ?
             WHERE id = ? AND archived_at IS NOT NULL`,
        ).run(now, id);
        return result.changes > 0;
    }

    deleteWorkspace(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM workspaces WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Folder ------------------------------------------------------------

    createFolder(input: CreateFolderInput): Folder {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [string, string, string | null, string, number, number, number]
        >(
            this.db,
            `INSERT INTO folders (id, workspace_id, parent_folder_id, name, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.workspaceId,
            input.parentFolderId ?? null,
            input.name,
            input.position ?? 0,
            now,
            now,
        );
        return this.getFolder(id)!;
    }

    getFolder(id: string): Folder | null {
        const row = prepareCached<[string], FolderRow>(
            this.db,
            `SELECT * FROM folders WHERE id = ?`,
        ).get(id);
        return row ? rowToFolder(row) : null;
    }

    /**
     * Folders inside one workspace. With no `parentFolderId` arg, returns
     * every folder in the workspace (any depth). Pass `null` for the root
     * (workspace-level), or a folder id for that folder's direct children.
     */
    listFolders(workspaceId: string, parentFolderId?: string | null | undefined): Folder[] {
        if (parentFolderId === undefined) {
            return prepareCached<[string], FolderRow>(
                this.db,
                `SELECT * FROM folders WHERE workspace_id = ?
                 ORDER BY parent_folder_id, position, name`,
            )
                .all(workspaceId)
                .map(rowToFolder);
        }
        if (parentFolderId === null) {
            return prepareCached<[string], FolderRow>(
                this.db,
                `SELECT * FROM folders
                 WHERE workspace_id = ? AND parent_folder_id IS NULL
                 ORDER BY position, name`,
            )
                .all(workspaceId)
                .map(rowToFolder);
        }
        return prepareCached<[string, string], FolderRow>(
            this.db,
            `SELECT * FROM folders
             WHERE workspace_id = ? AND parent_folder_id = ?
             ORDER BY position, name`,
        )
            .all(workspaceId, parentFolderId)
            .map(rowToFolder);
    }

    updateFolder(id: string, patch: UpdateFolderInput): Folder | null {
        const existing = this.getFolder(id);
        if (!existing) return null;
        const now = this.clock();
        const next = {
            name: patch.name ?? existing.name,
            parentFolderId:
                patch.parentFolderId === undefined
                    ? existing.parentFolderId
                    : patch.parentFolderId,
            position: patch.position ?? existing.position,
        };
        prepareCached<[string, string | null, number, number, string]>(
            this.db,
            `UPDATE folders
             SET name = ?, parent_folder_id = ?, position = ?, updated_at = ?
             WHERE id = ?`,
        ).run(next.name, next.parentFolderId, next.position, now, id);
        return this.getFolder(id);
    }

    deleteFolder(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM folders WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Document ----------------------------------------------------------

    addDocument(input: AddDocumentInput): WorkspaceDocument {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [
                string,
                string,
                string | null,
                string,
                string,
                string | null,
                number | null,
                number,
                number,
            ]
        >(
            this.db,
            `INSERT INTO workspace_documents
             (id, workspace_id, folder_id, external_doc_id, name, mime_type, size, position, added_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.workspaceId,
            input.folderId ?? null,
            input.externalDocId,
            input.name,
            input.mimeType ?? null,
            input.size ?? null,
            input.position ?? 0,
            now,
        );
        return this.getDocument(id)!;
    }

    getDocument(id: string): WorkspaceDocument | null {
        const row = prepareCached<[string], DocumentRow>(
            this.db,
            `SELECT * FROM workspace_documents WHERE id = ?`,
        ).get(id);
        return row ? rowToDocument(row) : null;
    }

    listDocuments(
        workspaceId: string,
        opts: ListDocumentsOptions = {},
    ): WorkspaceDocument[] {
        const folderId = opts.folderId;
        if (folderId === undefined) {
            return prepareCached<[string], DocumentRow>(
                this.db,
                `SELECT * FROM workspace_documents WHERE workspace_id = ?
                 ORDER BY folder_id, position, name`,
            )
                .all(workspaceId)
                .map(rowToDocument);
        }
        if (folderId === null) {
            return prepareCached<[string], DocumentRow>(
                this.db,
                `SELECT * FROM workspace_documents
                 WHERE workspace_id = ? AND folder_id IS NULL
                 ORDER BY position, name`,
            )
                .all(workspaceId)
                .map(rowToDocument);
        }
        return prepareCached<[string, string], DocumentRow>(
            this.db,
            `SELECT * FROM workspace_documents
             WHERE workspace_id = ? AND folder_id = ?
             ORDER BY position, name`,
        )
            .all(workspaceId, folderId)
            .map(rowToDocument);
    }

    updateDocument(id: string, patch: UpdateDocumentInput): WorkspaceDocument | null {
        const existing = this.getDocument(id);
        if (!existing) return null;
        const next = {
            folderId:
                patch.folderId === undefined ? existing.folderId : patch.folderId,
            name: patch.name ?? existing.name,
            position: patch.position ?? existing.position,
        };
        prepareCached<[string | null, string, number, string]>(
            this.db,
            `UPDATE workspace_documents
             SET folder_id = ?, name = ?, position = ?
             WHERE id = ?`,
        ).run(next.folderId, next.name, next.position, id);
        return this.getDocument(id);
    }

    removeDocument(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM workspace_documents WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        archivedAt: row.archived_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToFolder(row: FolderRow): Folder {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        parentFolderId: row.parent_folder_id,
        name: row.name,
        position: row.position,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToDocument(row: DocumentRow): WorkspaceDocument {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        folderId: row.folder_id,
        externalDocId: row.external_doc_id,
        name: row.name,
        mimeType: row.mime_type,
        size: row.size,
        position: row.position,
        addedAt: row.added_at,
    };
}
