import * as React from 'react';
import { format } from 'date-fns';
import { Loader2, Search } from 'lucide-react';
import { cn } from '../lib/utils';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from './table';
import { Button } from './button';
import { Input } from './input';
import { useUiT } from '../lib/i18n.js';

// Standard date format for consistency across the app
export function formatDate(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return format(d, 'MMM d, yyyy');
}

export function formatDateTime(date: string | Date | null | undefined): string {
    if (!date) return '-';
    const d = typeof date === 'string' ? new Date(date) : date;
    return format(d, 'MMM d, yyyy HH:mm');
}

export interface Column<T> {
    /** Unique key for the column */
    key: string;
    /** Header label */
    header: React.ReactNode;
    /** Width class (e.g., "w-[100px]") */
    width?: string;
    /** Text alignment */
    align?: 'left' | 'center' | 'right';
    /**
     * Extra classes for both the header and the body cells of this column,
     * e.g. `"hidden md:table-cell"` to drop a column on narrow screens.
     */
    className?: string;
    /** Render function for cell content */
    render: (item: T) => React.ReactNode;
}

export interface BulkAction {
    key: string;
    label: string;
    icon?: React.ReactNode;
    variant?: 'default' | 'destructive' | 'outline';
    onClick: (selectedKeys: string[]) => void;
}

export interface DataTableProps<T> {
    /** Array of data items to display */
    data: T[];
    /** Column definitions */
    columns: Column<T>[];
    /** Unique key extractor for each row */
    getRowKey: (item: T) => string;
    /** Loading state */
    isLoading?: boolean;
    /** Empty state message */
    emptyMessage?: string;
    /** Optional row click handler */
    onRowClick?: (item: T) => void;
    /** Optional actions column render function */
    renderActions?: (item: T) => React.ReactNode;
    /** Actions column width */
    actionsWidth?: string;
    /**
     * Actions column header. Defaults to the translated "Actions"; pass e.g.
     * `<span className="sr-only">Actions</span>` for an icon-only column.
     */
    actionsHeader?: React.ReactNode;
    /** Additional className for the table container */
    className?: string;

    // ── Filter ──
    /** Placeholder for the filter input */
    filterPlaceholder?: string;
    /** Filter function — receives each item and the current query string, return true to include */
    filterFn?: (item: T, query: string) => boolean;

    // ── Selection + Bulk Actions ──
    /** Enable row selection checkboxes */
    selectable?: boolean;
    /** Bulk actions shown when items are selected */
    bulkActions?: BulkAction[];
}

export function DataTable<T>({
    data,
    columns,
    getRowKey,
    isLoading = false,
    emptyMessage,
    onRowClick,
    renderActions,
    actionsWidth = 'w-[100px]',
    actionsHeader,
    className,
    filterPlaceholder,
    filterFn,
    selectable = false,
    bulkActions,
}: DataTableProps<T>) {
    const { t } = useUiT();
    const effectiveFilterPlaceholder = filterPlaceholder ?? t('dataTable.filterEllipsis');
    const [filter, setFilter] = React.useState('');
    const [selected, setSelected] = React.useState<Set<string>>(new Set());

    const filteredData = React.useMemo(() => {
        if (!filterFn || !filter.trim()) return data;
        return data.filter(item => filterFn(item, filter));
    }, [data, filter, filterFn]);

    const selectableCol = selectable ? 1 : 0;
    const totalColumns = selectableCol + columns.length + (renderActions ? 1 : 0);

    const allKeys = React.useMemo(() => filteredData.map(getRowKey), [filteredData, getRowKey]);
    const allSelected = allKeys.length > 0 && allKeys.every(k => selected.has(k));
    const someSelected = selected.size > 0;

    const toggleAll = () => {
        if (allSelected) {
            setSelected(new Set());
        } else {
            setSelected(new Set(allKeys));
        }
    };

    const toggleRow = (key: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    // Clear selection when data changes (e.g., after bulk delete)
    React.useEffect(() => {
        setSelected(prev => {
            const validKeys = new Set(data.map(getRowKey));
            const filtered = new Set([...prev].filter(k => validKeys.has(k)));
            return filtered.size === prev.size ? prev : filtered;
        });
    }, [data, getRowKey]);

    const showToolbar = filterFn || (selectable && someSelected);

    return (
        <div className={cn('space-y-3', className)}>
            {/* Toolbar: filter + bulk actions */}
            {showToolbar && (
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                        {selectable && someSelected && bulkActions?.map(action => (
                            <Button
                                key={action.key}
                                variant={action.variant || 'outline'}
                                size="sm"
                                onClick={() => action.onClick(Array.from(selected))}
                            >
                                {action.icon}
                                {action.label} ({selected.size})
                            </Button>
                        ))}
                    </div>
                    {filterFn && (
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={effectiveFilterPlaceholder}
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                className="pl-8 w-56"
                            />
                        </div>
                    )}
                </div>
            )}

            <div className="rounded-md border">
                <Table>
                    <TableHeader>
                        <TableRow>
                            {selectable && (
                                <TableHead className="w-10">
                                    <input
                                        type="checkbox"
                                        checked={allSelected}
                                        onChange={toggleAll}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                </TableHead>
                            )}
                            {columns.map((column) => (
                                <TableHead
                                    key={column.key}
                                    className={cn(
                                        column.width,
                                        column.align === 'right' && 'text-right',
                                        column.align === 'center' && 'text-center',
                                        column.className
                                    )}
                                >
                                    {column.header}
                                </TableHead>
                            ))}
                            {renderActions && (
                                <TableHead className={cn(actionsWidth, 'text-right')}>
                                    {actionsHeader ?? t('dataTable.actions')}
                                </TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {isLoading ? (
                            <TableRow>
                                <TableCell colSpan={totalColumns} className="text-center py-8">
                                    <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                                </TableCell>
                            </TableRow>
                        ) : filteredData.length === 0 ? (
                            <TableRow>
                                <TableCell
                                    colSpan={totalColumns}
                                    className="text-center text-muted-foreground py-8"
                                >
                                    {filter
                                        ? t('dataTable.noResultsFor', { filter })
                                        : emptyMessage ?? t('dataTable.noDataFound')}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredData.map((item) => {
                                const key = getRowKey(item);
                                return (
                                    <TableRow
                                        key={key}
                                        className={cn(
                                            onRowClick && 'cursor-pointer hover:bg-muted/50',
                                            selectable && selected.has(key) && 'bg-muted/40'
                                        )}
                                        onClick={() => onRowClick?.(item)}
                                    >
                                        {selectable && (
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(key)}
                                                    onChange={() => toggleRow(key)}
                                                    className="h-4 w-4 rounded border-gray-300"
                                                />
                                            </TableCell>
                                        )}
                                        {columns.map((column) => (
                                            <TableCell
                                                key={column.key}
                                                className={cn(
                                                    column.align === 'right' && 'text-right',
                                                    column.align === 'center' && 'text-center',
                                                    column.className
                                                )}
                                            >
                                                {column.render(item)}
                                            </TableCell>
                                        ))}
                                        {renderActions && (
                                            <TableCell
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <div className="flex justify-end">
                                                    {renderActions(item)}
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                );
                            })
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
