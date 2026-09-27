import * as React from 'react';

import { cn } from '../../lib/utils.js';
import { EmailAttachmentChip } from './email-attachment-chip.js';

export interface EmailThreadMessage {
  id: string;
  fromName: string | null;
  from: string;
  to: string[];
  cc: string[];
  /** ISO date. */
  sentAt: string;
  /** Sanitised HTML, or null for a plain-text message. The host mounts it through `renderHtml`. */
  html: string | null;
  text: string;
  /** Offset into `text` where quoted history starts; null when the message quotes nothing. */
  quotedFrom: number | null;
  /** `id` opens the attachment; file names are not unique. */
  attachments: Array<{ id: string; filename: string; contentType: string; size: number | null }>;
  unread: boolean;
}

export interface EmailThreadViewProps {
  messages: EmailThreadMessage[];
  order: 'latest_first' | 'oldest_first';
  /**
   * Mounts a message's HTML body. The host decides how (for example a
   * sandboxed iframe); this component never inserts HTML itself.
   */
  renderHtml: (html: string) => React.ReactNode;
  onOpenAttachment?: (messageId: string, attachmentId: string) => void;
  className?: string;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function Addresses({ label, list }: { label: string; list: string[] }) {
  if (list.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {list.map((a, i) => <span key={`${a}-${i}`}>{a}</span>)}
    </div>
  );
}

function Body({ message, renderHtml }: { message: EmailThreadMessage; renderHtml: EmailThreadViewProps['renderHtml'] }) {
  const [showQuote, setShowQuote] = React.useState(false);
  const hasQuote = message.quotedFrom !== null;
  // HTML is shown whole (the host's frame decides its layout); the quote toggle applies to plain text.
  if (message.html !== null) return <div data-slot="email-body">{renderHtml(message.html)}</div>;
  const own = hasQuote ? message.text.slice(0, message.quotedFrom!).trimEnd() : message.text;
  return (
    <div data-slot="email-body" className="text-sm">
      <p className="whitespace-pre-wrap">{own}</p>
      {hasQuote && (
        <>
          <button type="button" onClick={() => setShowQuote((v) => !v)} className="mt-2 rounded-sm px-1 text-xs text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {showQuote ? 'Hide quoted text' : 'Show quoted text'}
          </button>
          {showQuote && <p className="mt-1 whitespace-pre-wrap border-l-2 pl-3 text-muted-foreground">{message.text.slice(message.quotedFrom!)}</p>}
        </>
      )}
    </div>
  );
}

/** An email conversation laid out like a desktop mail client: a header block per message, the body, and attachment chips. */
export function EmailThreadView({ messages, order, renderHtml, onOpenAttachment, className }: EmailThreadViewProps) {
  const sorted = [...messages].sort((a, b) => (order === 'latest_first' ? b.sentAt.localeCompare(a.sentAt) : a.sentAt.localeCompare(b.sentAt)));
  return (
    <div data-slot="email-thread" className={cn('flex flex-col gap-3', className)}>
      {sorted.map((m) => (
        <article key={m.id} data-slot="email-message" data-message-id={m.id} data-unread={m.unread ? 'true' : 'false'} className={cn('rounded-lg border bg-card p-4', m.unread && 'border-l-4 border-l-primary')}>
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-1 text-sm">
                <span className="font-semibold">{m.fromName ?? m.from}</span>
                {m.fromName && <span className="text-xs text-muted-foreground">{`<${m.from}>`}</span>}
              </div>
              <Addresses label="To" list={m.to} />
              <Addresses label="Cc" list={m.cc} />
            </div>
            <time dateTime={m.sentAt} className="shrink-0 text-xs text-muted-foreground">{dateFormat.format(new Date(m.sentAt))}</time>
          </header>
          <Body message={m} renderHtml={renderHtml} />
          {m.attachments.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <EmailAttachmentChip key={a.id} filename={a.filename} size={a.size} onOpen={onOpenAttachment ? () => onOpenAttachment(m.id, a.id) : undefined} />
              ))}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
