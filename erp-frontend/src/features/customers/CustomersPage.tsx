import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, Users, HandCoins, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { Progress } from '@/components/ui/misc';
import { CustomerFormDialog } from './CustomerFormDialog';
import { customerService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import type { Customer } from '@/types';
import { cn } from '@/lib/utils';

export default function CustomersPage() {
  const { t, tx } = useT();
  const navigate = useNavigate();
  const ls = useListState({ pageSize: 20 });
  const { branchName, options } = useLookups();
  const canEdit = useAuthStore((s) => s.hasPermission('customers.edit'));
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const [formOpen, setFormOpen] = React.useState(false);

  const customersQuery = { ...ls.query, branchId: canAll ? (ls.filters.branchId as string | undefined) : branchId, type: ls.filters.type as Customer['type'] | undefined, hasDebt: ls.filters.hasDebt === 'yes' };
  const q = useQuery({ queryKey: ['customers', ls.query, canAll ? null : branchId], queryFn: () => customerService.list(customersQuery) });
  const stats = useQuery({ queryKey: ['debts', 'stats', canAll ? null : branchId], queryFn: () => customerService.debtStats(canAll ? undefined : branchId) });

  const columns = React.useMemo<ColumnDef<Customer, unknown>[]>(() => [
    { accessorKey: 'code', header: t('common.code'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.code}</span>, size: 80 },
    { id: 'name', header: t('common.name'), cell: ({ row }) => <div><div className="font-medium">{tx(row.original.name)}</div><div className="text-xs text-muted-foreground num">{row.original.phone}</div></div> },
    { accessorKey: 'type', header: t('common.type'), cell: ({ row }) => <StatusBadge status={row.original.type} labelKey="customers.types" />, size: 100 },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { accessorKey: 'balance', header: t('common.balance'), cell: ({ row }) => <Money value={row.original.balance} className={cn('font-medium', row.original.balance > 0 && 'text-destructive')} />, meta: { align: 'end' } },
    { id: 'credit', header: t('customers.creditUsage'), cell: ({ row }) => { const c = row.original; if (!c.creditLimit) return <span className="text-xs text-muted-foreground">—</span>; const pct = (c.balance / c.creditLimit) * 100; return <div className="w-28"><Progress value={pct} color={pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-success'} /><div className="mt-0.5 text-[10px] text-muted-foreground num">{Math.round(pct)}% / <Money value={c.creditLimit} compact /></div></div>; } },
    { accessorKey: 'isActive', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'active' : 'inactive'} label={row.original.isActive ? t('common.active') : t('common.inactive')} />, size: 90 },
  ], [t, tx, branchName]);

  const exportPayload = async () => {
    const full = await customerService.list({ ...customersQuery, page: 1, pageSize: 500 });
    return {
      filename: 'customers',
      title: t('customers.title'),
      columns: columnsToExport(columns, ['act', 'actions', 'select', 'credit']),
      rows: full.data,
      meta: [
        { label: t('common.branch'), value: customersQuery.branchId ? branchName(customersQuery.branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('customers.title')} subtitle={t('customers.subtitle')} actions={<><ExportMenu payload={exportPayload} />{canEdit ? <Button onClick={() => setFormOpen(true)}><Plus /> {t('customers.addCustomer')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard title={t('customers.title')} value={q.data?.total ?? 0} format="number" icon={<Users />} />
        <StatCard title={t('debts.remaining')} value={stats.data?.remaining ?? 0} icon={<HandCoins />} variant="destructive" />
        <StatCard title={t('debts.overdueCount')} value={stats.data?.overdueCount ?? 0} format="number" icon={<Store />} variant="warning" />
      </div>
      <DataTable
        columns={columns}
        data={q.data?.data ?? []}
        total={q.data?.total}
        page={ls.page}
        pageSize={ls.pageSize}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={q.refetch}
        onRowClick={(c) => navigate(`/customers/${c.id}`)}
        getRowId={(c) => c.id}
        enableColumnVisibility
        toolbar={
          <>
            <SearchInput value={ls.search} onChange={ls.setSearch} />
            <FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}>
              <FilterSelect value={ls.filters.type} onChange={(v) => ls.setFilter('type', v)} options={(['retail', 'wholesale', 'workshop'] as const).map((k) => ({ value: k, label: t(`customers.types.${k}`) }))} width="w-32" />
              {canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}
              <FilterSelect value={ls.filters.hasDebt} onChange={(v) => ls.setFilter('hasDebt', v)} options={[{ value: 'yes', label: t('debts.title') }]} allLabel={t('common.all')} width="w-36" />
            </FilterBar>
          </>
        }
      />
      <CustomerFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={() => q.refetch()} />
    </div>
  );
}
