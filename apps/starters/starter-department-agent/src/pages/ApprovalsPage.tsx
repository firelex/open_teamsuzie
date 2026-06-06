import {
  PageShell,
  PageBody,
  Check,
  Card,
  CardContent,
  Button,
  Badge,
  XCircle,
} from '@teamsuzie/ui';

const QUEUE = [
  {
    id: 'apv-04',
    subject: 'Send weekly digest to stakeholders',
    summary: 'Composed draft references 8 sources and 2 tables. Awaiting your sign-off before send.',
    age: '1h 04m',
    kind: 'send' as const,
  },
  {
    id: 'apv-03',
    subject: 'Update vendor record (Acme Co.)',
    summary: 'Agent proposes 3 field changes (renewal_date, owner_email, contract_term).',
    age: '4h 22m',
    kind: 'mutation' as const,
  },
];

/**
 * Approvals placeholder. Wire to `@teamsuzie/approvals` once the server
 * side is in. The shape — id, subject, summary, age, kind — is what
 * every department app surfaces; the buttons (approve / reject) are the
 * minimum interaction. Add diffs or rich previews inline as needed.
 */
export function ApprovalsPage() {
  return (
    <PageShell
      icon={Check}
      kicker="Gatekeeping"
      title="Approvals"
      tagline="Items the agent paused on for human sign-off."
      reserveUsageArea={false}
      watermarkSrc={null}
    >
      <PageBody>
        {QUEUE.length === 0 ? (
          <p className="text-sm text-neutral-500">Nothing waiting — agent has a clean runway.</p>
        ) : (
          <ul className="space-y-3">
            {QUEUE.map((row) => (
              <li key={row.id}>
                <Card>
                  <CardContent>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono-data text-[11px] text-neutral-400">{row.id}</span>
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                            {row.kind}
                          </Badge>
                          <span className="ml-auto text-[11px] text-neutral-400">{row.age}</span>
                        </div>
                        <div className="mt-1 text-sm font-medium text-neutral-900">{row.subject}</div>
                        <p className="mt-1 text-xs text-neutral-600">{row.summary}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="outline">
                        <XCircle className="mr-1 h-3.5 w-3.5" />
                        Reject
                      </Button>
                      <Button size="sm">
                        <Check className="mr-1 h-3.5 w-3.5" />
                        Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </PageBody>
    </PageShell>
  );
}
