import { DataTable, Button, type Column, type BulkAction } from '@teamsuzie/ui';
import { testid } from '../lib/testids';

export interface CollectionWorkspaceProps<T> {
  title: string;
  data: T[];
  columns: Column<T>[];
  getRowKey: (item: T) => string;
  onRowClick?: (item: T) => void;
  selectable?: boolean;
  bulkActions?: BulkAction[];
  filterFn?: (item: T, query: string) => boolean;
  filterPlaceholder?: string;
  emptyMessage?: string;
  primaryAction?: { label: string; onClick: () => void };
}

/**
 * Canonical "list / collection" archetype: a filtered, optionally-selectable
 * DataTable with bulk actions and a primary action — for queues, indexes,
 * feeds, pipelines-as-list. The build agent passes domain columns/data; the
 * layout, empty state, and testids are fixed.
 */
export function CollectionWorkspace<T>({
  title, data, columns, getRowKey, onRowClick, selectable, bulkActions,
  filterFn, filterPlaceholder, emptyMessage, primaryAction,
}: CollectionWorkspaceProps<T>) {
  return (
    <div data-testid={testid.collectionWorkspace} className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 py-4">
        <h1 className="text-lg font-semibold text-neutral-900">{title}</h1>
        {primaryAction && (
          <Button data-testid={testid.primaryAction} onClick={primaryAction.onClick}>
            {primaryAction.label}
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 pb-6">
        <DataTable
          data={data}
          columns={columns}
          getRowKey={getRowKey}
          onRowClick={onRowClick}
          selectable={selectable}
          bulkActions={bulkActions}
          filterFn={filterFn}
          filterPlaceholder={filterPlaceholder}
          emptyMessage={emptyMessage ?? 'Nothing here yet.'}
        />
      </div>
    </div>
  );
}
