import { useEffect, useRef, useState } from 'react';
import type { ChatThreadProps, ChatToolCall } from './types.js';
import { useChatThreadStream } from './use-chat-thread-stream.js';
import { MarkdownMessage } from '../markdown-message.js';

function DefaultToolCallCard({ call }: { call: ChatToolCall }) {
  const summary = (() => {
    try { return JSON.stringify(call.args); } catch { return '…'; }
  })();
  return (
    <div style={{
      border: '1px solid var(--border, #333)',
      borderRadius: 4,
      padding: '6px 8px',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11,
      background: 'rgba(255,255,255,0.02)',
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>tool:</span>
        <span>{call.name}</span>
        <span style={{ marginLeft: 'auto', opacity: 0.7 }}>
          {call.status === 'running' ? '…' : call.status === 'ok' ? '✓' : '✗'}
        </span>
      </div>
      <div style={{ opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {summary}
      </div>
      {call.status === 'error' && call.error && (
        <div style={{ color: '#f85149', marginTop: 4 }}>{call.error}</div>
      )}
    </div>
  );
}

export function ChatThread(props: ChatThreadProps) {
  const {
    endpoint, chatId, fetchHistory, onChatCreated, extraBody,
    renderToolCall, renderAssistantText, placeholder, composerExtras, header,
    onToolResult, onError, className,
  } = props;
  const stream = useChatThreadStream({ endpoint, extraBody });
  const [input, setInput] = useState('');
  const [loadedHistory, setLoadedHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Initial history load.
  useEffect(() => {
    let cancelled = false;
    if (!chatId || !fetchHistory) { setLoadedHistory(true); return; }
    (async () => {
      try {
        const history = await fetchHistory(chatId);
        if (!cancelled) {
          stream.setMessages(history);
          setLoadedHistory(true);
        }
      } catch {
        if (!cancelled) setLoadedHistory(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Scroll-pin while streaming.
  useEffect(() => {
    if (stream.inFlight) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream.messages, stream.inFlight]);

  // Forward errors to host.
  useEffect(() => {
    if (stream.error) onError?.(stream.error);
  }, [stream.error, onError]);

  // Notify host on every fresh tool result. Track ids we've already fired
  // against to avoid double-firing on re-render.
  const seenToolResults = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const m of stream.messages) {
      if (m.role !== 'assistant' || !m.toolCalls) continue;
      for (const c of m.toolCalls) {
        if ((c.status === 'ok' || c.status === 'error') && !seenToolResults.current.has(c.id)) {
          seenToolResults.current.add(c.id);
          onToolResult?.(c);
        }
      }
    }
  }, [stream.messages, onToolResult]);

  // Best-effort chat-created notify: when chatId becomes non-null, fire once.
  const seedRef = useRef<string | null>(null);
  useEffect(() => {
    if (chatId && seedRef.current !== chatId) {
      seedRef.current = chatId;
      onChatCreated?.(chatId);
    }
  }, [chatId, onChatCreated]);

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    setInput('');
    await stream.send(text, { chatId });
  }

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {header && <div style={{ borderBottom: '1px solid var(--border, #333)' }}>{header}</div>}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!loadedHistory && (
          <div style={{ fontSize: 12, opacity: 0.6 }}>Loading…</div>
        )}
        {loadedHistory && stream.messages.length === 0 && (
          <div style={{ fontSize: 12, opacity: 0.5, fontStyle: 'italic' }}>
            Start a conversation. Use the chat to configure this agent.
          </div>
        )}
        {stream.messages.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {m.role === 'user' ? (
              <div style={{ alignSelf: 'flex-end', maxWidth: '90%', background: 'rgba(255,255,255,0.06)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>
                {m.content}
              </div>
            ) : (
              <div style={{ alignSelf: 'flex-start', maxWidth: '95%' }}>
                {m.content && (
                  renderAssistantText
                    ? renderAssistantText(m.content)
                    : <MarkdownMessage content={m.content} />
                )}
                {m.toolCalls?.map((c) => (
                  <div key={c.id} style={{ marginTop: 6 }}>
                    {renderToolCall ? renderToolCall(c) : <DefaultToolCallCard call={c} />}
                  </div>
                ))}
                {m.pending && (
                  <div style={{ marginTop: 4, fontSize: 11, opacity: 0.5 }}>…</div>
                )}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div style={{ borderTop: '1px solid var(--border, #333)', padding: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder ?? 'Type a message…'}
            rows={2}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void handleSend();
              } else if (e.key === 'Escape' && stream.inFlight) {
                e.preventDefault();
                stream.abort();
              }
            }}
            style={{
              flex: 1,
              minHeight: 32,
              padding: '6px 8px',
              fontSize: 13,
              background: 'transparent',
              color: 'var(--foreground, #e6e6e6)',
              border: '1px solid var(--border, #333)',
              borderRadius: 4,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          {composerExtras}
          <button
            disabled={stream.inFlight || !input.trim()}
            onClick={() => { void handleSend(); }}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              background: 'var(--primary, #f4b400)',
              color: '#000',
              border: 'none',
              borderRadius: 4,
              cursor: stream.inFlight || !input.trim() ? 'not-allowed' : 'pointer',
              opacity: stream.inFlight || !input.trim() ? 0.5 : 1,
            }}
          >
            {stream.inFlight ? 'sending…' : 'send'}
          </button>
        </div>
        <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>
          Enter to send · Shift-Enter for newline · Esc to abort
        </div>
      </div>
    </div>
  );
}
