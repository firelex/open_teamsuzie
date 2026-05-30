import { useCallback, useRef, useState } from 'react';
import type { ChatStreamEvent, ChatThreadMessage } from './types.js';

export type { ChatStreamEvent } from './types.js';

export function reduceEvents(
  messages: ChatThreadMessage[],
  event: ChatStreamEvent,
  assistantId: string,
): ChatThreadMessage[] {
  return messages.map((m) => {
    if (m.id !== assistantId) return m;
    switch (event.type) {
      case 'chunk':
        return { ...m, content: m.content + event.text };
      case 'tool_call':
        return {
          ...m,
          toolCalls: [
            ...(m.toolCalls ?? []),
            { id: event.id, name: event.name, args: event.args, status: 'running' as const },
          ],
        };
      case 'tool_result':
        return {
          ...m,
          toolCalls: (m.toolCalls ?? []).map((c) =>
            c.id === event.id ? { ...c, status: 'ok' as const, result: event.result } : c,
          ),
        };
      case 'tool_error':
        return {
          ...m,
          toolCalls: (m.toolCalls ?? []).map((c) =>
            c.id === event.id ? { ...c, status: 'error' as const, error: event.error } : c,
          ),
        };
      case 'done':
        return { ...m, pending: false };
      case 'error':
        return {
          ...m,
          pending: false,
          content: m.content + (m.content ? '\n\n' : '') + `⚠ ${event.message}`,
        };
    }
  });
}

export interface UseChatThreadStreamArgs {
  endpoint: string;
  extraBody?: Record<string, unknown>;
  /** Lazy-initialized seed for the message state. Used when the parent
   *  has a per-chat cache it wants to restore synchronously on mount.
   *  Only consulted on first render; later changes are ignored. */
  initialMessages?: ChatThreadMessage[];
}

export interface UseChatThreadStreamResult {
  messages: ChatThreadMessage[];
  inFlight: boolean;
  send: (text: string, opts?: { chatId?: string | null; history?: ChatThreadMessage[] }) => Promise<void>;
  abort: () => void;
  setMessages: (next: ChatThreadMessage[]) => void;
  error: string | null;
}

export function useChatThreadStream(args: UseChatThreadStreamArgs): UseChatThreadStreamResult {
  const { endpoint, extraBody } = args;
  const [messages, setMessagesState] = useState<ChatThreadMessage[]>(
    () => args.initialMessages ?? [],
  );
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const setMessages = useCallback((next: ChatThreadMessage[]) => setMessagesState(next), []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setInFlight(false);
  }, []);

  const send = useCallback(async (
    text: string,
    opts?: { chatId?: string | null; history?: ChatThreadMessage[] },
  ): Promise<void> => {
    if (!text.trim() || inFlight) return;
    setError(null);

    const userId = crypto.randomUUID();
    const assistantId = crypto.randomUUID();
    const history = opts?.history ?? messages;
    const nextHistory: ChatThreadMessage[] = [
      ...history,
      { id: userId, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', pending: true },
    ];
    setMessagesState(nextHistory);
    setInFlight(true);

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          chatId: opts?.chatId ?? null,
          history: history.map((m) => ({ role: m.role, content: m.content })),
          ...(extraBody ?? {}),
        }),
        signal: ac.signal,
      });
      if (!res.body) throw new Error('no response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let parsed: ChatStreamEvent;
          try { parsed = JSON.parse(line.slice(6)) as ChatStreamEvent; }
          catch { continue; }
          if (parsed.type === 'error') setError(parsed.message);
          setMessagesState((cur) => reduceEvents(cur, parsed, assistantId));
        }
      }
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        setMessagesState((cur) =>
          cur.map((m) => (m.id === assistantId ? { ...m, pending: false } : m)),
        );
      } else {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setMessagesState((cur) =>
          cur.map((m) =>
            m.id === assistantId
              ? { ...m, pending: false, content: m.content + (m.content ? '\n\n' : '') + `⚠ ${message}` }
              : m,
          ),
        );
      }
    } finally {
      setInFlight(false);
      abortRef.current = null;
    }
  }, [endpoint, extraBody, inFlight, messages]);

  return { messages, inFlight, send, abort, setMessages, error };
}
