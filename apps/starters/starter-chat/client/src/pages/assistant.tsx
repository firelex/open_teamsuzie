import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArtifactPanel,
  Button,
  MarkdownMessage,
  PromptCard,
  PromptCardDescription,
  PromptCardTitle,
  ToolUseStatus,
  cn,
  humanSize,
  type ArtifactSnapshot,
  type ToolEvent,
} from '@teamsuzie/ui';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: ToolEvent[];
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

interface PromptIdea {
  title: string;
  subtitle: string;
  prompt: string;
}

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

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl bg-foreground px-4 py-2.5 text-[15px] leading-relaxed text-background">
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">
        {agentName}
      </div>
      {showTyping ? (
        <div className="text-[15px] leading-relaxed">
          <TypingDots />
        </div>
      ) : (
        message.content.length > 0 && <MarkdownMessage content={message.content} />
      )}
      {/* Live tool-use indicator: appears below the message content while the
          turn is still streaming, disappears once the agent yields 'done'.
          Past messages don't show tool history — keeps the transcript clean. */}
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
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        {salutation}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        How can {name} help today?
      </p>
      <div className="mt-10 grid gap-3 sm:grid-cols-2">
        {prompts.map((card) => (
          <PromptCard key={card.title} onClick={() => onSelect(card.prompt)}>
            <PromptCardTitle>{card.title}</PromptCardTitle>
            <PromptCardDescription>{card.subtitle}</PromptCardDescription>
          </PromptCard>
        ))}
      </div>
    </div>
  );
}

export interface AssistantPageProps {
  agentName: string;
}

export function AssistantPage({ agentName }: AssistantPageProps) {
  const sessionId = useMemo(() => crypto.randomUUID(), []);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending'>('idle');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactSnapshot | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const prevStatus = useRef<'idle' | 'sending'>('idle');

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // After the agent finishes streaming (status: sending → idle), put focus
  // back on the textarea so the user can keep typing without reaching for
  // the mouse. useEffect (vs. inline setTimeout) ensures the focus call runs
  // *after* React has re-rendered the textarea with disabled={false}.
  useEffect(() => {
    if (prevStatus.current === 'sending' && status === 'idle') {
      textareaRef.current?.focus();
    }
    prevStatus.current = status;
  }, [status]);

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

  async function sendMessage(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || status === 'sending') {
      return;
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
    setInput('');
    setAttachments([]);
    setStatus('sending');
    setError('');

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: text,
          history: nextHistory.slice(0, -1),
          attachmentIds: sentAttachmentIds,
        }),
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
      setError(err instanceof Error ? err.message : 'Chat failed');
    } finally {
      setStatus('idle');
    }
  }

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
  }

  const isStreaming = status === 'sending';
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-14 items-center justify-between border-b border-border px-5">
        <div className="text-sm font-medium text-foreground">{agentName}</div>
        {messages.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => void newChat()}>
            New chat
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isEmpty ? (
          <Greeting
            name={agentName}
            prompts={PROMPTS}
            onSelect={(prompt) => void sendMessage(prompt)}
          />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-8">
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
          <div className="rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-foreground/30 focus-within:shadow-md">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 border-b border-border px-3 pb-2 pt-2.5">
                {attachments.map((att) => (
                  <span
                    key={att.id}
                    className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-[11px] text-foreground"
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
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Message ${agentName}`}
              disabled={isStreaming}
              className="block w-full min-h-16 resize-none border-0 bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
            />
            <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || isStreaming}
                  className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                  aria-label="Attach files"
                >
                  <PaperclipIcon />
                  <span className="text-xs">{uploading ? 'Uploading…' : 'Files'}</span>
                </Button>
                <p className="hidden text-xs text-muted-foreground sm:inline">
                  Enter sends · Shift+Enter newline
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => void sendMessage()}
                disabled={(!input.trim() && attachments.length === 0) || isStreaming}
                className="h-8 rounded-full px-4"
              >
                {isStreaming ? <TypingDots /> : 'Send'}
              </Button>
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
    </div>
  );
}
