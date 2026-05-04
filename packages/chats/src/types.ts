export type ChatMessageRole = 'user' | 'assistant';

export interface Chat {
    id: string;
    workspaceId: string;
    name: string;
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
    createdAt: number;
}

export interface CreateChatInput {
    workspaceId: string;
    /** Defaults to "New chat". */
    name?: string;
}

export interface UpdateChatInput {
    name?: string;
}

export interface AppendMessageInput {
    chatId: string;
    role: ChatMessageRole;
    content: string;
    toolEvents?: string | null;
    citations?: string | null;
}
