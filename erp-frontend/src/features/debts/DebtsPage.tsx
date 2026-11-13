import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, Clock, HandCoins, MessageCircle, Percent, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ChartCard, DonutChart } from '@/components/shared/charts';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import { SendWhatsAppDialog } from '@/features/whatsapp/SendWhatsAppDialog';
import { customerService } from '@/services';
import type { DebtRow } from '@/services/customerService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { cn, formatDate, formatDateTime } from '@/lib/utils';
import type { CustomerPayment, DebtStatus } from '@/types';

export default function DebtsPage() {
  const { t, locale } = useT();
  const ls = useListState({ pageSize: 25 });
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const { customers, customerName, branchName, userName, options } = useLookups();
  const [pay, setPay] = React.useState<DebtRow | null>(null);
  const [wa, setWa] = React.useState<DebtRow | null>(null);
  const effBranch = canAll ? ls.filters.branchId : branchId;
  const debtsQuery = { ...ls.query, branchId: effBranch, status: ls.filters.status as DebtStatus | undefined, customerId: ls.filters.customerId };
  const q = useQuery({ queryKey: ['debts', ls.query, effBranch], queryFn: () => customerService.debts(debtsQuery) });
  const stats = useQuery({ queryKey: ['debts', 'stats', effBranch], queryFn: () => customerService.debtStats(effBranch) });
  const payments = useQuery({ queryKey: ['debts', 'payments', effBranch], queryFn: () => customerService.payments({ branchId: effBranch, pageSize: 50 }) });

  const aging = stats.data ? [
    { name: { ar: 'جاري', en: 'Current' }, value: stats.data.aging.current, color: '#16a34a' }, { name: { ar: '1-30 يوم', en: '1-30 days' }, value: stats.data.aging.d1_30, color: '#84cc16' },
    { name: { ar: '31-60 يوم', en: '31-60 days' }, value: stats.data.aging.d31_60, color: '#f59e0b' }, { name: { ar: '61-90 يوم', en: '61-90 days' }, value: stats.data.aging.d61_90, color: '#ea580c' }, { name: { ar: '+90 يوم', en: '90+ days' }, value: stats.data.aging.d90, color: '#dc2626' },
  ].filter((x) => x.value > 0) : [];

  const columns = React.useMemo<ColumnDef<DebtRow, unknown>[]>(() => [
    { id: 'customer', header: t('common.customer'), cell: ({ row }) => <Link to={`/customers/${row.original.customerId}`} className="font-medium hover:underline">{customerName(row.original.customerId)}</Link> },
    { accessorKey: 'invoiceNumber', header: t('common.invoice'), cell: ({ row }) => <Link to={`/sales/${row.original.saleId}`} className="num text-primary hover:underline">{row.original.invoiceNumber}</Link> },
    { accessorKey: 'invoiceDate', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDate(row.original.invoiceDate, locale)}</span> },
    { accessorKey: 'dueDate', header: t('common.dueDate'), cell: ({ row }) => <span className={cn('num text-xs', row.original.daysOverdue > 0 && row.original.remaining > 0 && 'font-medium text-destructive')}>{formatDate(row.original.dueDate, locale)}</span> },
    { accessorKey: 'originalAmount', header: t('debts.originalAmount'), cell: ({ row }) => <Money value={row.original.originalAmount} />, meta: { align: 'end' } },
    { accessorKey: 'paidAmount', header: t('debts.paidAmount'), cell: ({ row }) => <Money value={row.original.paidAmount} className="text-success" />, meta: { align: 'end' } },
    { accessorKey: 'remaining', header: t('common.remaining'), cell: ({ row }) => <Money value={row.original.remaining} className={cn('font-semibold', row.original.remaining > 0 && 'text-destructive')} />, meta: { align: 'end' } },
    { accessorKey: 'daysOverdue', header: t('debts.daysOverdue'), cell: ({ row }) => row.original.remaining > 0 && row.original.daysOverdue > 0 ? <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold num', row.original.daysOverdue > 60 ? 'bg-destructive/15 text-destructive' : row.original.daysOverdue > 30 ? 'bg-orange-500/15 text-orange-600' : 'bg-warning/15 text-amber-700')}><AlertTriangle className="size-3" />{row.original.daysOverdue}</span> : <span className="text-muted-foreground">—</span>, meta: { align: 'center' } },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="debts.status" /> },
    { id: 'actions', header: '', cell: ({ row }) => row.original.remaining > 0 ? <div className="flex justify-end gap-1">{hasPermission('whatsapp.send') ? <Button size="xs" variant="ghost" onClick={() => setWa(row.original)} title={t('debts.sendReminder')}><MessageCircle /></Button> : null}<Button size="xs" variant="outline" onClick={() => setPay(row.original)}><HandCoins /> {t('debts.recordPayment')}</Button></div> : null },
  ], [t, locale, customerName, branchName, hasPermission]);
  const payCols = React.useMemo<ColumnDef<CustomerPayment, unknown>[]>(() => [
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'customer', header: t('common.customer'), cell: ({ row }) => <Link to={`/customers/${row.original.customerId}`} className="hover:underline">{customerName(row.original.customerId)}</Link> },
    { accessorKey: 'reference', header: t('common.reference'), cell: ({ row }) => <span className="num text-xs">{row.original.reference}</span> },
    { accessorKey: 'method', header: t('common.paymentMethod'), cell: ({ row }) => <StatusBadge status={row.original.method} labelKey="sales.methods" /> },
    { id: 'user', header: t('common.user'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { accessorKey: 'amount', header: t('common.amount'), cell: ({ row }) => <Money value={row.original.amount} className="font-medium text-success" />, meta: { align: 'end' } },
  ], [t, locale, customerName, userName, branchName]);

  const exportPayload = async () => {
    const full = await customerService.debts({ ...debtsQuery, page: 1, pageSize: 500 });
    return {
      filename: 'debts',
      title: t('debts.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.branch'), value: effBranch ? branchName(effBranch) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('debts.title')} subtitle={t('debts.subtitle')} actions={<ExportMenu payload={exportPayload} />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title={t('debts.totalDebt')} value={stats.data?.total ?? 0} icon={<Wallet />} />
        <StatCard title={t('debts.paid')} value={stats.data?.paid ?? 0} icon={<HandCoins />} variant="success" />
        <StatCard title={t('debts.remaining')} value={stats.data?.remaining ?? 0} icon={<Wallet />} variant="destructive" />
        <StatCard title={t('debts.overdue')} value={stats.data?.overdue ?? 0} icon={<AlertTriangle />} variant="destructive" hint={`${stats.data?.overdueCount ?? 0} ${t('debts.overdueCount')}`} onClick={() => ls.setFilter('status', 'overdue')} />
        <StatCard title={t('debts.dueSoon')} value={stats.data?.dueSoon ?? 0} icon={<Clock />} variant="warning" hint={`${stats.data?.dueSoonCount ?? 0} ${t('common.invoice')}`} />
      </div>
      <div className="grid gap-3 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <Tabs defaultValue="debts">
            <TabsList><TabsTrigger value="debts">{t('nav.debts')}</TabsTrigger><TabsTrigger value="payments">{t('debts.paymentHistory')}</TabsTrigger></TabsList>
            <TabsContent value="debts">
              <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} getRowId={(d) => d.id} dense enableColumnVisibility rowClassName={(d) => (d.status === 'overdue' ? 'bg-destructive/[0.03]' : undefined)}
                toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}><FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['open', 'partial', 'overdue', 'paid'] as const).map((s) => ({ value: s, label: t(`debts.status.${s}`) }))} allLabel={t('common.status')} width="w-36" /><FilterSelect value={ls.filters.customerId} onChange={(v) => ls.setFilter('customerId', v)} options={options.customers} allLabel={t('common.customer')} width="w-48" />{canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}</FilterBar></>} />
            </TabsContent>
            <TabsContent value="payments"><DataTable columns={payCols} data={payments.data?.data ?? []} isLoading={payments.isLoading} isError={payments.isError} onRetry={payments.refetch} dense /></TabsContent>
          </Tabs>
        </div>
        <div className="space-y-3">
          <ChartCard title={t('debts.aging')}>{aging.length ? <DonutChart data={aging} height={160} /> : <div className="py-8 text-center text-xs text-muted-foreground">{t('common.noData')}</div>}</ChartCard>
          <div className="rounded-lg border bg-card p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Percent className="size-3.5" /> {t('debts.collectionRate')}</div><div className="mt-1 text-2xl font-semibold num">{stats.data?.collectionRate ?? 0}%</div><div className="mt-2 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-success" style={{ width: `${stats.data?.collectionRate ?? 0}%` }} /></div></div>
        </div>
      </div>
      {pay ? <RecordPaymentDialog open onOpenChange={(o) => !o && setPay(null)} customerId={pay.customerId} customerName={customerName(pay.customerId) ?? ''} debt={pay} maxAmount={pay.remaining} onDone={() => { q.refetch(); stats.refetch(); payments.refetch(); }} /> : null}
      {wa ? <SendWhatsAppDialog open onOpenChange={(o) => !o && setWa(null)} customer={customers.find((c) => c.id === wa.customerId)} defaultTemplate="debt_reminder" /> : null}
    </div>
  );
}
