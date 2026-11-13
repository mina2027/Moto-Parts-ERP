import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Receipt, TrendingUp, Wallet, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, useListState } from '@/components/shared/data-table';
import { DateRangeInputs, ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { salesService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDateTime } from '@/lib/utils';
import type { PaymentMethod, Sale, SaleStatus, SaleType } from '@/types';

export default function SalesListPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const ls = useListState({ pageSize: 20 });
  const { branchName, userName, customerName, options } = useLookups();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();

  const effectiveBranch = canAll ? (ls.filters.branchId as string | undefined) : branchId;
  const q = useQuery({ queryKey: ['sales', ls.query, effectiveBranch, from, to], queryFn: () => salesService.list({ ...ls.query, branchId: effectiveBranch, from, to, cashierId: ls.filters.cashierId as string | undefined, status: ls.filters.status as SaleStatus | undefined, type: ls.filters.type as SaleType | undefined, method: ls.filters.method as PaymentMethod | undefined }) });

  const stats = useQuery({ queryKey: ['sales', 'stats', effectiveBranch], queryFn: () => salesService.stats(effectiveBranch) });

  const columns = React.useMemo<ColumnDef<Sale, unknown>[]>(() => [
    { accessorKey: 'invoiceNumber', header: t('common.invoiceNumber'), cell: ({ row }) => <Link to={`/sales/${row.original.id}`} className="num font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{row.original.invoiceNumber}</Link> },
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'cashier', header: t('common.cashier'), cell: ({ row }) => <span className="text-xs">{userName(row.original.cashierId)}</span> },
    { id: 'customer', header: t('common.customer'), cell: ({ row }) => <span className="text-xs">{customerName(row.original.customerId) ?? <span className="text-muted-foreground">{t('common.walkIn')}</span>}</span> },
    { id: 'items', header: t('common.items'), cell: ({ row }) => <span className="num">{row.original.items.reduce((a, i) => a + i.quantity, 0)}</span>, meta: { align: 'center' }, size: 60 },
    { accessorKey: 'total', header: t('common.total'), cell: ({ row }) => <Money value={row.original.total} className="font-medium" />, meta: { align: 'end' } },
    { accessorKey: 'remaining', header: t('common.remaining'), cell: ({ row }) => row.original.remaining > 0 ? <Money value={row.original.remaining} className="text-destructive" /> : <span className="text-muted-foreground">—</span>, meta: { align: 'end' } },
    { id: 'method', header: t('common.paymentMethod'), cell: ({ row }) => { const s = row.original; const m = s.type === 'credit' && s.payments.length === 0 ? 'credit' : s.payments.length > 1 ? 'mixed' : s.payments[0]?.method ?? 'credit'; return <StatusBadge status={m} labelKey="sales.methods" />; } },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="sales.status" /> },
  ], [t, locale, branchName, userName, customerName]);

  const salesQuery = { ...ls.query, branchId: effectiveBranch, from, to, cashierId: ls.filters.cashierId as string | undefined, status: ls.filters.status as SaleStatus | undefined, type: ls.filters.type as SaleType | undefined, method: ls.filters.method as PaymentMethod | undefined };
  const exportPayload = async () => {
    const full = await salesService.list({ ...salesQuery, page: 1, pageSize: 500 });
    return {
      filename: 'sales',
      title: t('sales.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.date'), value: from || to ? `${from ? formatDateTime(from, locale) : '…'} – ${to ? formatDateTime(to, locale) : '…'}` : t('common.all') },
        { label: t('common.branch'), value: effectiveBranch ? branchName(effectiveBranch) : t('common.allBranches') },
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('sales.title')} subtitle={t('sales.subtitle')} actions={<><ExportMenu payload={exportPayload} />{hasPermission('returns.create') ? <Button variant="outline" asChild><Link to="/sales/returns"><Undo2 /> {t('sales.returns')}</Link></Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('sales.totalInvoices')} value={stats.data?.count ?? 0} format="number" icon={<Receipt />} />
        <StatCard title={t('sales.totalSales')} value={stats.data?.total ?? 0} icon={<TrendingUp />} variant="success" />
        <StatCard title={t('sales.avgInvoice')} value={stats.data?.avg ?? 0} icon={<Wallet />} variant="info" />
        <StatCard title={t('sales.cashVsCredit')} value={`${stats.data?.cash ?? 0} / ${stats.data?.credit ?? 0}`} icon={<Receipt />} variant="warning" />
      </div>
      <DataTable
        columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize}
        isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(s) => navigate(`/sales/${s.id}`)} getRowId={(s) => s.id} enableColumnVisibility dense
        toolbar={
          <>
            <SearchInput value={ls.search} onChange={ls.setSearch} placeholder={t('sales.searchInvoice')} />
            <FilterBar activeCount={ls.activeFilterCount + (from || to ? 1 : 0)} onClear={() => { ls.clearFilters(); setFrom(undefined); setTo(undefined); }}>
              <DateRangeInputs from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); ls.setPage(1); }} />
              {canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}
              <FilterSelect value={ls.filters.cashierId} onChange={(v) => ls.setFilter('cashierId', v)} options={options.users} placeholder={t('common.cashier')} allLabel={t('common.cashier')} />
              <FilterSelect value={ls.filters.method} onChange={(v) => ls.setFilter('method', v)} options={(['cash', 'card', 'bank_transfer', 'credit'] as const).map((k) => ({ value: k, label: t(`sales.methods.${k}`) }))} allLabel={t('common.paymentMethod')} width="w-36" />
              <FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['completed', 'cancelled', 'returned', 'partially_returned'] as const).map((k) => ({ value: k, label: t(`sales.status.${k}`) }))} allLabel={t('common.status')} width="w-36" />
            </FilterBar>
          </>
        }
      />
    </div>
  );
}
