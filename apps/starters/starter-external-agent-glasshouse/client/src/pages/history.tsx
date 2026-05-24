import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppShellContent,
  Button,
  EmptyState,
  EmptyStateDescription,
  EmptyStateTitle,
  LoadingState,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
} from '@teamsuzie/ui';
import type { Chat } from '@teamsuzie/chats';

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Lists persisted top-level Assistant chats from /api/chats. Apps that
 * bootstrap from this starter and add real auth would scope this list per
 * user via the chats router's `getWorkspaceId` resolver — no client change
 * needed.
 */
export function HistoryPage() {
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/chats');
      if (!res.ok) throw new Error(`Failed to load chats (${res.status})`);
      const data = (await res.json()) as { items: Chat[] };
      setChats(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleDelete(chat: Chat) {
    if (!window.confirm(`Delete "${chat.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/chats/${encodeURIComponent(chat.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`Failed (${res.status})`);
      }
      setChats((c) => c.filter((x) => x.id !== chat.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

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
      <AppShellContent className="px-6 pt-6 pb-12">
        {loading ? (
          <LoadingState>Loading chats…</LoadingState>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : chats.length === 0 ? (
          <EmptyState>
            <EmptyStateTitle>No conversations yet</EmptyStateTitle>
            <EmptyStateDescription>
              Start a new chat from the Assistant page — it'll show up here.
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border bg-card">
            {chats.map((chat) => (
              <li
                key={chat.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/c/${encodeURIComponent(chat.id)}`)
                  }
                  className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                >
                  <span className="truncate text-sm font-medium text-foreground">
                    {chat.name || 'New chat'}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(chat.updatedAt)}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDelete(chat)}
                  aria-label={`Delete ${chat.name}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </AppShellContent>
    </>
  );
}
