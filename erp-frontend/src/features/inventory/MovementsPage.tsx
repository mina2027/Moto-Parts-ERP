import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, useListState } from '@/components/shared/data-table';
import { DateRangeInputs, ExportMenu, FilterBar, FilterSelect, PageHeader, SearchInput } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { Combobox } from '@/components/shared/pickers';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDateTime } from '@/lib/utils';
import type { StockMovement, StockMovementType } from '@/types';

const TYPES: StockMovementType[] = ['sale', 'sale_return', 'purchase', 'purchase_return', 'transfer_in', 'transfer_out', 'adjustment_in', 'adjustment_out', 'damaged', 'count'];

export default function MovementsPage() {
  const { t, locale } = useT();
  const [params] = useSearchParams();
  const ls = useListState({ pageSize: 30 });
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const currentBranch = useAuthStore((s) => s.session!.user.branchId);
  const { options, branchName, warehouseName, userName, productName, warehouses } = useLookups();
  const [productId, setProductId] = React.useState<string | null>(params.get('productId'));
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();
  const branchId = canAll ? ls.filters.branchId : currentBranch;

  const movementsQuery = { ...ls.query, productId: productId ?? undefined, branchId, warehouseId: ls.filters.warehouseId, type: ls.filters.type as StockMovementType | undefined, userId: ls.filters.userId, from, to };
  const q = useQuery({ queryKey: ['movements', ls.query, productId, from, to, branchId], queryFn: () => inventoryService.movements(movementsQuery) });

  const columns = React.useMemo<ColumnDef<StockMovement, unknown>[]>(() => [
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'product', header: t('common.product'), cell: ({ row }) => <Link to={`/products/${row.original.productId}`} className="hover:underline">{productName(row.original.productId)}</Link> },
    { accessorKey: 'type', header: t('inventory.movementType'), cell: ({ row }) => <StatusBadge status={row.original.quantity >= 0 ? 'increase' : 'decrease'} label={t(`inventory.types.${row.original.type}`)} /> },
    { accessorKey: 'quantity', header: t('common.quantity'), cell: ({ row }) => <span className={`num font-semibold ${row.original.quantity >= 0 ? 'text-success' : 'text-destructive'}`}>{row.original.quantity > 0 ? '+' : ''}{row.original.quantity}</span>, meta: { align: 'end' } },
    { accessorKey: 'previousStock', header: t('inventory.previousStock'), cell: ({ row }) => <span className="num text-muted-foreground">{row.original.previousStock}</span>, meta: { align: 'end' } },
    { accessorKey: 'newStock', header: t('inventory.newStock'), cell: ({ row }) => <span className="num font-medium">{row.original.newStock}</span>, meta: { align: 'end' } },
    { id: 'user', header: t('common.user'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'warehouse', header: t('common.warehouse'), cell: ({ row }) => <span className="text-xs">{warehouseName(row.original.warehouseId)}</span> },
    { accessorKey: 'reference', header: t('common.reference'), cell: ({ row }) => <span className="num text-xs">{row.original.reference}</span> },
  ], [t, locale, productName, userName, branchName, warehouseName]);

  const exportPayload = async () => {
    const full = await inventoryService.movements({ ...movementsQuery, page: 1, pageSize: 500 });
    return {
      filename: 'stock-movements',
      title: t('inventory.movements'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.date'), value: from || to ? `${from ? formatDateTime(from, locale) : '…'} – ${to ? formatDateTime(to, locale) : '…'}` : t('common.all') },
        { label: t('common.branch'), value: branchId ? branchName(branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('inventory.movements')} subtitle={t('inventory.subtitle')} backTo="/inventory" actions={<ExportMenu payload={exportPayload} />} />
      <DataTable
        columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} dense enableColumnVisibility
        toolbar={<>
          <SearchInput value={ls.search} onChange={ls.setSearch} />
          <div className="w-64"><Combobox value={productId} onChange={(v) => { setProductId(v); ls.setPage(1); }} options={options.products} placeholder={t('common.selectProduct')} allowClear size="sm" /></div>
          <FilterBar activeCount={ls.activeFilterCount + (productId ? 1 : 0) + (from || to ? 1 : 0)} onClear={() => { ls.clearFilters(); setProductId(null); setFrom(undefined); setTo(undefined); }}>
            <DateRangeInputs from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} />
            <FilterSelect value={ls.filters.type} onChange={(v) => ls.setFilter('type', v)} options={TYPES.map((k) => ({ value: k, label: t(`inventory.types.${k}`) }))} allLabel={t('inventory.movementType')} />
            {canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}
            <FilterSelect value={ls.filters.warehouseId} onChange={(v) => ls.setFilter('warehouseId', v)} options={warehouses.filter((w) => !branchId || w.branchId === branchId).map((w) => ({ value: w.id, label: w.code }))} allLabel={t('common.warehouse')} width="w-36" />
            <FilterSelect value={ls.filters.userId} onChange={(v) => ls.setFilter('userId', v)} options={options.users} allLabel={t('common.user')} />
          </FilterBar>
        </>}
      />
    </div>
  );
}
