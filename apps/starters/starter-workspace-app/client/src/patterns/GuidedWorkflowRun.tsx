import { useState, type ReactNode } from 'react';
import { Button, useConfirm } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

export interface GuidedStep {
  id: string;
  label: string;
}

export interface GuidedWorkflowRunProps {
  title: string;
  steps: GuidedStep[];
  currentStepId: string;
  children: ReactNode;
  /** The terminal side-effect — runs ONLY after the approval gate confirms. */
  onComplete: () => void | Promise<void>;
  completeLabel?: string;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
}

/**
 * Canonical "guided workflow run" archetype: a stepper + step content + a
 * terminal action that ALWAYS routes through the global approval gate
 * (useConfirm) before producing its side-effect. The build agent fills the
 * steps and step content; the gate and testids are fixed.
 */
export function GuidedWorkflowRun({
  title, steps, currentStepId, children, onComplete,
  completeLabel = 'Complete', confirmTitle = 'Run this action?', confirmDescription,
}: GuidedWorkflowRunProps) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const isLast = steps.length === 0 || steps[steps.length - 1]?.id === currentStepId;

  const run = async () => {
    const ok = await confirm({ title: confirmTitle, description: confirmDescription, confirmLabel: completeLabel });
    if (!ok) return;
    setBusy(true);
    try { await onComplete(); } finally { setBusy(false); }
  };

  return (
    <div data-testid={testid.guidedWorkflowRun} className="flex h-full flex-col">
      <div className="px-6 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
      </div>
      <ol className="flex flex-wrap gap-3 px-6 pb-3 text-xs">
        {steps.map((s, i) => (
          <li key={s.id} className={s.id === currentStepId ? 'font-semibold text-ev-700' : 'text-neutral-400'}>
            {i + 1}. {s.label}
          </li>
        ))}
      </ol>
      <div className="min-h-0 flex-1 overflow-auto px-6">{children}</div>
      <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-3">
        <Button data-testid={testid.primaryAction} disabled={busy || !isLast} onClick={run}>
          {completeLabel}
        </Button>
      </div>
    </div>
  );
}
