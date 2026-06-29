import { useState, type ReactNode } from 'react';
import { Button, useConfirm } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

export interface DeliverableReviewProps {
  title: string;
  /** The deliverable preview (document/diff/slides/table — supplied by the app). */
  children: ReactNode;
  /** Approve the deliverable — routes through the approval gate first. */
  onApprove: () => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  approveLabel?: string;
  confirmDescription?: ReactNode;
}

/**
 * Canonical "review & approve a deliverable" archetype: a preview pane plus an
 * approval gate. Approve ALWAYS confirms through useConfirm before the
 * side-effect. The build agent supplies the preview; the gate/testids are fixed.
 */
export function DeliverableReview({
  title, children, onApprove, onReject, approveLabel = 'Approve', confirmDescription,
}: DeliverableReviewProps) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    const ok = await confirm({ title: `${approveLabel}?`, description: confirmDescription, confirmLabel: approveLabel });
    if (!ok) return;
    setBusy(true);
    try { await onApprove(); } finally { setBusy(false); }
  };

  return (
    <div data-testid={testid.deliverableReview} className="flex h-full flex-col">
      <div className="px-6 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6">{children}</div>
      <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-3">
        {onReject && (
          <Button variant="outline" disabled={busy} onClick={() => onReject()}>
            Reject
          </Button>
        )}
        <Button data-testid={testid.primaryAction} disabled={busy} onClick={approve}>
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
