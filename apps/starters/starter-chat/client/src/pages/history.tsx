import {
  AppShellContent,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '@teamsuzie/ui';

/**
 * Generic History page scaffold. The starter doesn't persist sessions — wire
 * this to your session store (Postgres, Redis, etc.) when you need it.
 */
export function HistoryPage() {
  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>History</PageHeaderTitle>
          <PageHeaderDescription>
            Recent assistant conversations.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent className="px-6 pb-12">
        <EmptyState>
          <EmptyStateTitle>No conversations yet</EmptyStateTitle>
          <EmptyStateDescription>
            The starter doesn't persist sessions out of the box. Wire this page
            to your session store to list past chats.
          </EmptyStateDescription>
        </EmptyState>
      </AppShellContent>
    </>
  );
}
