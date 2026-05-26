import { useEffect, useRef, useState } from 'react';
import type { ChatThreadProps, ChatToolCall } from './types.js';
import { useChatThreadStream } from './use-chat-thread-stream.js';
import { MarkdownMessage } from '../markdown-message.js';

/* ── Editorial-terminal aesthetic, tuned to the host palette ──────────────
 *
 * The chat lives inside developer surfaces that use the host's design tokens
 * (Inter sans / JetBrains Mono mono / electric-violet primary). This
 * component pulls those vars directly so it matches the surrounding chrome
 * (start page, project page) without needing per-host overrides.
 *
 * Aesthetic moves:
 *   - Mono is the chat's voice, sans (markdown) is the body.
 *   - No "bubble" cliché. Speaker is the leading glyph: ▸ in primary for
 *     the user, a muted │ rail for the assistant.
 *   - Tool calls render as a single dashed-top row: tool name on the left
 *     in primary, args summary truncated in muted, status token pinned
 *     right. Args expand on hover. Short status flash when a tool resolves.
 *   - Composer textarea is borderless with a leading ▸ rail. Send is a
 *     primary-colored text link. Hint line shows keyboard shortcuts.
 *   - Subtle 24px hairline grid in the background for atmosphere.
 *   - One-time CSS injection for keyframes (the ui package builds with tsc
 *     only — no CSS imports).
 *
 * Sizes match the host's start-page chrome: 14px body, 12px tool/hint,
 * 11px sub-hint. Colors come from CSS vars so a future dark-mode flip
 * works out-of-the-box.
 */

const STYLE_ID = 'teamsuzie-chat-thread-styles-v2';
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
  from { background-color: color-mix(in oklab, var(--primary) 12%, transparent); }
  to   { background-color: transparent; }
}
.ct-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  color: var(--foreground);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  background: var(--background);
}
.ct-header {
  border-bottom: 1px solid var(--border);
  padding: 8px 14px;
  font-size: 12px;
  color: var(--muted-foreground);
  letter-spacing: 0.02em;
}
.ct-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  background-image: linear-gradient(
    transparent 23px,
    color-mix(in oklab, var(--foreground) 4%, transparent) 23px,
    color-mix(in oklab, var(--foreground) 4%, transparent) 24px
  );
  background-size: 100% 24px;
  background-attachment: local;
}
.ct-empty {
  font-size: 11px;
  color: var(--muted-foreground);
  letter-spacing: 0.03em;
  line-height: 1.6;
}
.ct-empty-glyph {
  color: var(--primary);
}
.ct-turn {
  animation: _ct_slideUp 140ms ease-out both;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ct-user {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.75ch;
  font-size: 12px;
  line-height: 1.55;
  color: var(--foreground);
}
.ct-user-glyph {
  color: var(--primary);
  font-weight: 600;
  user-select: none;
}
.ct-user-body {
  white-space: pre-wrap;
  word-break: break-word;
}
.ct-assistant {
  display: grid;
  grid-template-columns: 1ch 1fr;
  gap: 0.75ch;
  align-items: start;
  min-width: 0;
}
.ct-rail {
  color: var(--muted-foreground);
  opacity: 0.5;
  font-size: 12px;
  line-height: 1.55;
  user-select: none;
}
.ct-assistant-body {
  min-width: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--foreground);
  font-family: var(--font-sans, system-ui, sans-serif);
}
.ct-tools {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.ct-tool {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.8ch;
  align-items: baseline;
  padding: 5px 0;
  border-top: 1px dashed var(--border);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--foreground);
}
.ct-tools > .ct-tool:first-child { border-top: none; }
.ct-tool[data-flash="true"] {
  animation: _ct_statusFlash 800ms ease-out forwards;
}
.ct-tool-name {
  color: var(--primary);
  letter-spacing: 0.02em;
  font-weight: 500;
}
.ct-tool-args {
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ct-tool:hover .ct-tool-args {
  white-space: normal;
  overflow: visible;
  text-overflow: clip;
  color: var(--foreground);
}
.ct-tool-status {
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
  letter-spacing: 0.04em;
}
.ct-tool-status[data-status="ok"]    { color: oklch(60% 0.16 150); }
.ct-tool-status[data-status="error"] { color: oklch(58% 0.215 27); }
.ct-tool-error {
  grid-column: 1 / -1;
  color: oklch(58% 0.215 27);
  margin-top: 2px;
  white-space: pre-wrap;
}
.ct-dots {
  margin-top: 6px;
  font-size: 14px;
  color: var(--primary);
  letter-spacing: 0.3ch;
}
.ct-dots > span {
  display: inline-block;
  animation: _ct_dotPulse 1.2s infinite ease-in-out both;
}
.ct-dots > span:nth-child(2) { animation-delay: 0.16s; }
.ct-dots > span:nth-child(3) { animation-delay: 0.32s; }
.ct-composer {
  border-top: 1px solid var(--border);
  padding: 10px 14px 12px;
  background: color-mix(in oklab, var(--foreground) 2%, var(--background));
}
.ct-composer-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ct-composer-glyph {
  color: var(--primary);
  font-family: var(--font-mono);
  font-size: 12px;
  padding-top: 7px;
  user-select: none;
}
.ct-textarea {
  flex: 1;
  min-height: 30px;
  padding: 6px 4px;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  line-height: 1.5;
  background: transparent;
  color: var(--foreground);
  border: none;
  outline: none;
  resize: none;
  caret-color: var(--primary);
}
.ct-textarea::placeholder {
  color: var(--muted-foreground);
  font-style: italic;
}
.ct-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding-left: calc(1ch + 8px);
}
.ct-hint {
  font-size: 10px;
  color: var(--muted-foreground);
  letter-spacing: 0.04em;
}
.ct-hint kbd {
  font-family: var(--font-mono);
  background: color-mix(in oklab, var(--foreground) 6%, var(--background));
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 9px;
  color: var(--foreground);
}
.ct-send {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  background: transparent;
  color: var(--primary);
  border: none;
  padding: 4px 8px;
  cursor: pointer;
  letter-spacing: 0.04em;
  font-weight: 500;
}
.ct-send:disabled {
  color: var(--muted-foreground);
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

function DefaultToolCallCard({ call }: { call: ChatToolCall }) {
  const summary = (() => {
    try {
      const s = JSON.stringify(call.args);
      // Strip outer braces for a less JSON-y read.
      return s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1) : s;
    } catch {
      return '…';
    }
  })();
  return (
    <div className="ct-tool" data-flash={call.status !== 'running'}>
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

  useEffect(() => {
    if (stream.inFlight) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [stream.messages, stream.inFlight]);

  // Auto-grow the textarea up to a cap.
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

  const rootClass = className ? `ct-root ${className}` : 'ct-root';

  return (
    <div className={rootClass}>
      {header && <div className="ct-header">{header}</div>}

      <div className="ct-scroll">
        {!loadedHistory && (
          <div className="ct-empty">· loading ·</div>
        )}

        {loadedHistory && stream.messages.length === 0 && (
          <div className="ct-empty">
            <div style={{ marginBottom: 8 }}>
              <span className="ct-empty-glyph">▸</span>{' '}
              start a conversation
            </div>
            <div style={{ paddingLeft: '2ch' }}>
              tell the agent what to change. it will read the manifest,<br />
              call <span className="ct-empty-glyph">apply_manifest_patch</span>, and confirm.
            </div>
          </div>
        )}

        {stream.messages.map((m, i) => (
          <div
            key={m.id}
            className="ct-turn"
            style={{ animationDelay: `${Math.min(i, 6) * 18}ms` }}
          >
            {m.role === 'user' ? (
              <div className="ct-user">
                <span className="ct-user-glyph">▸</span>
                <span className="ct-user-body">{m.content}</span>
              </div>
            ) : (
              <div className="ct-assistant">
                <span aria-hidden className="ct-rail">│</span>
                <div className="ct-assistant-body">
                  {m.toolCalls && m.toolCalls.length > 0 && (
                    <div className="ct-tools">
                      {m.toolCalls.map((c) => (
                        <div key={c.id}>
                          {renderToolCall ? renderToolCall(c) : <DefaultToolCallCard call={c} />}
                        </div>
                      ))}
                    </div>
                  )}
                  {m.content && (
                    renderAssistantText
                      ? renderAssistantText(m.content)
                      : <MarkdownMessage content={m.content} />
                  )}
                  {m.pending && (
                    <div className="ct-dots"><span>·</span><span>·</span><span>·</span></div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="ct-composer">
        <div className="ct-composer-row">
          <span aria-hidden className="ct-composer-glyph">▸</span>
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
          />
        </div>
        <div className="ct-meta">
          <span className="ct-hint">
            <kbd>↵</kbd> send  <kbd>⇧↵</kbd> newline  <kbd>esc</kbd> abort
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
