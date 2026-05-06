import { randomUUID } from 'node:crypto';
import { prepareCached, type DatabaseInstance } from '@teamsuzie/db-sqlite';

import type {
    AppendMessageInput,
    Chat,
    ChatMessage,
    ChatMessageRole,
    CreateChatInput,
    UpdateChatInput,
} from './types.js';

interface ChatRow {
    id: string;
    workspace_id: string;
    name: string;
    persona_id: string | null;
    created_at: number;
    updated_at: number;
}

interface MessageRow {
    id: string;
    chat_id: string;
    role: string;
    content: string;
    tool_events: string | null;
    citations: string | null;
    created_at: number;
}

export interface ChatsStoreOptions {
    db: DatabaseInstance;
    idFactory?: () => string;
    now?: () => number;
}

export class ChatsStore {
    private readonly db: DatabaseInstance;
    private readonly newId: () => string;
    private readonly clock: () => number;

    constructor(opts: ChatsStoreOptions) {
        this.db = opts.db;
        this.newId = opts.idFactory ?? (() => randomUUID());
        this.clock = opts.now ?? (() => Date.now());
    }

    // --- Chat -------------------------------------------------------------

    createChat(input: CreateChatInput): Chat {
        const id = this.newId();
        const now = this.clock();
        const name = input.name?.trim() || 'New chat';
        const personaId = input.personaId ?? null;
        prepareCached<[string, string, string, string | null, number, number]>(
            this.db,
            `INSERT INTO chats (id, workspace_id, name, persona_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(id, input.workspaceId, name, personaId, now, now);
        return this.getChat(id)!;
    }

    getChat(id: string): Chat | null {
        const row = prepareCached<[string], ChatRow>(
            this.db,
            `SELECT * FROM chats WHERE id = ?`,
        ).get(id);
        return row ? rowToChat(row) : null;
    }

    listChats(workspaceId: string): Chat[] {
        return prepareCached<[string], ChatRow>(
            this.db,
            `SELECT * FROM chats WHERE workspace_id = ? ORDER BY updated_at DESC`,
        )
            .all(workspaceId)
            .map(rowToChat);
    }

    updateChat(id: string, patch: UpdateChatInput): Chat | null {
        const existing = this.getChat(id);
        if (!existing) return null;
        const now = this.clock();
        const nextName = patch.name?.trim() || existing.name;
        // personaId in the patch is tri-state: undefined = leave, null = clear,
        // string = switch. Distinguish "key absent" from "value null" via `in`.
        const nextPersonaId =
            'personaId' in patch ? patch.personaId ?? null : existing.personaId;
        prepareCached<[string, string | null, number, string]>(
            this.db,
            `UPDATE chats SET name = ?, persona_id = ?, updated_at = ? WHERE id = ?`,
        ).run(nextName, nextPersonaId, now, id);
        return this.getChat(id);
    }

    /** Bump updated_at without changing other fields — call after appending a message. */
    touchChat(id: string): void {
        prepareCached<[number, string]>(
            this.db,
            `UPDATE chats SET updated_at = ? WHERE id = ?`,
        ).run(this.clock(), id);
    }

    deleteChat(id: string): boolean {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM chats WHERE id = ?`,
        ).run(id);
        return result.changes > 0;
    }

    // --- Messages ---------------------------------------------------------

    appendMessage(input: AppendMessageInput): ChatMessage {
        const id = this.newId();
        const now = this.clock();
        prepareCached<
            [
                string,
                string,
                string,
                string,
                string | null,
                string | null,
                number,
            ]
        >(
            this.db,
            `INSERT INTO chat_messages
             (id, chat_id, role, content, tool_events, citations, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(
            id,
            input.chatId,
            input.role,
            input.content,
            input.toolEvents ?? null,
            input.citations ?? null,
            now,
        );
        this.touchChat(input.chatId);
        return this.getMessage(id)!;
    }

    getMessage(id: string): ChatMessage | null {
        const row = prepareCached<[string], MessageRow>(
            this.db,
            `SELECT * FROM chat_messages WHERE id = ?`,
        ).get(id);
        return row ? rowToMessage(row) : null;
    }

    listMessages(chatId: string): ChatMessage[] {
        return prepareCached<[string], MessageRow>(
            this.db,
            `SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY created_at, id`,
        )
            .all(chatId)
            .map(rowToMessage);
    }

    /** Drop every message in a chat — useful for "clear history" controls. */
    clearMessages(chatId: string): number {
        const result = prepareCached<[string]>(
            this.db,
            `DELETE FROM chat_messages WHERE chat_id = ?`,
        ).run(chatId);
        return result.changes;
    }
}

function rowToChat(row: ChatRow): Chat {
    return {
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        personaId: row.persona_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function rowToMessage(row: MessageRow): ChatMessage {
    return {
        id: row.id,
        chatId: row.chat_id,
        role: row.role as ChatMessageRole,
        content: row.content,
        toolEvents: row.tool_events,
        citations: row.citations,
        createdAt: row.created_at,
    };
}
