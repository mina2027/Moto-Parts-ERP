import * as React from 'react';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type RowSelectionState, type SortingState, type VisibilityState } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Columns3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/misc';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState, ErrorState, LoadingState } from './states';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  sorting?: SortingState;
  onSortingChange?: (s: SortingState) => void;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  enableSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: (s: RowSelectionState) => void;
  getRowId?: (row: T) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string | undefined;
  toolbar?: React.ReactNode;
  bulkActions?: (selected: T[]) => React.ReactNode;
  enableColumnVisibility?: boolean;
  dense?: boolean;
  className?: string;
  stickyHeader?: boolean;
  footer?: React.ReactNode;
}

export function DataTable<T>({
  columns, data, total, page = 1, pageSize = 20, onPageChange, onPageSizeChange, sorting, onSortingChange, isLoading, isError, onRetry, emptyTitle, emptyDescription, emptyAction,
  enableSelection, rowSelection, onRowSelectionChange, getRowId, onRowClick, rowClassName, toolbar, bulkActions, enableColumnVisibility, dense, className, stickyHeader = true, footer,
}: DataTableProps<T>) {
  const { t } = useT();
  const [internalSorting, setInternalSorting] = React.useState<SortingState>([]);
  const [internalSelection, setInternalSelection] = React.useState<RowSelectionState>({});
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});

  const sortingState = sorting ?? internalSorting;
  const selectionState = rowSelection ?? internalSelection;

  const allColumns = React.useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!enableSelection) return columns;
    const sel: ColumnDef<T, unknown> = {
      id: '__select',
      size: 32,
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => <Checkbox checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? 'indeterminate' : false} onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)} aria-label={t('common.selectAll')} />,
      cell: ({ row }) => <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} onClick={(e) => e.stopPropagation()} aria-label="select" />,
    };
    return [sel, ...columns];
  }, [columns, enableSelection, t]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting: sortingState, rowSelection: selectionState, columnVisibility },
    onSortingChange: (u) => {
      const next = typeof u === 'function' ? u(sortingState) : u;
      if (onSortingChange) onSortingChange(next);
      else setInternalSorting(next);
    },
    onRowSelectionChange: (u) => {
      const next = typeof u === 'function' ? u(selectionState) : u;
      if (onRowSelectionChange) onRowSelectionChange(next);
      else setInternalSelection(next);
    },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: onSortingChange ? undefined : getSortedRowModel(),
    manualSorting: !!onSortingChange,
    manualPagination: true,
    enableRowSelection: !!enableSelection,
    getRowId,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const totalCount = total ?? data.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalCount);
  const cellPad = dense ? 'px-2 py-1' : 'px-3 py-2';

  return (
    <div className={cn('flex flex-col rounded-lg border bg-card', className)}>
      {(toolbar || enableColumnVisibility || (selectedRows.length > 0 && bulkActions)) && (
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          {selectedRows.length > 0 && bulkActions ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{selectedRows.length} {t('common.selected')}</span>
              {bulkActions(selectedRows)}
              <Button size="xs" variant="ghost" onClick={() => table.resetRowSelection()}>{t('common.clear')}</Button>
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-2">{toolbar}</div>
          )}
          {enableColumnVisibility ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="ms-auto">
                  <Columns3 /> {t('common.columns')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>{t('common.columns')}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table.getAllLeafColumns().filter((c) => c.getCanHide()).map((c) => (
                  <DropdownMenuCheckboxItem key={c.id} checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)}>
                    {typeof c.columnDef.header === 'string' ? c.columnDef.header : c.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      )}

      <div className="relative overflow-auto">
        {isLoading ? (
          <LoadingState rows={8} />
        ) : isError ? (
          <ErrorState onRetry={onRetry} />
        ) : data.length === 0 ? (
          <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
        ) : (
          <table className="w-full caption-bottom text-sm">
            <thead className={cn('bg-muted/60 text-xs', stickyHeader && 'sticky top-0 z-10')}>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b">
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    const sorted = h.column.getIsSorted();
                    const meta = h.column.columnDef.meta as { align?: 'start' | 'end' | 'center'; className?: string } | undefined;
                    return (
                      <th key={h.id} style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }} className={cn('h-9 whitespace-nowrap font-medium text-muted-foreground', cellPad, meta?.align === 'end' ? 'text-end' : meta?.align === 'center' ? 'text-center' : 'text-start', meta?.className)}>
                        {h.isPlaceholder ? null : canSort ? (
                          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={h.column.getToggleSortingHandler()}>
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn('border-b transition-colors last:border-0 hover:bg-muted/40 data-[state=selected]:bg-primary/5', onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as { align?: 'start' | 'end' | 'center'; className?: string } | undefined;
                    return (
                      <td key={cell.id} className={cn('align-middle', cellPad, meta?.align === 'end' ? 'text-end' : meta?.align === 'center' ? 'text-center' : 'text-start', meta?.className)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {footer ? <tfoot className="border-t bg-muted/40 font-medium">{footer}</tfoot> : null}
          </table>
        )}
      </div>

      {onPageChange && !isLoading && !isError && totalCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              {t('common.showing')} <span className="num font-medium text-foreground">{start}-{end}</span> {t('common.of')} <span className="num font-medium text-foreground">{totalCount}</span>
            </span>
            {onPageSizeChange ? (
              <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
                <SelectTrigger size="sm" className="h-7 w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-xs" disabled={page <= 1} onClick={() => onPageChange(1)} aria-label="first"><ChevronsRight className="ltr:rotate-180" /></Button>
            <Button variant="outline" size="icon-xs" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="prev"><ChevronRight className="ltr:rotate-180" /></Button>
            <span className="px-2 num">{page} / {pageCount}</span>
            <Button variant="outline" size="icon-xs" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} aria-label="next"><ChevronLeft className="ltr:rotate-180" /></Button>
            <Button variant="outline" size="icon-xs" disabled={page >= pageCount} onClick={() => onPageChange(pageCount)} aria-label="last"><ChevronsLeft className="ltr:rotate-180" /></Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Lightweight hook for list query state (page/pageSize/search/sorting). */
export function useListState(initial: { pageSize?: number; sortBy?: string; sortDir?: 'asc' | 'desc' } = {}) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 20);
  const [search, setSearchRaw] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [sorting, setSorting] = React.useState<SortingState>(initial.sortBy ? [{ id: initial.sortBy, desc: initial.sortDir === 'desc' }] : []);
  const [filters, setFiltersRaw] = React.useState<Record<string, string | undefined>>({});

  React.useEffect(() => {
    const h = setTimeout(() => { setDebounced(search); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [search]);

  const setFilter = React.useCallback((key: string, value: string | undefined) => {
    setFiltersRaw((f) => ({ ...f, [key]: value === 'all' || value === '' ? undefined : value }));
    setPage(1);
  }, []);
  const clearFilters = React.useCallback(() => { setFiltersRaw({}); setSearchRaw(''); setPage(1); }, []);
  const activeFilterCount = Object.values(filters).filter(Boolean).length + (debounced ? 1 : 0);

  const query = React.useMemo(() => ({ page, pageSize, search: debounced || undefined, sortBy: sorting[0]?.id, sortDir: sorting[0] ? (sorting[0].desc ? ('desc' as const) : ('asc' as const)) : undefined, ...filters }), [page, pageSize, debounced, sorting, filters]);

  return { page, setPage, pageSize, setPageSize: (n: number) => { setPageSize(n); setPage(1); }, search, setSearch: setSearchRaw, sorting, setSorting, filters, setFilter, clearFilters, activeFilterCount, query };
}
