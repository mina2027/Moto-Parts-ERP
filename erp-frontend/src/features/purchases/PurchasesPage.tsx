import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { HandCoins, Package, Plus, ShoppingBag, Truck, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, useListState } from '@/components/shared/data-table';
import { DateRangeInputs, ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { PurchaseFormDialog } from './PurchaseFormDialog';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import { purchaseService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDate, formatDateTime } from '@/lib/utils';
import type { Purchase, PurchaseReturn, PurchaseStatus, SupplierPayment } from '@/types';

export default function PurchasesPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const ls = useListState();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const { supplierName, branchName, userName, options, productName } = useLookups();
  const [newOpen, setNewOpen] = React.useState(!!(location.state as { productId?: string } | null)?.productId);
  const [payOpen, setPayOpen] = React.useState(false);
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();

  const purchasesQuery = { ...ls.query, branchId: canAll ? ls.filters.branchId : branchId, supplierId: ls.filters.supplierId, status: ls.filters.status as PurchaseStatus | undefined, from, to };
  const q = useQuery({ queryKey: ['purchases', ls.query, from, to, canAll], queryFn: () => purchaseService.list(purchasesQuery) });
  const stats = useQuery({ queryKey: ['purchases', 'stats'], queryFn: purchaseService.stats });
  const returns = useQuery({ queryKey: ['purchases', 'returns'], queryFn: () => purchaseService.returns({ pageSize: 50 }) });
  const payments = useQuery({ queryKey: ['purchases', 'payments'], queryFn: () => purchaseService.payments({ pageSize: 50 }) });

  const columns = React.useMemo<ColumnDef<Purchase, unknown>[]>(() => [
    { accessorKey: 'invoiceNumber', header: t('common.invoiceNumber'), cell: ({ row }) => <div><span className="num font-medium text-primary">{row.original.invoiceNumber}</span><div className="text-[10px] text-muted-foreground num">{row.original.supplierInvoiceNumber}</div></div> },
    { id: 'supplier', header: t('common.supplier'), cell: ({ row }) => <Link to={`/suppliers/${row.original.supplierId}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>{supplierName(row.original.supplierId)}</Link> },
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDate(row.original.date, locale)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'items', header: t('common.items'), cell: ({ row }) => <span className="num">{row.original.items.reduce((a, i) => a + i.receivedQty, 0)}/{row.original.items.reduce((a, i) => a + i.quantity, 0)}</span>, meta: { align: 'center' } },
    { accessorKey: 'total', header: t('common.total'), cell: ({ row }) => <Money value={row.original.total} className="font-medium" />, meta: { align: 'end' } },
    { accessorKey: 'paid', header: t('common.paid'), cell: ({ row }) => <Money value={row.original.paid} className="text-success" />, meta: { align: 'end' } },
    { accessorKey: 'remaining', header: t('common.remaining'), cell: ({ row }) => row.original.remaining > 0 ? <Money value={row.original.remaining} className="text-destructive" /> : '—', meta: { align: 'end' } },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="purchases.status" /> },
  ], [t, locale, supplierName, branchName]);
  const retCols = React.useMemo<ColumnDef<PurchaseReturn, unknown>[]>(() => [
    { accessorKey: 'returnNumber', header: t('sales.returnNumber'), cell: ({ row }) => <span className="num font-medium">{row.original.returnNumber}</span> },
    { id: 'po', header: t('common.invoice'), cell: ({ row }) => <Link to={`/purchases/${row.original.purchaseId}`} className="num text-primary hover:underline">{row.original.purchaseId.toUpperCase()}</Link> },
    { id: 'supplier', header: t('common.supplier'), cell: ({ row }) => supplierName(row.original.supplierId) },
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDate(row.original.date, locale)}</span> },
    { id: 'items', header: t('common.items'), cell: ({ row }) => <span className="text-xs">{row.original.items.map((i) => `${productName(i.productId)} ×${i.quantity}`).join('، ')}</span> },
    { accessorKey: 'reason', header: t('common.reason'), cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.reason}</span> },
    { accessorKey: 'total', header: t('common.total'), cell: ({ row }) => <Money value={row.original.total} className="font-medium" />, meta: { align: 'end' } },
  ], [t, locale, supplierName, productName]);
  const payCols = React.useMemo<ColumnDef<SupplierPayment, unknown>[]>(() => [
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'supplier', header: t('common.supplier'), cell: ({ row }) => <Link to={`/suppliers/${row.original.supplierId}`} className="hover:underline">{supplierName(row.original.supplierId)}</Link> },
    { accessorKey: 'reference', header: t('common.reference'), cell: ({ row }) => <span className="num text-xs">{row.original.reference}</span> },
    { accessorKey: 'method', header: t('common.paymentMethod'), cell: ({ row }) => <StatusBadge status={row.original.method} labelKey="sales.methods" /> },
    { id: 'user', header: t('common.user'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { accessorKey: 'amount', header: t('common.amount'), cell: ({ row }) => <Money value={row.original.amount} className="font-medium text-success" />, meta: { align: 'end' } },
  ], [t, locale, supplierName, userName]);

  const exportPayload = async () => {
    const full = await purchaseService.list({ ...purchasesQuery, page: 1, pageSize: 500 });
    return {
      filename: 'purchases',
      title: t('purchases.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.date'), value: from || to ? `${from ? formatDate(from, locale) : '…'} – ${to ? formatDate(to, locale) : '…'}` : t('common.all') },
        { label: t('common.branch'), value: purchasesQuery.branchId ? branchName(purchasesQuery.branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('purchases.title')} subtitle={t('purchases.subtitle')} actions={<><ExportMenu payload={exportPayload} />{hasPermission('purchases.pay') ? <Button variant="outline" onClick={() => setPayOpen(true)}><HandCoins /> {t('purchases.newPayment')}</Button> : null}{hasPermission('purchases.create') ? <Button onClick={() => setNewOpen(true)}><Plus /> {t('purchases.newPurchase')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('purchases.totalPurchases')} value={stats.data?.total ?? 0} icon={<ShoppingBag />} hint={`${stats.data?.count ?? 0} ${t('dashboard.invoices')}`} />
        <StatCard title={t('purchases.outstanding')} value={stats.data?.outstanding ?? 0} icon={<Truck />} variant="destructive" />
        <StatCard title={t('purchases.pendingReceive')} value={stats.data?.pending ?? 0} format="number" icon={<Clock />} variant="warning" onClick={() => ls.setFilter('status', 'ordered')} />
        <StatCard title={t('purchases.returns')} value={returns.data?.total ?? 0} format="number" icon={<Package />} variant="info" />
      </div>
      <Tabs defaultValue="invoices">
        <TabsList><TabsTrigger value="invoices">{t('nav.purchases')}</TabsTrigger><TabsTrigger value="returns">{t('purchases.returns')}</TabsTrigger><TabsTrigger value="payments">{t('purchases.payments')}</TabsTrigger></TabsList>
        <TabsContent value="invoices">
          <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(p) => navigate(`/purchases/${p.id}`)} getRowId={(p) => p.id} dense enableColumnVisibility
            toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount + (from || to ? 1 : 0)} onClear={() => { ls.clearFilters(); setFrom(undefined); setTo(undefined); }}><DateRangeInputs from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /><FilterSelect value={ls.filters.supplierId} onChange={(v) => ls.setFilter('supplierId', v)} options={options.suppliers} allLabel={t('common.supplier')} width="w-48" />{canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}<FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['draft', 'ordered', 'partially_received', 'received', 'cancelled'] as const).map((s) => ({ value: s, label: t(`purchases.status.${s}`) }))} allLabel={t('common.status')} width="w-36" /></FilterBar></>} />
        </TabsContent>
        <TabsContent value="returns"><DataTable columns={retCols} data={returns.data?.data ?? []} isLoading={returns.isLoading} isError={returns.isError} onRetry={returns.refetch} dense /></TabsContent>
        <TabsContent value="payments"><DataTable columns={payCols} data={payments.data?.data ?? []} isLoading={payments.isLoading} isError={payments.isError} onRetry={payments.refetch} dense /></TabsContent>
      </Tabs>
      <PurchaseFormDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => navigate(`/purchases/${id}`)} initialProductId={(location.state as { productId?: string } | null)?.productId} />
      <SupplierPaymentDialog open={payOpen} onOpenChange={setPayOpen} onDone={() => { q.refetch(); payments.refetch(); stats.refetch(); }} />
    </div>
  );
}
