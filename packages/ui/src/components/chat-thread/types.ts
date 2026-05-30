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
  /** Pre-fill the composer input with this text on mount. Used when navigating
   *  into a chat with a queued message — e.g. the bare-route → /c/:id handoff
   *  where the user typed in the bare-route composer and is being navigated to
   *  the persisted chat. */
  defaultInput?: string;
  /** When true AND `defaultInput` is set AND history has finished loading,
   *  dispatch the defaultInput as the first send exactly once. Pairs with
   *  defaultInput to implement the bare-route auto-dispatch without exposing
   *  an imperative send ref. */
  autoSendDefaultInput?: boolean;
  /** Pre-populate the thread with these messages on mount so a remount
   *  (e.g. when the parent switches between cached chat surfaces) restores
   *  visible state synchronously instead of flickering through an empty
   *  state while fetchHistory roundtrips. When both initialMessages and
   *  fetchHistory are set, initialMessages renders first and fetchHistory
   *  runs in the background to refresh. */
  initialMessages?: ChatThreadMessage[];
  /** Fires whenever the thread's message list changes — initial population,
   *  streaming chunks, completed turns, tool events. Parents use this to
   *  cache per-chat state so they can pass initialMessages on a subsequent
   *  remount of the same chat. Fires frequently during streaming; debounce
   *  in the parent if needed. */
  onMessagesChange?: (messages: ChatThreadMessage[]) => void;
}
