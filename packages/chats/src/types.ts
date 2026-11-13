export type ChatMessageRole = 'user' | 'assistant';

export interface Chat {
    id: string;
    workspaceId: string;
    name: string;
    /** Opaque persona id active when this chat was created. The chats
     *  package never resolves it — the host app does. `null` = no persona
     *  (default assistant). */
    personaId: string | null;
    /** Who started the chat; null for chats from before this was recorded (see ChatsStore.startedBy). */
    createdBy: string | null;
    createdAt: number;
    updatedAt: number;
}

export interface ChatMessage {
    id: string;
    chatId: string;
    role: ChatMessageRole;
    content: string;
    /** Raw JSON-encoded tool-event array. Caller parses. */
    toolEvents: string | null;
    /** Raw JSON-encoded `Citation[]`. Caller parses. */
    citations: string | null;
    /** Who wrote it; null for assistant messages and messages from before authors were recorded. */
    authorId: string | null;
    createdAt: number;
}

export interface CreateChatInput {
    workspaceId: string;
    /** Defaults to "New chat". */
    name?: string;
    /** Opaque persona id; null/undefined = default assistant. */
    personaId?: string | null;
    /** Who starts it (an opaque person id, e.g. an email). */
    createdBy?: string | null;
}

export interface UpdateChatInput {
    name?: string;
    /** Pass `null` to clear the persona, a string to switch. */
    personaId?: string | null;
}

export interface AppendMessageInput {
    chatId: string;
    role: ChatMessageRole;
    content: string;
    toolEvents?: string | null;
    citations?: string | null;
    /** Who wrote the message (for user messages in shared chats). */
    authorId?: string | null;
}
