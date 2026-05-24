import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArtifactPanel,
  Button,
  MarkdownMessage,
  Square,
  ToolUseStatus,
  WorkflowPickerDialog,
  humanSize,
  useChatComposer,
  useSelectedModel,
  type ArtifactSnapshot,
  type ToolEvent,
  type Workflow,
} from '@teamsuzie/ui';
import type { Chat, ChatMessage as PersistedChatMessage } from '@teamsuzie/chats';
import type { ManifestPrompt } from '../manifest/schema.js';

const SELECTED_MODEL_KEY = 'starter-chat:selected-model';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
}

/**
 * Hydrate persisted chat messages into the same shape this page renders.
 * Past tool events are preserved on the assistant message but only the
 * currently-streaming turn shows the live status indicator.
 */
function hydratePersisted(messages: PersistedChatMessage[]): Message[] {
  return messages.map((m) => {
    const base: Message = {
      id: m.id,
      role: m.role,
      content: m.content,
    };
    if (m.toolEvents) {
      try {
        base.toolEvents = JSON.parse(m.toolEvents) as ToolEvent[];
      } catch {
        // ignore corrupt tool_events
      }
    }
    return base;
  });
}

interface Attachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
}

// (humanSize, safeFilename, and ArtifactPanel now live in @teamsuzie/ui.)


function PaperclipIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 17.93 8.83l-8.57 8.57a2 2 0 1 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
      aria-hidden="true"
    >
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" />
      <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" />
    </svg>
  );
}

/**
 * Internal prompt shape mirrors {@link ManifestPrompt} from the manifest
 * schema so callers can pass manifest prompts directly to the greeting tiles.
 */
type PromptIdea = ManifestPrompt;

const PROMPTS: PromptIdea[] = [
  {
    title: 'Explain this starter',
    subtitle: 'Summarize what this app does and how streaming works.',
    prompt: 'Explain what this starter chat app does and how streaming flows end to end.',
  },
  {
    title: 'Draft a system prompt',
    subtitle: 'Write a system prompt for a research assistant.',
    prompt: 'Draft a clear system prompt for a focused research assistant.',
  },
  {
    title: 'Walk me through SSE',
    subtitle: 'How server-sent events carry chat chunks.',
    prompt: 'Walk me through how SSE carries chat chunks from server to client.',
  },
  {
    title: 'Ways to extend',
    subtitle: 'Suggest the next features for a real app.',
    prompt: 'Suggest the next features I should add to turn this starter into a real app.',
  },
];

function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Working late';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}


function TypingDots() {
  return (
    <span
      className="inline-flex items-center gap-1 text-muted-foreground"
      role="status"
      aria-label="Assistant is typing"
    >
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  );
}


function MessageItem({
  message,
  agentName,
  isActive,
}: {
  message: Message;
  agentName: string;
  /** True only for the message currently being streamed. */
  isActive: boolean;
}) {
  const isUser = message.role === 'user';
  const hasToolEvents = !!message.toolEvents && message.toolEvents.length > 0;
  const showTyping =
    !isUser && isActive && message.content.length === 0 && !hasToolEvents;

  const roleLabel = isUser ? 'You' : agentName;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">{roleLabel}</span>
      {isUser ? (
        <div className="whitespace-pre-wrap text-[15px] leading-[1.55] text-foreground">
          {message.content}
        </div>
      ) : showTyping ? (
        <div className="text-[15px] leading-relaxed text-muted-foreground">
          <TypingDots />
        </div>
      ) : message.content.length > 0 ? (
        <div className="text-[15px] leading-[1.6] text-foreground">
          <MarkdownMessage content={message.content} />
        </div>
      ) : null}
      {isActive && hasToolEvents && <ToolUseStatus events={message.toolEvents!} />}
    </div>
  );
}

function Greeting({
  name,
  prompts,
  onSelect,
}: {
  name: string;
  prompts: PromptIdea[];
  onSelect: (prompt: string) => void;
}) {
  const salutation = useMemo(() => greetingFor(new Date()), []);
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-6 py-16">
      <h1 className="display-hero stagger-in stagger-in-1 text-[clamp(38px,5vw,64px)] text-foreground">
        {salutation}
      </h1>
      <p className="stagger-in stagger-in-2 mt-3 text-[15px] leading-[1.55] text-muted-foreground">
        How can {name} help today?
      </p>
      <div className="stagger-in stagger-in-3 mt-10 grid gap-3 sm:grid-cols-2">
        {prompts.map((card) => (
          <button
            key={card.title}
            type="button"
            onClick={() => onSelect(card.prompt ?? card.title)}
            className="group rounded-[2px] border border-border bg-card p-5 text-left transition-colors hover:border-foreground/40 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-saffron-400"
          >
            <h3 className="text-[15px] font-semibold leading-[1.3] tracking-[-0.005em] text-foreground">
              {card.title}
            </h3>
            <p className="mt-1.5 text-[13.5px] leading-[1.5] text-muted-foreground">
              {card.subtitle}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

export interface AssistantPageProps {
  agentName: string;
  /** When set, the page is bound to a persisted top-level Assistant chat. */
  chatId?: string;
  /** Optional starter prompts shown as tiles on the greeting page. Falls back to generic defaults. */
  prompts?: ManifestPrompt[];
}

export function AssistantPage({ agentName, chatId, prompts }: AssistantPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  // Stable per-render-tab session id used for paperclip uploads. When chatId
  // is present we reuse it as the upload bucket key so paperclips persist
  // alongside the chat — same pattern as matter chats.
  const [tabSessionId] = useState(() => crypto.randomUUID());
  const sessionId = chatId ?? tabSessionId;
  const [historyLoaded, setHistoryLoaded] = useState(!chatId);
  const [chatName, setChatName] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [workflowOpen, setWorkflowOpen] = useState(false);
  /** Currently active workflow — set when the user picks one from the
   *  composer's Workflow button OR clicks a Library card. Cleared after
   *  the chip is dismissed; we don't (yet) forward the id to the server. */
  const [activeWorkflow, setActiveWorkflow] = useState<{ id: string; name: string } | null>(null);
  // Reads the model selection persisted by the Settings page (if any).
  // Server falls back to its configured default when undefined.
  const [selectedModel] = useSelectedModel(SELECTED_MODEL_KEY);

  // The Library page hands off a workflow via sessionStorage on navigate;
  // pick it up exactly once on mount and prefill the composer.
  useEffect(() => {
    const raw = sessionStorage.getItem('counsel:pending-workflow');
    if (!raw) return;
    sessionStorage.removeItem('counsel:pending-workflow');
    try {
      const parsed = JSON.parse(raw) as { id: string; name: string; prompt: string };
      if (parsed?.prompt) {
        setInput(parsed.prompt);
        setActiveWorkflow({ id: parsed.id, name: parsed.name });
      }
    } catch { /* ignore */ }
  }, []);

  // Library prompt tiles also hand off via sessionStorage; pick up once on
  // mount and prefill the composer. Prompts (unlike workflows) don't have an
  // id we need to track, so we just drop the body into the input.
  useEffect(() => {
    const raw = sessionStorage.getItem('counsel:pending-prompt');
    if (!raw) return;
    sessionStorage.removeItem('counsel:pending-prompt');
    try {
      const parsed = JSON.parse(raw) as { name?: string; prompt?: string };
      if (parsed?.prompt) setInput(parsed.prompt);
    } catch { /* ignore */ }
  }, []);

  function handleWorkflowPicked(w: Workflow) {
    setInput(w.prompt);
    setActiveWorkflow({ id: w.id, name: w.name });
  }
  const [activeArtifact, setActiveArtifact] = useState<ArtifactSnapshot | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  // Set while a /api/chat fetch is in flight so the user can stop it. The
  // server's res.on('close') handler aborts the upstream LLM call when the
  // socket goes away, so a fetch abort here propagates all the way through.
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load persisted history when bound to a chatId.
  useEffect(() => {
    if (!chatId) {
      setHistoryLoaded(true);
      setMessages([]);
      setChatName(null);
      setAttachments([]);
      setActiveArtifact(null);
      setError('');
      return;
    }
    let cancelled = false;
    setHistoryLoaded(false);
    setMessages([]);
    setError('');
    void (async () => {
      try {
        const [chatRes, msgRes] = await Promise.all([
          fetch(`/api/chats/${encodeURIComponent(chatId)}`),
          fetch(`/api/chats/${encodeURIComponent(chatId)}/messages`),
        ]);
        if (cancelled) return;
        if (!chatRes.ok) throw new Error(`Failed to load chat (${chatRes.status})`);
        const chatData = (await chatRes.json()) as { item: Chat };
        setChatName(chatData.item.name);
        if (msgRes.ok) {
          const msgData = (await msgRes.json()) as { items: PersistedChatMessage[] };
          setMessages(hydratePersisted(msgData.items));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load chat');
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // After a fresh navigate from `/` to `/c/:newChatId`, dispatch the message
  // we deferred from the bare-route send.
  useEffect(() => {
    const state = location.state as { pendingMessage?: string } | null;
    if (!chatId || !historyLoaded || !state?.pendingMessage) return;
    if (messages.length > 0) return;
    const pending = state.pendingMessage;
    navigate(location.pathname, { replace: true, state: null });
    void sendMessage(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, historyLoaded]);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append('sessionId', sessionId);
        form.append('file', file);
        const response = await fetch('/api/files', { method: 'POST', body: form });
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `Upload failed (${response.status})`);
        }
        const data = (await response.json()) as { item: Attachment };
        setAttachments((current) => [...current, data.item]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((a) => a.id !== id));
    void fetch(`/api/files/${encodeURIComponent(sessionId)}/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }

  async function sendMessage(textArg: string) {
    const text = textArg.trim();
    if (!text) {
      return;
    }

    // Bare-route first send: create a chat row and navigate to /c/:newId.
    // The route mount picks up `pendingMessage` and re-enters this function
    // with chatId set.
    if (!chatId) {
      try {
        setStatus('sending');
        const response = await fetch('/api/chats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          throw new Error(`Failed to start chat (${response.status})`);
        }
        const data = (await response.json()) as { item: Chat };
        setStatus('idle');
        navigate(`/c/${encodeURIComponent(data.item.id)}`, {
          state: { pendingMessage: text },
        });
        return;
      } catch (err) {
        setStatus('idle');
        setError(err instanceof Error ? err.message : 'Failed to start chat');
        return;
      }
    }

    const nextUserMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
    };

    const nextHistory = [...messages, nextUserMessage].map(({ role, content }) => ({
      role,
      content,
    }));
    const assistantId = crypto.randomUUID();

    const sentAttachmentIds = attachments.map((a) => a.id);

    setMessages((current) => [
      ...current,
      nextUserMessage,
      { id: assistantId, role: 'assistant', content: '' },
    ]);
    setAttachments([]);
    setStatus('sending');
    setError('');

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          chatId,
          message: text,
          history: nextHistory.slice(0, -1),
          attachmentIds: sentAttachmentIds,
          model: selectedModel,
        }),
        signal: ac.signal,
      });

      if (!response.body) {
        throw new Error('No response body from starter chat backend');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamFinished = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          const line = event
            .split('\n')
            .find((candidate) => candidate.startsWith('data: '));

          if (!line) {
            continue;
          }

          const payload = JSON.parse(line.slice(6)) as
            | { type: 'chunk'; text: string }
            | { type: 'tool_call'; id: string; name: string; args: unknown }
            | { type: 'tool_result'; id: string; name: string; result: unknown }
            | { type: 'tool_error'; id: string; name: string; error: string }
            | { type: 'done' }
            | { type: 'error'; message: string };

          if (payload.type === 'chunk') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + payload.text }
                  : message,
              ),
            );
          } else if (payload.type === 'tool_call') {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                const events = message.toolEvents ?? [];
                return {
                  ...message,
                  toolEvents: [
                    ...events,
                    {
                      id: payload.id,
                      name: payload.name,
                      args: payload.args,
                      status: 'running' as const,
                    },
                  ],
                };
              }),
            );
          } else if (payload.type === 'tool_result') {
            // Some tools (drafting + conversion) embed a `_doc_state` snapshot
            // in their result so the client can render a live read-only
            // artifact panel without polling. If present, surface it.
            if (payload.result && typeof payload.result === 'object') {
              const result = payload.result as {
                _doc_state?: unknown;
                download_url?: unknown;
                filename?: unknown;
              };
              const ds = result._doc_state;
              if (ds && typeof ds === 'object') {
                const obj = ds as { doc_id?: string; title?: string; markdown?: string };
                if (typeof obj.doc_id === 'string' && typeof obj.markdown === 'string') {
                  // Pull through the download_url if export_to_docx supplied
                  // one; otherwise carry over what we already have for this doc.
                  const docxUrl = typeof result.download_url === 'string'
                    ? result.download_url
                    : undefined;
                  const docxName = typeof result.filename === 'string'
                    ? result.filename
                    : undefined;
                  setActiveArtifact((prev) => {
                    const carry = prev && prev.docId === obj.doc_id ? prev : null;
                    return {
                      docId: obj.doc_id!,
                      title: typeof obj.title === 'string' ? obj.title : 'Document',
                      markdown: obj.markdown!,
                      docxDownloadUrl: docxUrl ?? carry?.docxDownloadUrl,
                      docxFilename: docxName ?? carry?.docxFilename,
                    };
                  });
                }
              }
            }
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                const events = (message.toolEvents ?? []).map((event) =>
                  event.id === payload.id
                    ? { ...event, result: payload.result, status: 'done' as const }
                    : event,
                );
                return { ...message, toolEvents: events };
              }),
            );
          } else if (payload.type === 'tool_error') {
            setMessages((current) =>
              current.map((message) => {
                if (message.id !== assistantId) return message;
                const events = (message.toolEvents ?? []).map((event) =>
                  event.id === payload.id
                    ? { ...event, error: payload.error, status: 'error' as const }
                    : event,
                );
                return { ...message, toolEvents: events };
              }),
            );
          } else if (payload.type === 'error') {
            setError(payload.message);
          } else if (payload.type === 'done') {
            // The server sends 'done' as the last SSE event before res.end().
            // Some proxies (Vite dev, etc.) buffer the connection-close, so
            // relying on reader.read() returning done:true is unreliable.
            // Re-enable the composer eagerly here, then break out of the read
            // loop. Don't await reader.cancel() — that can also hang on a
            // buffered proxy. (Auto-focus is handled by a useEffect that
            // watches the sending → idle transition.)
            setStatus('idle');
            streamFinished = true;
          }
        }
        if (streamFinished) {
          reader.cancel().catch(() => undefined);
          break;
        }
      }
    } catch (err) {
      // User-initiated stop: signal aborted via stopStreaming(). The partial
      // assistant text is already in `messages` from the chunks that arrived
      // before the abort, so just bail without surfacing an error.
      if (err instanceof DOMException && err.name === 'AbortError') {
        // intentional no-op
      } else {
        setError(err instanceof Error ? err.message : 'Chat failed');
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      setStatus('idle');
    }

    // Pick up any auto-titled name set on the server.
    if (chatId) {
      try {
        const r = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
        if (r.ok) {
          const d = (await r.json()) as { item: Chat };
          setChatName(d.item.name);
        }
      } catch {
        // best-effort
      }
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  const isStreaming = status === 'sending';
  const { handleKeyDown, handleSubmit, handleStop, canSend } = useChatComposer({
    isStreaming,
    onSend: (text) => {
      void sendMessage(text);
    },
    onStop: stopStreaming,
    text: input,
    setText: setInput,
  });

  async function newChat() {
    await fetch('/api/session/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    }).catch(() => undefined);

    setMessages([]);
    setInput('');
    setAttachments([]);
    setActiveArtifact(null);
    setError('');
    if (chatId) navigate('/');
  }

  const isEmpty = messages.length === 0;
  const showGreeting = isEmpty && historyLoaded && !chatId;
  const showLoading = !!chatId && !historyLoaded;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 items-center justify-between border-b border-border px-6">
        <div className="flex items-center gap-2.5">
          <span className="inline-block size-1.5 rounded-full bg-saffron-400" aria-hidden />
          <span className="label-mono text-foreground">{agentName}</span>
        </div>
        {(messages.length > 0 || chatId) && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void newChat()}
            className="h-7 rounded-[2px] border-foreground/30 bg-transparent px-3 font-sans text-[11.5px] font-semibold uppercase tracking-[0.10em] text-foreground hover:border-saffron-400 hover:text-foreground"
          >
            New chat
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showLoading ? (
          <div className="mx-auto flex h-full max-w-3xl items-center justify-center px-6 py-16 text-sm text-muted-foreground">
            Loading chat…
          </div>
        ) : showGreeting ? (
          <Greeting
            name={agentName}
            prompts={(() => {
              const featured = (prompts ?? []).filter((p) => p.featured);
              return featured.length > 0 ? featured.slice(0, 4) : PROMPTS;
            })()}
            onSelect={(prompt) => void sendMessage(prompt)}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
            {chatName && (
              <div className="border-b border-border pb-3 text-xs text-muted-foreground">
                {chatName}
              </div>
            )}
            {messages.map((message, idx) => (
              <MessageItem
                key={message.id}
                message={message}
                agentName={agentName}
                // Only the last message is "active" (currently streaming).
                isActive={isStreaming && idx === messages.length - 1}
              />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      <div className="border-t border-border bg-background px-5 py-4">
        <div className="mx-auto w-full max-w-3xl">
          {error && <p className="mb-2 text-xs text-destructive">{error}</p>}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files && files.length > 0) void uploadFiles(files);
              event.target.value = '';
            }}
          />
          <div className="rounded-[2px] border border-border bg-card transition-colors focus-within:border-foreground/50">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-3 pb-2 pt-2.5">
                {attachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1.5 rounded-[2px] bg-muted px-2 py-1 text-[11px] text-foreground"
                    title={`${att.mimeType} · ${humanSize(att.size)}`}
                  >
                    <span className="max-w-[180px] truncate font-medium">{att.name}</span>
                    <span className="text-muted-foreground">{humanSize(att.size)}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(att.id)}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Remove ${att.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Raw <textarea> on purpose — using @teamsuzie/ui's <Textarea>
                here drags in a default border + bg-background that conflict
                with the outer card and don't reliably get stripped by twMerge. */}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${agentName}`}
              className="block w-full min-h-20 resize-none border-0 bg-transparent px-4 pt-3.5 font-sans text-[14.5px] leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center justify-between border-t border-border/70 px-3 pb-2.5 pt-2">
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Attach files"
                >
                  <PaperclipIcon />
                  <span>{uploading ? 'Uploading…' : 'Files'}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setWorkflowOpen(true)}
                  className="h-7 gap-1.5 rounded-[2px] px-2 font-sans text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Pick a workflow"
                >
                  <SparkleIcon />
                  <span>Workflow</span>
                </Button>
                <p className="hidden font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">
                  Enter sends · ⇧↵ newline
                </p>
              </div>
              {isStreaming ? (
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={handleStop}
                  className="h-7 rounded-[2px] border-destructive px-4 font-sans text-[11.5px] font-semibold uppercase tracking-[0.06em] text-destructive hover:bg-destructive/10"
                  aria-label="Stop streaming"
                >
                  <Square className="size-3 fill-current" aria-hidden />
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => handleSubmit()}
                  disabled={!canSend && attachments.length === 0}
                  className="h-7 rounded-[2px] bg-foreground px-4 font-sans text-[11.5px] font-semibold uppercase tracking-[0.06em] text-background hover:bg-foreground/90 disabled:opacity-50"
                >
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
      </div>
      {activeArtifact && (
        <ArtifactPanel
          artifact={activeArtifact}
          onClose={() => setActiveArtifact(null)}
        />
      )}
      <WorkflowPickerDialog
        open={workflowOpen}
        onOpenChange={setWorkflowOpen}
        onSelect={handleWorkflowPicked}
      />
    </div>
  );
}
