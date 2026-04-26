import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Button,
  PromptCard,
  PromptCardDescription,
  PromptCardTitle,
  Textarea,
  cn,
} from '@teamsuzie/ui';

interface ToolEvent {
  id: string;
  name: string;
  args?: unknown;
  result?: unknown;
  error?: string;
  status: 'running' | 'done' | 'error';
}

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

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="[&:not(:first-child)]:mt-3">{children}</p>,
          h1: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="mt-4 text-base font-semibold tracking-tight">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-4 text-[15px] font-semibold tracking-tight">{children}</h4>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 text-sm font-semibold tracking-tight">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary underline underline-offset-2 hover:text-primary/80"
            >
              {children}
            </a>
          ),
          code: ({ className, children, ...rest }) => {
            const isBlock = (className ?? '').includes('language-');
            if (isBlock) {
              return (
                <code className={cn('font-mono text-[13px]', className)} {...rest}>
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[13px] text-foreground"
                {...rest}
              >
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted p-3 text-[13px] leading-relaxed">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-3 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-border" />,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border px-3 py-1.5 text-left font-medium">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-border px-3 py-1.5 align-top">{children}</td>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
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

function ToolCallCard({ event }: { event: ToolEvent }) {
  const [open, setOpen] = useState(false);
  const statusLabel = {
    running: 'Running…',
    done: 'Completed',
    error: 'Failed',
  }[event.status];
  const statusColor = {
    running: 'text-muted-foreground',
    done: 'text-emerald-600 dark:text-emerald-500',
    error: 'text-destructive',
  }[event.status];

  return (
    <div className="my-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2 font-mono text-foreground">
          <span aria-hidden="true">⚙︎</span>
          <span className="font-medium">{event.name}</span>
        </span>
        <span className={cn('text-xs font-medium', statusColor)}>{statusLabel}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 border-t border-border pt-2 text-xs">
          {event.args !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Arguments
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(event.args, null, 2)}
              </pre>
            </div>
          )}
          {event.result !== undefined && (
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                Result
              </div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {JSON.stringify(event.result, null, 2)}
              </pre>
            </div>
          )}
          {event.error && (
            <div className="text-destructive">
              <div className="mb-1 text-[11px] uppercase tracking-wider">Error</div>
              <pre className="overflow-x-auto rounded bg-background p-2 font-mono text-[11px]">
                {event.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageItem({
  message,
  agentName,
  isStreaming,
}: {
  message: Message;
  agentName: string;
  isStreaming: boolean;
}) {
  const isUser = message.role === 'user';
  const hasToolEvents = !!message.toolEvents && message.toolEvents.length > 0;
  const showTyping =
    !isUser && isStreaming && message.content.length === 0 && !hasToolEvents;

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
      {hasToolEvents && (
        <div>
          {message.toolEvents!.map((event) => (
            <ToolCallCard key={event.id} event={event} />
          ))}
        </div>
      )}
      {showTyping ? (
        <div className="text-[15px] leading-relaxed">
          <TypingDots />
        </div>
      ) : (
        message.content.length > 0 && <MarkdownMessage content={message.content} />
      )}
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
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
          }
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
    setError('');
  }

  const isStreaming = status === 'sending';
  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-full flex-col">
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
            {messages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                agentName={agentName}
                isStreaming={isStreaming}
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
          <div className="rounded-2xl border border-border bg-card shadow-sm transition-all focus-within:border-foreground/25 focus-within:shadow-md">
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
            <Textarea
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
              className="min-h-16 resize-none border-0 bg-transparent px-4 pt-3 text-[15px] shadow-none focus-visible:ring-0"
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
  );
}
