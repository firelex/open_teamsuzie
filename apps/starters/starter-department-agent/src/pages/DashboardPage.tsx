import {
  PageShell,
  PageBody,
  ActivityPill,
  LayoutGrid,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@teamsuzie/ui';

const SUMMARY = [
  { label: 'Open items', value: '12', delta: '+3 since yesterday' },
  { label: 'In progress', value: '4', delta: '2 awaiting approval' },
  { label: 'Completed (7d)', value: '38', delta: 'p95 4h 12m' },
  { label: 'Approvals queued', value: '2', delta: 'oldest 1h 04m' },
];

const RECENT = [
  { id: 'r-104', subject: 'Reconcile weekly report', state: 'work-run-active' as const, since: 'Active · 1m' },
  { id: 'r-103', subject: 'Compose stakeholder digest', state: 'awaiting-user' as const, since: 'Needs review · 22m' },
  { id: 'r-102', subject: 'Triage incoming requests', state: 'idle' as const, since: 'Idle · 3h' },
];

/**
 * Operational dashboard placeholder. Replace SUMMARY/RECENT with feeds
 * from your platform-bridge / agent-runtime hookup. The metric grid +
 * activity list pattern is the same shape every department app uses.
 */
export function DashboardPage() {
  return (
    <PageShell
      icon={LayoutGrid}
      kicker="Operations"
      title="Dashboard"
      tagline="Snapshot of open work, in-flight runs, and approvals waiting on you."
      reserveUsageArea={false}
      watermarkSrc={null}
    >
      <PageBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SUMMARY.map((card) => (
            <Card key={card.label}>
              <CardHeader>
                <CardDescription className="text-[10px] font-bold uppercase tracking-[0.18em] text-ev-700/80">
                  {card.label}
                </CardDescription>
                <CardTitle className="font-mono-data text-3xl tracking-tight">{card.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-neutral-500">{card.delta}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>The last few items the department touched.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-neutral-100">
              {RECENT.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-neutral-900">{row.subject}</div>
                    <div className="font-mono-data text-[11px] text-neutral-500">{row.id} · {row.since}</div>
                  </div>
                  <ActivityPill variant={row.state} size="xs" />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
