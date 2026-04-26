import {
  AppShellContent,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@teamsuzie/ui';

/**
 * Generic Library page scaffold. Apps built on this starter typically replace
 * the empty states with their own content (prompt templates, workflows,
 * playbooks, examples). The shape — Tabs + grid of cards — is the bit that
 * tends to recur, so it's wired up here as a starting point.
 */
export function LibraryPage() {
  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Library</PageHeaderTitle>
          <PageHeaderDescription>
            Reusable prompts, workflows, and examples for your assistant.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent className="px-6 pb-12">
        <Tabs defaultValue="prompts">
          <TabsList>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="examples">Examples</TabsTrigger>
          </TabsList>
          <TabsContent value="prompts">
            <EmptyState>
              <EmptyStateTitle>No prompts yet</EmptyStateTitle>
              <EmptyStateDescription>
                Add saved prompts here. In an app built on this starter, you
                might pre-seed a catalog and let users save their own.
              </EmptyStateDescription>
            </EmptyState>
          </TabsContent>
          <TabsContent value="workflows">
            <EmptyState>
              <EmptyStateTitle>No workflows yet</EmptyStateTitle>
              <EmptyStateDescription>
                Workflows are multi-step agent recipes. Wire them to the
                tool-use loop and surface them here.
              </EmptyStateDescription>
            </EmptyState>
          </TabsContent>
          <TabsContent value="examples">
            <EmptyState>
              <EmptyStateTitle>No examples yet</EmptyStateTitle>
              <EmptyStateDescription>
                Showcase finished assistant outputs to help users learn what
                the assistant can do.
              </EmptyStateDescription>
            </EmptyState>
          </TabsContent>
        </Tabs>
        <Card className="mt-8">
          <CardHeader>
            <CardDescription>How this page extends</CardDescription>
            <CardTitle>Replace the empty states with your content</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Use{' '}
              <code className="font-mono text-foreground">PromptCard</code> from{' '}
              <code className="font-mono text-foreground">@teamsuzie/ui</code> for the grid items.
              Drive selection with a router link or a click handler that pre-fills the chat input on the Assistant page.
            </p>
          </CardContent>
        </Card>
      </AppShellContent>
    </>
  );
}
