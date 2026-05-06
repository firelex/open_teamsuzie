import { useCallback, useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  AppShellContent,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  User,
  type Column,
} from '@teamsuzie/ui';

export interface AgentRow {
  id: string;
  name: string;
  description: string | null;
  agent_type: 'openclaw' | 'custom';
  status: 'active' | 'inactive' | 'suspended';
  profile_id: string | null;
  profile_name: string | null;
  config: {
    baseUrl?: string;
    text_model?: string;
    skills?: string[];
    approval_required?: boolean;
    avatar?: string | null;
  };
  created_at: string;
}

function statusVariant(status: AgentRow['status']): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default';
    case 'inactive':
      return 'outline';
    case 'suspended':
      return 'destructive';
  }
}

export function AgentsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/agents', { credentials: 'include' });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed to load agents (${response.status})`);
      }
      const data = (await response.json()) as { items: AgentRow[] };
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load agents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete agent "${name}"? This cannot be undone.`)) return;
    const response = await fetch(`/api/agents/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(data.error || 'Delete failed');
      return;
    }
    await refresh();
  }

  const columns: Column<AgentRow>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          {row.config.avatar ? (
            <img
              src={row.config.avatar}
              alt=""
              className="size-9 shrink-0 rounded-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="size-4 text-muted-foreground" aria-hidden />
            </div>
          )}
          <div className="min-w-0">
            <div className="truncate font-medium">{row.name}</div>
            {row.description && (
              <div className="truncate text-xs text-muted-foreground">{row.description}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'profile',
      header: 'Profile',
      render: (row) => row.profile_name ?? <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => <span className="font-mono text-xs">{row.agent_type}</span>,
    },
    {
      key: 'model',
      header: 'Model',
      render: (row) =>
        row.config.text_model ? (
          <span className="font-mono text-xs">{row.config.text_model}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'endpoint',
      header: 'Endpoint',
      render: (row) =>
        row.config.baseUrl ? (
          <span className="truncate font-mono text-xs text-muted-foreground">{row.config.baseUrl}</span>
        ) : (
          <Badge variant="outline">not set</Badge>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
    },
  ];

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Agents</PageHeaderTitle>
          <PageHeaderDescription>
            Register agents your users can chat with. Each agent points at an OpenClaw-compatible endpoint.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <Button onClick={() => navigate('/agents/new')}>New agent</Button>
        </PageHeaderActions>
      </PageHeader>
      <AppShellContent>
        <div className="space-y-4 p-6">
          {error && (
            <Card className="border-destructive/40 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-destructive text-sm">{error}</CardTitle>
                <CardDescription className="text-xs">
                  The backend rejected the request. Check the server log for the matching request id.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          {!loading && items.length === 0 && !error ? (
            <Card>
              <CardHeader>
                <CardTitle>No agents yet</CardTitle>
                <CardDescription>
                  Create your first agent from a profile template, or register an OpenClaw endpoint by hand.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-2">
                  <Button onClick={() => navigate('/agents/new')}>Create agent</Button>
                  <Button variant="outline" asChild>
                    <NavLink to="/chat">Go to Chat</NavLink>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <DataTable<AgentRow>
              data={items}
              columns={columns}
              getRowKey={(row) => row.id}
              isLoading={loading}
              emptyMessage="No agents yet."
              filterPlaceholder="Filter agents…"
              filterFn={(row, query) => {
                const q = query.toLowerCase();
                return (
                  row.name.toLowerCase().includes(q) ||
                  (row.description ?? '').toLowerCase().includes(q) ||
                  (row.profile_name ?? '').toLowerCase().includes(q)
                );
              }}
              renderActions={(row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => navigate(`/agents/${row.id}`)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => void remove(row.id, row.name)}
                  >
                    Delete
                  </Button>
                </div>
              )}
            />
          )}
        </div>
      </AppShellContent>
    </>
  );
}
