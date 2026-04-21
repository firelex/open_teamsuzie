import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppShellContent,
  Badge,
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderTitle,
  type Column,
} from '@teamsuzie/ui';

export interface ActivityRow {
  id: string;
  timestamp: string;
  actor_type: 'user' | 'agent' | 'system';
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  details: Record<string, unknown> | null;
}

interface FilterPreset {
  key: string;
  label: string;
  actionPrefix?: string;
  resourceType?: string;
}

const FILTER_PRESETS: FilterPreset[] = [
  { key: 'all', label: 'All' },
  { key: 'agents', label: 'Agents', actionPrefix: 'agent.' },
  { key: 'approvals', label: 'Approvals', actionPrefix: 'approval.' },
  { key: 'tokens', label: 'Tokens', actionPrefix: 'api_key.' },
  { key: 'config', label: 'Config', actionPrefix: 'config.' },
];

function actionVariant(action: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (action.endsWith('.delete') || action.endsWith('.reject') || action.endsWith('.revoke')) {
    return 'destructive';
  }
  if (action.endsWith('.create') || action.endsWith('.approve')) return 'default';
  if (action.endsWith('.update') || action.endsWith('.propose')) return 'secondary';
  return 'outline';
}

export function ActivityPage() {
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<FilterPreset>(FILTER_PRESETS[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ActivityRow | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ limit: '50' });
    if (filter.actionPrefix) params.set('action_prefix', filter.actionPrefix);
    if (filter.resourceType) params.set('resource_type', filter.resourceType);
    try {
      const response = await fetch(`/api/activity?${params.toString()}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Failed to load activity (${response.status})`);
      }
      const data = (await response.json()) as { items: ActivityRow[]; total: number };
      setRows(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const columns = useMemo<Column<ActivityRow>[]>(
    () => [
      {
        key: 'timestamp',
        header: 'When',
        render: (row) => (
          <span className="text-xs text-muted-foreground">{new Date(row.timestamp).toLocaleString()}</span>
        ),
      },
      {
        key: 'actor',
        header: 'Actor',
        render: (row) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="font-mono text-[10px]">
                {row.actor_type}
              </Badge>
              <span className="truncate">{row.actor_label ?? (row.actor_id ? row.actor_id.slice(0, 8) : '—')}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'action',
        header: 'Action',
        render: (row) => (
          <Badge variant={actionVariant(row.action)} className="font-mono text-[10px]">
            {row.action}
          </Badge>
        ),
      },
      {
        key: 'resource',
        header: 'Resource',
        render: (row) => (
          <div className="min-w-0">
            <div className="text-xs">{row.resource_type}</div>
            {row.resource_id && (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {row.resource_id.slice(0, 8)}…
              </div>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderTitle>Activity</PageHeaderTitle>
          <PageHeaderDescription>
            Every state change captured by the admin control plane. Backed by{' '}
            <code className="font-mono">audit_log</code>; each row shows the actor lane
            (<code className="font-mono">user</code> / <code className="font-mono">agent</code> /{' '}
            <code className="font-mono">system</code>) that produced it.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>
      <AppShellContent>
        <div className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            {FILTER_PRESETS.map((preset) => (
              <Button
                key={preset.key}
                size="sm"
                variant={filter.key === preset.key ? 'default' : 'outline'}
                onClick={() => setFilter(preset)}
              >
                {preset.label}
              </Button>
            ))}
            <div className="ml-auto text-xs text-muted-foreground">
              {loading ? 'loading…' : `${rows.length} of ${total}`}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <DataTable<ActivityRow>
            data={rows}
            columns={columns}
            getRowKey={(row) => row.id}
            isLoading={loading}
            emptyMessage="No activity yet."
            onRowClick={(row) => setDetail(row)}
            renderActions={(row) => (
              <Button variant="ghost" size="sm" onClick={() => setDetail(row)}>
                View
              </Button>
            )}
          />
        </div>
      </AppShellContent>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge variant={actionVariant(detail?.action ?? '')} className="font-mono text-[10px]">
                {detail?.action}
              </Badge>
              <span className="font-mono text-sm">{detail?.resource_type}</span>
            </DialogTitle>
            <DialogDescription>
              {detail
                ? `${new Date(detail.timestamp).toLocaleString()} · ${detail.actor_type}${
                    detail.actor_label ? ` · ${detail.actor_label}` : ''
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-4 text-sm">
              {detail.resource_id && (
                <div>
                  <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Resource id
                  </div>
                  <pre className="rounded-md bg-muted p-3 font-mono text-xs">{detail.resource_id}</pre>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Details
                </div>
                <pre className="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {detail.details ? JSON.stringify(detail.details, null, 2) : '(none)'}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
