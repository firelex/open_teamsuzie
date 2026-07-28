import {
  PageShell,
  PageBody,
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  LayoutGrid,
} from '@teamsuzie/ui';

/**
 * Placeholder home page so the stamped app runs before any wiring. The build
 * agent replaces this with the app's real entry screen (typically a
 * CollectionWorkspace) per docs/ux/layout.json.
 */
export function HomePage() {
  return (
    <PageShell icon={LayoutGrid} kicker="Workspace" title="Home" tagline="Stamped from the workspace starter — wire your app from docs/ux/layout.json.">
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>Workspace starter</CardTitle>
            <CardDescription>
              Stamped from <code>starter-workspace-app</code>. Wire the navigation, object
              workspaces, and screens from <code>docs/ux/layout.json</code> using the canonical
              patterns in <code>src/patterns</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-neutral-600">
              The shell, top bar, approval flow, and screen patterns are fixed by the template —
              only the app-specific wiring and real screen behaviour are generated per build.
            </p>
          </CardContent>
        </Card>
      </PageBody>
    </PageShell>
  );
}
