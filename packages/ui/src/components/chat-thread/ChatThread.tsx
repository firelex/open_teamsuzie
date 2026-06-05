import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import type { ChatAttachment, ChatThreadProps, ChatToolCall } from './types.js';
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
 *   - User turns sit inside a soft primary-tinted bubble; assistant turns
 *     are plain flowing text. Both stay left-aligned (no WhatsApp-style
 *     right-aligned user bubble) so long messages stay readable.
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

// Bump the version suffix whenever the INJECTED_CSS string changes —
// `ensureStyles` early-returns when a tag with this id already exists, so
// without a bump a hot-reloaded page keeps serving the prior CSS revision.
const STYLE_ID = 'teamsuzie-chat-thread-styles-v12';
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
  from { background-color: color-mix(in oklab, var(--color-primary) 12%, transparent); }
  to   { background-color: transparent; }
}
.ct-root {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  color: var(--color-foreground);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  /* Transparent on purpose — the consumer's surface (bg-card on a rail,
     hero-atmosphere on a hero block, etc.) shows through. An earlier
     revision painted var(--color-background) here, which on SuzieCode's
     bg-card rail produced a visible white→off-white step between the
     projects list (pure white --color-card) and the chat area
     (--color-background ≈ oklch 98%), reading to the user as an
     accidental gradient inside the rail. Letting the parent surface
     define the bg keeps every host page consistent. */
  background: transparent;
}
.ct-header {
  border-bottom: 1px solid var(--color-border);
  padding: 8px 14px;
  font-size: 12px;
  color: var(--color-muted-foreground);
  letter-spacing: 0.02em;
}
.ct-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 18px 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  /* Earlier this carried a 24px hairline grid for editorial atmosphere
     ("notebook" feel). With the current bubble-user / plain-assistant
     treatment the grid reads as accidental rule lines slicing the
     conversation. Dropped. */
}
.ct-empty {
  font-size: 11px;
  color: var(--color-muted-foreground);
  letter-spacing: 0.03em;
  line-height: 1.6;
}
.ct-empty-glyph {
  color: var(--color-primary);
}
.ct-turn {
  animation: _ct_slideUp 140ms ease-out both;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* The user/assistant rows are differentiated by ONE signal: the user's
   message is wrapped in a primary-tinted bubble; the assistant's message
   is plain text that flows naturally. Earlier the component shipped a
   leading ▸ glyph for user and │ rail for assistant — both removed: with
   the bubble present, the glyphs were redundant noise, and the rail
   stranded the assistant text inside a misaligned column.

   Both rows stay left-aligned (no right-aligned WhatsApp-style user
   bubble) so the editorial flow remains readable for long messages. */
.ct-user {
  display: flex;
  font-size: 12px;
  line-height: 1.55;
  color: var(--color-foreground);
}
.ct-user-body {
  white-space: pre-wrap;
  word-break: break-word;
  background: color-mix(in oklab, var(--color-primary) 9%, var(--color-background));
  border: 1px solid color-mix(in oklab, var(--color-primary) 16%, transparent);
  border-radius: 10px;
  padding: 6px 10px;
  /* Bubble hugs its content rather than spanning the full chat width —
     keeps short messages compact and reads as a turn, not a card. The
     cap stops a very long single line from filling the column edge to
     edge. */
  max-width: min(85%, 56ch);
}
.ct-assistant {
  display: block;
  min-width: 0;
}
.ct-assistant-body {
  min-width: 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-foreground);
  font-family: var(--font-sans, system-ui, sans-serif);
}
/* MarkdownMessage renders react-markdown with its own h1/h2/p defaults,
 * which bubble to 16-24px and clash with the user-message scale. Clamp
 * every text element inside the assistant body to the thread's 12px
 * baseline while preserving headings as semantically bold + spaced. */
.ct-assistant-body p,
.ct-assistant-body li,
.ct-assistant-body ul,
.ct-assistant-body ol,
.ct-assistant-body blockquote,
.ct-assistant-body table,
.ct-assistant-body td,
.ct-assistant-body th,
.ct-assistant-body code,
.ct-assistant-body pre {
  font-size: 12px;
  line-height: 1.55;
}
.ct-assistant-body h1,
.ct-assistant-body h2,
.ct-assistant-body h3,
.ct-assistant-body h4,
.ct-assistant-body h5,
.ct-assistant-body h6 {
  font-size: 12px;
  font-weight: 600;
  margin: 8px 0 2px;
  line-height: 1.4;
}
.ct-assistant-body p { margin: 4px 0; }
.ct-assistant-body ul,
.ct-assistant-body ol {
  margin: 4px 0;
  padding-left: 18px;
}
.ct-assistant-body li { margin: 1px 0; }
.ct-assistant-body code {
  background: color-mix(in oklab, var(--color-foreground) 8%, var(--color-background));
  padding: 1px 4px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 11px;
}
.ct-assistant-body pre {
  background: color-mix(in oklab, var(--color-foreground) 6%, var(--color-background));
  padding: 6px 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin: 4px 0;
}
.ct-assistant-body pre code { background: none; padding: 0; }
.ct-tools {
  display: flex;
  flex-direction: column;
  margin-bottom: 8px;
}
.ct-tool {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.8ch;
  /* align-items:start instead of baseline so multi-line wrapped args do
     not drag the status pill into the middle of the row. Status and
     tool-name read cleanly off the first line of args. */
  align-items: start;
  padding: 5px 0;
  border-top: 1px dashed var(--color-border);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  color: var(--color-foreground);
}
.ct-tools > .ct-tool:first-child { border-top: none; }
.ct-tool[data-flash="true"] {
  animation: _ct_statusFlash 800ms ease-out forwards;
}
.ct-tool-name {
  color: var(--color-primary);
  letter-spacing: 0.02em;
  font-weight: 500;
}
.ct-tool-args {
  /* Always show full args wrapped. overflow-wrap:anywhere breaks inside
     long unspaced JSON strings (regex sources, paths) so the row never
     pushes its sibling columns out of view. Previously truncated with an
     ellipsis + reveal-on-hover; the truncation hid useful debugging info
     you couldnt see without a mouse. */
  color: var(--color-muted-foreground);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  min-width: 0;
}
.ct-tool:hover .ct-tool-args {
  color: var(--color-foreground);
}
.ct-tool-status {
  font-variant-numeric: tabular-nums;
  color: var(--color-muted-foreground);
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
/* Truncated tool-args render as a <details>. Summary line behaves like
   .ct-tool-args; clicking it expands a <pre> with the full pretty-printed
   JSON below the row. Threshold + truncation logic lives in
   DefaultToolCallCard. */
details.ct-tool-args {
  min-width: 0;
}
details.ct-tool-args > summary.ct-tool-args-summary {
  list-style: none;
  cursor: pointer;
  color: var(--color-muted-foreground);
  overflow-wrap: anywhere;
}
details.ct-tool-args > summary.ct-tool-args-summary::-webkit-details-marker {
  display: none;
}
details.ct-tool-args[open] > summary.ct-tool-args-summary {
  color: var(--color-foreground);
}
.ct-tool-args-expand {
  margin-left: 0.8ch;
  color: var(--color-primary);
  opacity: 0.7;
  font-size: 0.9em;
}
details.ct-tool-args[open] .ct-tool-args-expand {
  opacity: 0;
}
.ct-tool-args-full {
  grid-column: 1 / -1;
  margin: 4px 0 0;
  padding: 6px 8px;
  background: var(--color-muted);
  border: 1px solid var(--color-border);
  border-radius: 2px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  line-height: 1.4;
  color: var(--color-foreground);
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ct-dots {
  margin-top: 6px;
  font-size: 14px;
  color: var(--color-primary);
  letter-spacing: 0.3ch;
}
.ct-dots > span {
  display: inline-block;
  animation: _ct_dotPulse 1.2s infinite ease-in-out both;
}
.ct-dots > span:nth-child(2) { animation-delay: 0.16s; }
.ct-dots > span:nth-child(3) { animation-delay: 0.32s; }
.ct-composer {
  /* The composer is a separate surface from the message stream above —
     opaque --color-card (usually white) on top of whatever the host page
     paints behind the chat. The top border uses a 20%-foreground mix
     instead of --color-border because --color-border is ~92% lightness in
     this codebase, which disappears on both lavender atmospheres and on
     white. The upward shadow is supporting polish. */
  border-top: 1px solid color-mix(in oklab, var(--color-foreground) 20%, transparent);
  padding: 12px 14px 14px;
  background: var(--color-card);
  box-shadow: 0 -8px 18px -10px color-mix(in oklab, var(--color-foreground) 22%, transparent);
  /* Pin the composer at the bottom of its flex column. Without an explicit
     flex-shrink: 0 here, a long textarea (autoresize) or a tall hint row
     can push the composer into the scroll area's flex budget, which leaks
     extra blank space below the visible chat. */
  flex-shrink: 0;
}
.ct-composer-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.ct-composer-glyph {
  color: var(--color-primary);
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
  color: var(--color-foreground);
  border: none;
  outline: none;
  resize: none;
  caret-color: var(--color-primary);
}
.ct-textarea::placeholder {
  color: var(--color-muted-foreground);
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
  color: var(--color-muted-foreground);
  letter-spacing: 0.04em;
}
.ct-hint kbd {
  font-family: var(--font-mono);
  background: color-mix(in oklab, var(--color-foreground) 6%, var(--color-background));
  border: 1px solid var(--color-border);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 9px;
  color: var(--color-foreground);
}
.ct-send {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  background: transparent;
  color: var(--color-primary);
  border: none;
  padding: 4px 8px;
  cursor: pointer;
  letter-spacing: 0.04em;
  font-weight: 500;
}
.ct-send:disabled {
  color: var(--color-muted-foreground);
  cursor: not-allowed;
}
.ct-send:not(:disabled):hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.ct-attachment-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 6px;
}
.ct-attachment-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: color-mix(in oklab, var(--color-foreground) 4%, var(--color-background));
  font-size: 11px;
  color: var(--color-muted-foreground);
  max-width: 220px;
}
.ct-attachment-chip[data-pending="true"] { opacity: 0.65; }
.ct-attachment-thumb {
  width: 40px;
  height: 40px;
  object-fit: cover;
  border-radius: 3px;
  background: var(--color-muted);
}
.ct-attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}
.ct-attachment-remove {
  appearance: none;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--color-muted-foreground);
  padding: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ct-attachment-remove:hover { color: var(--color-foreground); }
.ct-user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}
.ct-user-attachments img {
  max-width: 220px;
  max-height: 200px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  object-fit: cover;
  cursor: zoom-in;
}
.ct-drop-overlay {
  position: absolute;
  inset: 0;
  background: color-mix(in oklab, var(--color-foreground) 4%, transparent);
  border: 2px dashed var(--color-primary);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--color-foreground);
  pointer-events: none;
}
.ct-icon-button {
  appearance: none;
  border: 1px solid transparent;
  background: transparent;
  border-radius: 6px;
  padding: 6px;
  cursor: pointer;
  color: var(--color-muted-foreground);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.ct-icon-button:hover {
  background: color-mix(in oklab, var(--color-foreground) 6%, var(--color-background));
  color: var(--color-foreground);
}
.ct-icon-button:disabled { opacity: 0.5; cursor: default; }
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = INJECTED_CSS;
  document.head.appendChild(el);
}

/** Tool-call args above this character count collapse behind a <details>
 *  toggle. Short calls render inline (the old behavior) so simple
 *  `{"key":"foo"}`-style args stay scannable; large patches (e.g. an
 *  update_manifest_fields call with multi-paragraph systemPrompt strings)
 *  no longer fill the entire chat panel. */
const TOOL_ARGS_INLINE_LIMIT = 160;

function DefaultToolCallCard({ call }: { call: ChatToolCall }) {
  const argsView = (() => {
    try {
      const compact = JSON.stringify(call.args);
      const trimmed = compact.startsWith('{') && compact.endsWith('}')
        ? compact.slice(1, -1)
        : compact;
      if (trimmed.length <= TOOL_ARGS_INLINE_LIMIT) {
        return { mode: 'inline' as const, summary: trimmed };
      }
      return {
        mode: 'truncated' as const,
        summary: trimmed.slice(0, TOOL_ARGS_INLINE_LIMIT) + '…',
        full: JSON.stringify(call.args, null, 2),
        extraChars: trimmed.length - TOOL_ARGS_INLINE_LIMIT,
      };
    } catch {
      return { mode: 'inline' as const, summary: '…' };
    }
  })();
  return (
    <div className="ct-tool" data-flash={call.status !== 'running'}>
      <span className="ct-tool-name">⟢ {call.name}</span>
      {argsView.mode === 'truncated' ? (
        <details className="ct-tool-args">
          <summary className="ct-tool-args-summary">
            {argsView.summary || '·'}
            <span className="ct-tool-args-expand"> +{argsView.extraChars.toLocaleString()} chars</span>
          </summary>
          <pre className="ct-tool-args-full">{argsView.full}</pre>
        </details>
      ) : (
        <span className="ct-tool-args">{argsView.summary || '·'}</span>
      )}
      <span className="ct-tool-status" data-status={call.status}>
        {call.status === 'running' ? '· · ·' : call.status === 'ok' ? 'ok' : 'err'}
      </span>
      {call.status === 'error' && call.error && (
        <span className="ct-tool-error">{call.error}</span>
      )}
    </div>
  );
}

interface PendingAttachment {
  key: string;
  filename: string;
  mimeType: string;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  remote?: ChatAttachment;
  error?: string;
}

function isImageFile(file: { type: string }): boolean {
  return /^image\//i.test(file.type);
}

function UserAttachmentPreview({ attachment }: { attachment: ChatAttachment }) {
  if (attachment.mimeType.startsWith('image/')) {
    return (
      <a href={attachment.url} target="_blank" rel="noreferrer">
        <img src={attachment.url} alt={attachment.filename} loading="lazy" />
      </a>
    );
  }
  return (
    <a href={attachment.url} target="_blank" rel="noreferrer" className="ct-attachment-chip">
      <Paperclip size={12} />
      <span className="ct-attachment-name">{attachment.filename}</span>
    </a>
  );
}

export function ChatThread(props: ChatThreadProps) {
  const {
    endpoint, chatId, fetchHistory, onChatCreated, extraBody,
    renderToolCall, renderAssistantText, placeholder, composerExtras, header,
    onToolResult, onError, onActivityChange, className, uploadAttachment,
    defaultInput, autoSendDefaultInput,
    initialMessages, onMessagesChange,
  } = props;
  const stream = useChatThreadStream({ endpoint, extraBody, initialMessages });
  const [input, setInput] = useState(defaultInput ?? '');
  // When initialMessages is provided, the hook seeds messages synchronously
  // (via lazy useState init) so the empty-state flash never appears. Mark
  // loadedHistory true up-front; fetchHistory (if also provided) still runs
  // below to refresh in the background.
  const [loadedHistory, setLoadedHistory] = useState(
    Boolean(initialMessages && initialMessages.length > 0),
  );

  // Subscribe parents to message changes for caching. Fires on initial
  // seed and every streaming chunk — debounce in the parent if needed.
  useEffect(() => {
    onMessagesChange?.(stream.messages);
  }, [stream.messages, onMessagesChange]);

  // Notify the host whenever streaming starts/stops so it can keep the
  // enclosing tab mounted while a turn is in flight. The cleanup fires an
  // explicit `false` so an unmount doesn't leave the tab marked busy.
  useEffect(() => {
    onActivityChange?.(stream.inFlight);
    return () => { onActivityChange?.(false); };
  }, [stream.inFlight, onActivityChange]);

  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingRef = useRef<PendingAttachment[]>([]);
  pendingRef.current = pending;
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => { ensureStyles(); }, []);

  // Initial history load. When the parent provided `initialMessages`
  // (cache hit), render them immediately, then refresh from the authoritative
  // history source. This keeps switch-back snappy without letting a stale
  // cache snapshot become the only render path for a remounted chat.
  useEffect(() => {
    let cancelled = false;
    if (!chatId || !fetchHistory) { setLoadedHistory(true); return; }
    if (initialMessages && initialMessages.length > 0) setLoadedHistory(true);
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
    // Scroll the chat container directly to its bottom instead of
    // bottomRef.scrollIntoView. scrollIntoView walks every ancestor
    // scrollable container — including document.scrollingElement when the
    // host page has accidentally grown taller than the viewport — and
    // smooth-scrolls the entire page, leaving a strip of blank space at
    // the bottom that the user reads as a layout bug. Targeting
    // scrollRef directly keeps the side-effect scoped to .ct-scroll.
    if (!stream.inFlight) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
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

  // One-shot auto-send: fires when history has loaded, defaultInput is present,
  // and autoSendDefaultInput is true. The ref guards against double-fire on
  // re-renders. Matches the bare-route → /c/:id handoff pattern.
  const hasAutoSentRef = useRef(false);
  useEffect(() => {
    if (hasAutoSentRef.current) return;
    if (!autoSendDefaultInput) return;
    if (!defaultInput) return;
    if (!loadedHistory) return;
    hasAutoSentRef.current = true;
    setInput('');
    void stream.send(defaultInput, { chatId });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSendDefaultInput, defaultInput, loadedHistory]);

  const startUpload = useCallback((files: File[]) => {
    if (!uploadAttachment) return;
    for (const file of files) {
      if (!isImageFile(file)) continue;
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = URL.createObjectURL(file);
      setPending((cur) => [
        ...cur,
        { key, filename: file.name || 'screenshot.png', mimeType: file.type, previewUrl, status: 'uploading' },
      ]);
      (async () => {
        try {
          const remote = await uploadAttachment(file);
          setPending((cur) => cur.map((it) =>
            it.key === key ? { ...it, status: 'ready', remote } : it,
          ));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setPending((cur) => cur.map((it) =>
            it.key === key ? { ...it, status: 'error', error: message } : it,
          ));
        }
      })();
    }
  }, [uploadAttachment]);

  // Revoke object URLs when the component unmounts so we don't leak memory
  // for unsent pasted screenshots.
  useEffect(() => {
    return () => {
      for (const it of pendingRef.current) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);

  const removePending = useCallback((key: string) => {
    setPending((cur) => {
      const target = cur.find((it) => it.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return cur.filter((it) => it.key !== key);
    });
  }, []);

  const onPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!uploadAttachment) return;
    const items = Array.from(e.clipboardData?.items ?? []);
    const files: File[] = [];
    for (const it of items) {
      if (it.kind !== 'file') continue;
      const f = it.getAsFile();
      if (f && isImageFile(f)) files.push(f);
    }
    if (files.length > 0) {
      e.preventDefault();
      startUpload(files);
    }
  }, [uploadAttachment, startUpload]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!uploadAttachment) return;
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(isImageFile);
    if (files.length > 0) startUpload(files);
  }, [uploadAttachment, startUpload]);

  const onDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!uploadAttachment) return;
    const hasFiles = Array.from(e.dataTransfer.types).includes('Files');
    if (!hasFiles) return;
    e.preventDefault();
    setDragOver(true);
  }, [uploadAttachment]);

  const onDragLeave = useCallback(() => setDragOver(false), []);

  async function handleSend() {
    const text = input.trim();
    const readyAttachments = pending
      .filter((p) => p.status === 'ready' && p.remote)
      .map((p) => p.remote as ChatAttachment);
    const hasUploading = pending.some((p) => p.status === 'uploading');
    if (hasUploading) return;
    if (!text && readyAttachments.length === 0) return;
    for (const it of pending) URL.revokeObjectURL(it.previewUrl);
    setPending([]);
    setInput('');
    await stream.send(text, { chatId, attachments: readyAttachments });
  }

  const rootClass = className ? `ct-root ${className}` : 'ct-root';

  return (
    <div className={rootClass}>
      {header && <div className="ct-header">{header}</div>}

      <div className="ct-scroll" ref={scrollRef}>
        {!loadedHistory && (
          <div className="ct-empty">· loading ·</div>
        )}
        {/* No empty-state copy on purpose — the composer placeholder is
            instruction enough. Earlier we shipped a "start a conversation"
            block here; removed because every consumer (SuzieCode build
            chat, starter assistant pages) needed its own copy and the
            generic version was unwelcome noise. */}

        {stream.messages.map((m, i) => (
          <div
            key={m.id}
            className="ct-turn"
            style={{ animationDelay: `${Math.min(i, 6) * 18}ms` }}
          >
            {m.role === 'user' ? (
              <div className="ct-user">
                <div className="ct-user-body">
                  {m.content && <span>{m.content}</span>}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="ct-user-attachments">
                      {m.attachments.map((att) => (
                        <UserAttachmentPreview key={att.id} attachment={att} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="ct-assistant">
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

      <div
        className="ct-composer"
        style={{ position: 'relative' }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dragOver && uploadAttachment && (
          <div className="ct-drop-overlay">drop image to attach</div>
        )}
        {pending.length > 0 && (
          <div className="ct-attachment-strip">
            {pending.map((p) => (
              <div
                key={p.key}
                className="ct-attachment-chip"
                data-pending={p.status === 'uploading' ? 'true' : 'false'}
                title={p.status === 'error' ? `Upload failed: ${p.error ?? ''}` : p.filename}
              >
                <img className="ct-attachment-thumb" src={p.previewUrl} alt={p.filename} />
                <span className="ct-attachment-name">{p.filename}</span>
                {p.status === 'uploading' && <Loader2 size={12} className="animate-spin" />}
                <button
                  type="button"
                  className="ct-attachment-remove"
                  onClick={() => removePending(p.key)}
                  aria-label={`Remove ${p.filename}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="ct-composer-row">
          {uploadAttachment ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) startUpload(files);
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="ct-icon-button"
                onClick={() => fileInputRef.current?.click()}
                aria-label="Attach image"
                disabled={stream.inFlight}
              >
                <Paperclip size={16} />
              </button>
            </>
          ) : (
            <span aria-hidden className="ct-composer-glyph">▸</span>
          )}
          <textarea
            ref={textareaRef}
            className="ct-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={onPaste}
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
            {uploadAttachment && <> <kbd>paste</kbd> image</>}
          </span>
          <span style={{ flex: 1 }} />
          {composerExtras}
          <button
            className="ct-send"
            disabled={
              stream.inFlight
              || pending.some((p) => p.status === 'uploading')
              || (!input.trim() && pending.filter((p) => p.status === 'ready').length === 0)
            }
            onClick={() => { void handleSend(); }}
          >
            {stream.inFlight ? '· · · sending' : '↳ send'}
          </button>
        </div>
      </div>
    </div>
  );
}
