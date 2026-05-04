export interface Workspace {
    id: string;
    name: string;
    description: string | null;
    /** Epoch ms; null = active. */
    archivedAt: number | null;
    createdAt: number;
    updatedAt: number;
}

export interface Folder {
    id: string;
    workspaceId: string;
    /** Null = root-level folder under the workspace. */
    parentFolderId: string | null;
    name: string;
    position: number;
    createdAt: number;
    updatedAt: number;
}

export interface WorkspaceDocument {
    id: string;
    workspaceId: string;
    /** Null = sits at the workspace root, not in any folder. */
    folderId: string | null;
    /** Opaque pointer into the host's document store. */
    externalDocId: string;
    name: string;
    mimeType: string | null;
    size: number | null;
    position: number;
    addedAt: number;
}

export interface CreateWorkspaceInput {
    name: string;
    description?: string | null;
}

export interface UpdateWorkspaceInput {
    name?: string;
    description?: string | null;
}

export interface CreateFolderInput {
    workspaceId: string;
    parentFolderId?: string | null;
    name: string;
    position?: number;
}

export interface UpdateFolderInput {
    name?: string;
    parentFolderId?: string | null;
    position?: number;
}

export interface AddDocumentInput {
    workspaceId: string;
    folderId?: string | null;
    externalDocId: string;
    name: string;
    mimeType?: string | null;
    size?: number | null;
    position?: number;
}

export interface UpdateDocumentInput {
    folderId?: string | null;
    name?: string;
    position?: number;
}

export interface ListWorkspacesOptions {
    /** Default false. When true, archived workspaces are included. */
    includeArchived?: boolean;
}

export interface ListDocumentsOptions {
    /**
     * Filter by folder. Pass `null` to list root-level docs only; pass a
     * folder id to list that folder's docs only; omit to list every doc in
     * the workspace regardless of folder.
     */
    folderId?: string | null | undefined;
}
