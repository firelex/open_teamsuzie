import {
  PageShell,
  PageBody,
  ActivityPill,
  Inbox,
  Button,
  Card,
  CardContent,
  ArrowRight,
} from '@teamsuzie/ui';

const ITEMS = [
  { id: 'r-104', subject: 'Reconcile weekly report', state: 'work-run-active' as const, owner: 'agent', age: '1m' },
  { id: 'r-103', subject: 'Compose stakeholder digest', state: 'awaiting-user' as const, owner: 'you', age: '22m' },
  { id: 'r-099', subject: 'Triage new contact requests', state: 'idle' as const, owner: 'queued', age: '3h' },
  { id: 'r-098', subject: 'Refresh KB clipping batch', state: 'work-run-paused' as const, owner: 'paused', age: '1d' },
];

/**
 * Work-queue placeholder. The brief asks for `item` / `run` / `subject` as
 * the canonical vocabulary so every department reads as the same product.
 * Wire `ITEMS` to your durable store; keep the column shape so the user
 * can switch verticals without re-learning the queue.
 */
export function WorkQueuePage() {
  return (
    <PageShell
      icon={Inbox}
      kicker="Backlog"
      title="Work queue"
      tagline="Pending items, in-flight runs, and what's waiting on you."
      reserveUsageArea={false}
      watermarkSrc={null}
    >
      <PageBody>
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y divide-neutral-100">
              {ITEMS.map((item) => (
                <li key={item.id} className="flex items-center gap-4 px-4 py-3">
                  <span className="font-mono-data text-xs text-neutral-400 w-16">{item.id}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-neutral-900">{item.subject}</div>
                    <div className="text-[11px] text-neutral-500">
                      Owner: {item.owner} · {item.age}
                    </div>
                  </div>
                  <ActivityPill variant={item.state} size="xs" />
                  <Button size="sm" variant="ghost">
                    Open
                    <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
