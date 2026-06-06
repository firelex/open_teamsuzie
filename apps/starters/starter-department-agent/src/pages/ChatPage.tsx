import {
  PageShell,
  PageBody,
  MessageSquare,
  Card,
  CardContent,
} from '@teamsuzie/ui';

/**
 * Chat surface placeholder. Real apps mount `<ChatThread>` from
 * `@teamsuzie/ui` here — see `suzie-it-department/src/web/components/tabs/*`
 * for working examples that wire it to `useChatThreadStream` + a server
 * SSE endpoint. The visual chrome (PageShell hero band + status pill)
 * stays the same regardless of which thread implementation you mount.
 */
export function ChatPage() {
  return (
    <PageShell
      icon={MessageSquare}
      kicker="Conversation"
      title="Chat"
      tagline="Direct line to the department agent."
      statusPill={{ tone: 'beta', label: 'Placeholder' }}
      reserveUsageArea={false}
      watermarkSrc={null}
      bodyScrolls={false}
    >
      <PageBody className="h-full">
        <Card className="h-full">
          <CardContent className="flex h-full items-center justify-center text-center">
            <div>
              <p className="text-sm text-neutral-600">
                Mount <code className="font-mono-data text-ev-700">@teamsuzie/ui &gt; ChatThread</code>{' '}
                here and wire it to your SSE endpoint.
              </p>
              <p className="mt-1 text-xs text-neutral-400">
                See <code className="font-mono-data">starter-external-agent-teamsuzie</code> for a
                working server + client pair.
              </p>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
