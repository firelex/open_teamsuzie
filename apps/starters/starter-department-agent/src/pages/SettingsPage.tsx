import {
  PageShell,
  PageBody,
  SettingsIcon,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  Switch,
  Label,
  Input,
} from '@teamsuzie/ui';

/**
 * Settings placeholder. The two cards demonstrate (1) primitive form
 * controls from `@teamsuzie/ui` and (2) the editorial card pattern used
 * everywhere else in the app. Replace with real department-specific
 * configuration as you build out the vertical.
 */
export function SettingsPage() {
  return (
    <PageShell
      icon={SettingsIcon}
      kicker="Configuration"
      title="Settings"
      tagline="Department defaults, notification rules, and agent preferences."
      reserveUsageArea={false}
      watermarkSrc={null}
    >
      <PageBody maxWidth="max-w-4xl">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Identity</CardTitle>
              <CardDescription>How this department app introduces itself.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label htmlFor="dept-name">Display name</Label>
                <Input id="dept-name" defaultValue="Department" />
              </div>
              <div className="grid grid-cols-[140px_1fr] items-center gap-3">
                <Label htmlFor="dept-tagline">Tagline</Label>
                <Input id="dept-tagline" defaultValue="Operational agent" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Pings sent when the agent needs you.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notif-approvals">Approval requests</Label>
                  <p className="text-xs text-neutral-500">Ping me when an item lands in the queue.</p>
                </div>
                <Switch id="notif-approvals" defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notif-errors">Run errors</Label>
                  <p className="text-xs text-neutral-500">Ping me when a run fails.</p>
                </div>
                <Switch id="notif-errors" defaultChecked />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="notif-digest">Daily digest</Label>
                  <p className="text-xs text-neutral-500">Morning summary of the queue.</p>
                </div>
                <Switch id="notif-digest" />
              </div>
            </CardContent>
          </Card>
        </div>
      </PageBody>
    </PageShell>
  );
}
