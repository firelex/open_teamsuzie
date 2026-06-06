import {
  PageShell,
  PageBody,
  ActivityPill,
  Activity as ActivityIcon,
  Card,
  CardContent,
} from '@teamsuzie/ui';

const FEED = [
  { ts: '09:42', who: 'work-run-active' as const, who_label: 'Run active', detail: 'rec-104 · reconcile weekly report' },
  { ts: '09:38', who: 'codex-active' as const, who_label: 'Codex reviewing', detail: 'pr-12 / 3 files' },
  { ts: '09:35', who: 'awaiting-user' as const, who_label: 'Needs review', detail: 'rec-103 · sign-off requested' },
  { ts: '09:31', who: 'idle' as const, who_label: 'Idle', detail: 'rec-099 · queued' },
  { ts: '09:20', who: 'error' as const, who_label: 'Error', detail: 'rec-098 · webhook timeout' },
];

/**
 * Activity feed placeholder. Real apps stream events from
 * `@teamsuzie/events` here; the `ActivityPill` variants line up 1:1 with
 * agent states so the visual vocabulary stays consistent across surfaces
 * (sidebar badges, page kickers, this feed).
 */
export function ActivityPage() {
  return (
    <PageShell
      icon={ActivityIcon}
      kicker="Telemetry"
      title="Activity"
      tagline="Recent agent activity across the department."
      reserveUsageArea={false}
      watermarkSrc={null}
    >
      <PageBody>
        <Card>
          <CardContent>
            <ul className="divide-y divide-neutral-100">
              {FEED.map((row, idx) => (
                <li key={idx} className="flex items-center gap-3 py-2.5">
                  <span className="font-mono-data text-xs text-neutral-400 w-12">{row.ts}</span>
                  <ActivityPill variant={row.who} label={row.who_label} size="xs" />
                  <span className="ml-auto truncate text-sm text-neutral-700">{row.detail}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
