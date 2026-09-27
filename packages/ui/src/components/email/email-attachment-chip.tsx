import * as React from 'react';

import { humanSize } from '../../lib/format.js';
import { cn } from '../../lib/utils.js';

/** The short kind label shown on a chip, from the file extension. */
function kindOf(filename: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === 'docx' || ext === 'doc') return 'DOCX';
  if (ext === 'pdf') return 'PDF';
  if (ext === 'xlsx' || ext === 'xls') return 'XLSX';
  return ext ? ext.toUpperCase().slice(0, 4) : 'FILE';
}

export interface EmailAttachmentChipProps {
  filename: string;
  size: number | null;
  /** When given, the chip is a button that opens the attachment. */
  onOpen?: () => void;
  className?: string;
}

/** One attachment of an email: its kind, name and size. */
export function EmailAttachmentChip({ filename, size, onOpen, className }: EmailAttachmentChipProps) {
  const body = (
    <>
      <span className="rounded-sm bg-muted px-1 py-px text-[10px] font-semibold tracking-wide text-muted-foreground">{kindOf(filename)}</span>
      <span className="truncate">{filename}</span>
      {size !== null && <span className="shrink-0 text-muted-foreground">{humanSize(size)}</span>}
    </>
  );
  const classes = cn('inline-flex max-w-full items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs', className);
  if (!onOpen) return <span data-slot="email-attachment" className={classes}>{body}</span>;
  return (
    <button type="button" data-slot="email-attachment" onClick={onOpen} className={cn(classes, 'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring')}>
      {body}
    </button>
  );
}
