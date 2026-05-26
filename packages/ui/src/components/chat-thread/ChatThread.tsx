import { useEffect, useRef, useState } from 'react';
import type { ChatThreadProps, ChatToolCall } from './types.js';
import { useChatThreadStream } from './use-chat-thread-stream.js';
import { MarkdownMessage } from '../markdown-message.js';

/* ── Editorial-terminal aesthetic ─────────────────────────────────────────
 *
 * The chat lives inside developer surfaces (SuzieCode's BuildView dock,
 * AssistantPage). The host palette is dark, the system font is IBM Plex
 * Mono, and the accent is a yellow primary. This component leans in:
 *   - Monospace throughout. The mono character is the chat's voice.
 *   - No "bubble" cliché. Speaker is signalled by a leading glyph (▸ for
 *     user, │ rail for assistant) and indented body text.
 *   - Tool calls render as a single terminal-style row with a status glyph
 *     pinned right; on hover the args summary expands.
 *   - The composer textarea has no visible border — just an inset surface
 *     and a hairline above. Send is a primary-colored text link.
 *   - One-time CSS injection for keyframes (slide-up, pending dots, status
 *     flash). The ui package builds with tsc, so we inject at runtime
 *     instead of importing a .css sibling.
 *
 * Width-agnostic: works at the 360px dock and the wider AssistantPage.
 */

const STYLE_ID = 'teamsuzie-chat-thread-styles-v1';
const INJECTED_CSS = `
@keyframes _ct_slideUp {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes _ct_dotPulse {
  0%, 80%, 100% { opacity: 0.18; }
  40%           { opacity: 0.85; }
}
@keyframes _ct_statusFlash {
  from { background-color: rgba(244,180,0,0.18); }
  to   { background-color: transparent; }
}
.ct-turn {
  animation: _ct_slideUp 140ms ease-out both;
}
.ct-tool {
  position: relative;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.6ch;
  align-items: baseline;
  padding: 6px 0;
  border-top: 1px dashed var(--border, #2a2a26);
  font-family: var(--ct-mono, ui-monospace, "IBM Plex Mono", SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
}
.ct-tool[data-flash="true"] {
  animation: _ct_statusFlash 800ms ease-out forwards;
}
.ct-tool-name {
  color: var(--ct-accent, var(--primary, #f4b400));
  letter-spacing: 0.02em;
}
.ct-tool-args {
  color: var(--ct-muted, #7a7a72);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ct-tool:hover .ct-tool-args {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  color: var(--ct-fg, var(--foreground, #e6e6e2));
}
.ct-tool-status {
  font-variant-numeric: tabular-nums;
  color: var(--ct-muted, #7a7a72);
}
.ct-tool-status[data-status="ok"]    { color: #8fc06b; }
.ct-tool-status[data-status="error"] { color: #f06464; }
.ct-tool-error {
  grid-column: 1 / -1;
  color: #f06464;
  margin-top: 2px;
  white-space: pre-wrap;
}
.ct-dots > span {
  display: inline-block;
  animation: _ct_dotPulse 1.2s infinite ease-in-out both;
}
.ct-dots > span:nth-child(2) { animation-delay: 0.16s; }
.ct-dots > span:nth-child(3) { animation-delay: 0.32s; }
.ct-textarea {
  flex: 1;
  min-height: 36px;
  padding: 8px 0 8px 18px;
  font-family: var(--ct-mono, ui-monospace, "IBM Plex Mono", SFMono-Regular, Menlo, monospace);
  font-size: 13px;
  line-height: 1.45;
  background: transparent;
  color: var(--ct-fg, var(--foreground, #e6e6e2));
  border: none;
  outline: none;
  resize: none;
  caret-color: var(--ct-accent, var(--primary, #f4b400));
}
.ct-textarea::placeholder {
  color: var(--ct-muted, #7a7a72);
  font-style: italic;
}
.ct-send {
  font-family: var(--ct-mono, ui-monospace, "IBM Plex Mono", SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  background: transparent;
  color: var(--ct-accent, var(--primary, #f4b400));
  border: none;
  padding: 4px 8px;
  cursor: pointer;
  letter-spacing: 0.04em;
}
.ct-send:disabled {
  color: var(--ct-muted, #7a7a72);
  cursor: not-allowed;
}
.ct-send:not(:disabled):hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = INJECTED_CSS;
  document.head.appendChild(el);
}

const MONO = 'var(--ct-mono, ui-monospace, "IBM Plex Mono", SFMono-Regular, Menlo, monospace)';
const FG = 'var(--ct-fg, var(--foreground, #e6e6e2))';
const MUTED = 'var(--ct-muted, #7a7a72)';
const ACCENT = 'var(--ct-accent, var(--primary, #f4b400))';
const RULE = 'var(--ct-rule, var(--border, #2a2a26))';

function DefaultToolCallCard({ call }: { call: ChatToolCall }) {
  const summary = (() => {
    try {
      const s = JSON.stringify(call.args);
      // Drop the outer braces — feels less JSON-y, more terminal-y.
      return s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
    } catch {
      return '…';
    }
  })();
  const flashKey = `${call.id}:${call.status}`;
  return (
    <div className="ct-tool" data-flash={call.status !== 'running'} key={flashKey}>
      <span className="ct-tool-name">⟢ {call.name}</span>
      <span className="ct-tool-args">{summary || '·'}</span>
      <span className="ct-tool-status" data-status={call.status}>
        {call.status === 'running' ? '· · ·' : call.status === 'ok' ? 'ok' : 'err'}
      </span>
      {call.status === 'error' && call.error && (
        <span className="ct-tool-error">{call.error}</span>
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // One-time style injection.
  useEffect(() => { ensureStyles(); }, []);

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

  // Auto-grow the textarea up to a cap so multi-line drafts don't crush the composer.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  useEffect(() => {
    if (stream.error) onError?.(stream.error);
  }, [stream.error, onError]);

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
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        fontFamily: MONO,
        color: FG,
      }}
    >
      {header && (
        <div style={{ borderBottom: `1px solid ${RULE}`, padding: '6px 12px' }}>{header}</div>
      )}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 16px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          // Subtle hairline grid in the background for atmosphere — repeats
          // every 24px vertically. Use background-image so it doesn't
          // interact with padding.
          backgroundImage:
            'linear-gradient(transparent 23px, rgba(255,255,255,0.025) 23px, rgba(255,255,255,0.025) 24px)',
          backgroundSize: '100% 24px',
          backgroundAttachment: 'local',
        }}
      >
        {!loadedHistory && (
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.04em' }}>· loading ·</div>
        )}

        {loadedHistory && stream.messages.length === 0 && (
          <div style={{ fontSize: 11, color: MUTED, letterSpacing: '0.04em', lineHeight: 1.6 }}>
            <div style={{ marginBottom: 8 }}>
              <span style={{ color: ACCENT }}>▸</span>{' '}
              start a conversation
            </div>
            <div style={{ paddingLeft: '2ch' }}>
              tell the agent what to change. it will read the manifest,<br />
              call <span style={{ color: ACCENT }}>apply_manifest_patch</span>, and confirm.
            </div>
          </div>
        )}

        {stream.messages.map((m, i) => (
          <div
            key={m.id}
            className="ct-turn"
            style={{
              animationDelay: `${Math.min(i, 6) * 18}ms`,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {m.role === 'user' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '0.75ch',
                  fontSize: 13,
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: ACCENT }}>▸</span>
                <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.content}</span>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1ch 1fr',
                  gap: '0.75ch',
                  alignItems: 'start',
                }}
              >
                <span
                  aria-hidden
                  style={{
                    color: MUTED,
                    opacity: 0.4,
                    fontFamily: MONO,
                    fontSize: 13,
                    lineHeight: 1.5,
                    userSelect: 'none',
                  }}
                >
                  │
                </span>
                <div style={{ minWidth: 0 }}>
                  {m.content && (
                    <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                      {renderAssistantText
                        ? renderAssistantText(m.content)
                        : <MarkdownMessage content={m.content} />}
                    </div>
                  )}
                  {m.toolCalls?.map((c) => (
                    <div key={c.id}>
                      {renderToolCall ? renderToolCall(c) : <DefaultToolCallCard call={c} />}
                    </div>
                  ))}
                  {m.pending && (
                    <div className="ct-dots" style={{ marginTop: 6, fontSize: 14, color: ACCENT, letterSpacing: '0.3ch' }}>
                      <span>·</span><span>·</span><span>·</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          borderTop: `1px solid ${RULE}`,
          padding: '8px 12px 10px',
          background: 'rgba(0,0,0,0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          <span
            aria-hidden
            style={{
              color: ACCENT,
              fontFamily: MONO,
              fontSize: 13,
              paddingTop: 8,
              userSelect: 'none',
            }}
          >
            ▸
          </span>
          <textarea
            ref={textareaRef}
            className="ct-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder ?? 'type a message…'}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                void handleSend();
              } else if (e.key === 'Escape' && stream.inFlight) {
                e.preventDefault();
                stream.abort();
              }
            }}
            style={{ paddingLeft: 4 }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1ch',
            marginTop: 6,
            paddingLeft: '2ch',
          }}
        >
          <span style={{ fontSize: 10, color: MUTED, letterSpacing: '0.06em' }}>
            enter · send  shift-enter · newline  esc · abort
          </span>
          <span style={{ flex: 1 }} />
          {composerExtras}
          <button
            className="ct-send"
            disabled={stream.inFlight || !input.trim()}
            onClick={() => { void handleSend(); }}
          >
            {stream.inFlight ? '· · · sending' : '↳ send'}
          </button>
        </div>
      </div>
    </div>
  );
}
