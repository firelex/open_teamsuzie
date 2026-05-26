import type { ReactNode } from 'react';

export interface ChatToolCall {
  id: string;
  name: string;
  args: unknown;
  status: 'running' | 'ok' | 'error';
  result?: unknown;
  error?: string;
}

export interface ChatThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Tool calls attached to an assistant turn, in order. */
  toolCalls?: ChatToolCall[];
  /** True while the assistant turn is still streaming. */
  pending?: boolean;
  /** Attachments rendered as chips at the top of a user turn (optional). */
  attachments?: ReadonlyArray<{ id: string; name: string }>;
}

/** Raw SSE event from the server. Matches the existing upstream chat-route contract. */
export type ChatStreamEvent =
  | { type: 'chunk';       text: string }
  | { type: 'tool_call';   id: string; name: string; args: unknown }
  | { type: 'tool_result'; id: string; name: string; result: unknown }
  | { type: 'tool_error';  id: string; name: string; error: string }
  | { type: 'done' }
  | { type: 'error';       message: string };

export interface ChatThreadProps {
  endpoint: string;
  chatId: string | null;
  fetchHistory?: (chatId: string) => Promise<ChatThreadMessage[]>;
  onChatCreated?: (id: string) => void;
  extraBody?: Record<string, unknown>;
  renderToolCall?: (call: ChatToolCall) => ReactNode;
  renderAssistantText?: (text: string) => ReactNode;
  placeholder?: string;
  composerExtras?: ReactNode;
  header?: ReactNode;
  onToolResult?: (call: ChatToolCall) => void;
  onError?: (message: string) => void;
  className?: string;
}
