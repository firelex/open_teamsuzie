import { Sparkles, Check, FileText } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

/**
 * App controls for the top-bar frame. The frame itself — height, background,
 * bottom border, font, padding — is fixed by `WorkspaceShell`; this component
 * supplies only the app's right-aligned controls. Every app shows the three
 * affordances the journeys lean on: a credit-balance chip, an approvals
 * indicator, and an audit entry point. Wired to live data by the build agent;
 * their data-testids never change.
 */
export function TopBar() {
  return (
    <div className="ml-auto flex items-center gap-3 text-xs text-neutral-600">
      <span data-testid={testid.creditBalance} className="inline-flex items-center gap-1 font-mono-data">
        <Sparkles className="h-3.5 w-3.5 text-ev-700" /> — credits
      </span>
      <button
        type="button"
        data-testid={testid.approvalsIndicator}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-ev-50/60"
      >
        <Check className="h-3.5 w-3.5" /> Approvals
      </button>
      <a
        href="/audit"
        data-testid={testid.auditLink}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-ev-50/60"
      >
        <FileText className="h-3.5 w-3.5" /> Audit
      </a>
    </div>
  );
}
