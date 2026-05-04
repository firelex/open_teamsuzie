import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Schema for workspace / folder / workspace-document. Apps add these to
 * their `openDb({ migrations })` call alongside their other migrations.
 *
 * Cascade behavior:
 *   - workspace → folders, workspace_documents: ON DELETE CASCADE
 *     (deleting a workspace removes its tree + doc references).
 *   - folder → subfolders: ON DELETE CASCADE (recursive folder tree).
 *   - folder → workspace_documents: ON DELETE SET NULL (folder delete
 *     moves docs to the workspace root rather than orphaning them; host
 *     UI can prompt before delete if it wants different behavior).
 *
 * Document content is *not* stored here — `workspace_documents.external_doc_id`
 * is an opaque reference into whatever document store the host app uses
 * (file store, S3 key, MarkdownDocument id, ...). Light metadata is mirrored
 * (`name`, `mime_type`, `size`) so listing is cheap and doesn't require N
 * lookups into the external store.
 */
export const WORKSPACES_MIGRATIONS: Migration[] = [
    {
        name: '20260501_create_workspaces',
        up: `
            CREATE TABLE IF NOT EXISTS workspaces (
                id            TEXT PRIMARY KEY,
                name          TEXT NOT NULL,
                description   TEXT,
                archived_at   INTEGER,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS folders (
                id                TEXT PRIMARY KEY,
                workspace_id      TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                parent_folder_id  TEXT REFERENCES folders(id) ON DELETE CASCADE,
                name              TEXT NOT NULL,
                position          INTEGER NOT NULL DEFAULT 0,
                created_at        INTEGER NOT NULL,
                updated_at        INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS workspace_documents (
                id              TEXT PRIMARY KEY,
                workspace_id    TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                folder_id       TEXT REFERENCES folders(id) ON DELETE SET NULL,
                external_doc_id TEXT NOT NULL,
                name            TEXT NOT NULL,
                mime_type       TEXT,
                size            INTEGER,
                position        INTEGER NOT NULL DEFAULT 0,
                added_at        INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_folders_workspace
                ON folders(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_folders_parent
                ON folders(parent_folder_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_documents_workspace
                ON workspace_documents(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_workspace_documents_folder
                ON workspace_documents(folder_id);
        `,
    },
];
