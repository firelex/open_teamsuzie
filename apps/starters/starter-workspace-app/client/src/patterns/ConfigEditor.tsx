import { useState, type ReactNode } from 'react';
import { Button, useConfirm } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

export interface ConfigEditorProps {
  title: string;
  /** The settings/config form (supplied by the app). */
  children: ReactNode;
  /** Persist+activate the config — routes through the approval gate first. */
  onSave: () => void | Promise<void>;
  /** Enables the Save button once there are unsaved changes. */
  dirty?: boolean;
  saveLabel?: string;
  confirmDescription?: ReactNode;
}

/**
 * Canonical "configuration / governance editor" archetype: an editor body plus
 * an edit → confirm → activate flow. Save ALWAYS confirms through useConfirm
 * before persisting. The build agent supplies the form; the gate/testids fixed.
 */
export function ConfigEditor({
  title, children, onSave, dirty = false, saveLabel = 'Save changes', confirmDescription,
}: ConfigEditorProps) {
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const ok = await confirm({ title: 'Apply configuration changes?', description: confirmDescription, confirmLabel: saveLabel });
    if (!ok) return;
    setBusy(true);
    try { await onSave(); } finally { setBusy(false); }
  };

  return (
    <div data-testid={testid.configEditor} className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 px-6 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        <Button data-testid={testid.primaryAction} disabled={busy || !dirty} onClick={save}>
          {saveLabel}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">{children}</div>
    </div>
  );
}
