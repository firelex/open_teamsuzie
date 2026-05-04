import type { Migration } from '@teamsuzie/db-sqlite';

/**
 * Persisted chats and their messages. The `workspace_id` on `chats` is
 * opaque (no cross-package FK) — matching the loose-coupling pattern used
 * by `@teamsuzie/grid-review` and `@teamsuzie/workspaces`. Hosts that want
 * a workspace cascade should delete chats explicitly when a workspace
 * goes away.
 *
 * Within a chat, deleting the chat cascades to its messages.
 */
export const CHATS_MIGRATIONS: Migration[] = [
    {
        name: '20260501_create_chats',
        up: `
            CREATE TABLE IF NOT EXISTS chats (
                id            TEXT PRIMARY KEY,
                workspace_id  TEXT NOT NULL,
                name          TEXT NOT NULL,
                created_at    INTEGER NOT NULL,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id           TEXT PRIMARY KEY,
                chat_id      TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role         TEXT NOT NULL,
                content      TEXT NOT NULL,
                /* JSON array of ToolEvent records; null when no tools were used. */
                tool_events  TEXT,
                /* JSON array of Citation records; null when none. */
                citations    TEXT,
                created_at   INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chats_workspace
                ON chats(workspace_id);
            CREATE INDEX IF NOT EXISTS idx_chat_messages_chat
                ON chat_messages(chat_id, created_at);
        `,
    },
];
