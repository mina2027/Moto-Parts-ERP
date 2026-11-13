import * as React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu, FilterSelect, Money, PageHeader, SearchInput, Section, StatCard } from '@/components/shared/page';
import { DatePresetBar, useRangeState } from '@/components/shared/date-preset';
import { ChartCard, NamedBarChart, SalesProfitChart, SimpleLineChart } from '@/components/shared/charts';
import { StatusBadge, StockBadge } from '@/components/shared/status-badge';
import { Combobox } from '@/components/shared/pickers';
import { LoadingState } from '@/components/shared/states';
import { REPORTS, type ReportKey } from './ReportsPage';
import { branchService, customerService, inventoryService, purchaseService, reportService, salesService, supplierService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { productCategoryIds } from '@moto/shared';
import { formatDate, formatDateTime, formatNumber, matchSearch, paginate, round2 } from '@/lib/utils';
import { columnsToExport } from '@/lib/tableExport';
import type { NamedValue } from '@/types';

type Row = Record<string, unknown>;
const col = (id: string, header: string, cell: (r: Row) => React.ReactNode, align?: 'end' | 'center'): ColumnDef<Row, unknown> => ({ id, header, cell: ({ row }) => cell(row.original), meta: { align } });

export default function ReportViewPage() {
  const { key } = useParams<{ key: ReportKey }>();
  const { t, tx, locale } = useT();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName, userName, customerName, supplierName, productName, categoryName, expenseCategoryName, registerName, options, product } = useLookups();
  const [range, setRange] = useRangeState('month');
  const [run, setRun] = React.useState(0);
  const [groupBy, setGroupBy] = React.useState<'day' | 'cashier' | 'branch' | 'product' | 'category'>('day');
  const [employeeId, setEmployeeId] = React.useState<string>();
  const [productId, setProductId] = React.useState<string | null>(null);
  const [customerId, setCustomerId] = React.useState<string>();
  const [supplierId, setSupplierId] = React.useState<string>();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const pageSize = 25;
  const meta = REPORTS.find((r) => r.key === key);
  const f = { from: range.from, to: range.to, branchId: range.branchId };
  const enabled = run > 0;

  const q = useQuery({
    queryKey: ['report', key, f, groupBy, employeeId, productId, customerId, supplierId, run],
    enabled: enabled && !!meta,
    queryFn: async (): Promise<{ rows: Row[]; totals?: Row; series?: unknown; chart?: NamedValue[] }> => {
      switch (key) {
        case 'sales': case 'profit': { const r = await reportService.salesReport({ ...f, cashierId: employeeId, customerId, groupBy }); const d = await reportService.dashboard(f); return { rows: r.rows as unknown as Row[], totals: r.totals as unknown as Row, series: d.salesSeries }; }
        case 'topProducts': { const d = await reportService.dashboard(f); const r = await reportService.salesReport({ ...f, groupBy: 'product' }); return { rows: r.rows as unknown as Row[], chart: d.topProducts.map((p) => ({ name: p.product.name, value: p.revenue })) }; }
        case 'returns': { const r = await salesService.returns({ ...f, pageSize: 500 }); return { rows: r.data as unknown as Row[] }; }
        case 'purchases': { const r = await purchaseService.list({ ...f, supplierId, pageSize: 500 }); return { rows: r.data as unknown as Row[], totals: { total: r.data.reduce((a, p) => a + p.total, 0), paid: r.data.reduce((a, p) => a + p.paid, 0), remaining: r.data.reduce((a, p) => a + p.remaining, 0) } }; }
        case 'inventory': { const r = await inventoryService.overview(f.branchId); return { rows: r.rows as unknown as Row[], totals: { value: r.totalValue, qty: r.totalQty } }; }
        case 'lowStock': { const r = await inventoryService.overview(f.branchId); return { rows: r.rows.filter((x) => x.status !== 'in') as unknown as Row[] }; }
        case 'productMovement': { if (!productId) return { rows: [] }; const r = await inventoryService.movements({ productId, ...f, pageSize: 500 }); return { rows: r.data as unknown as Row[] }; }
        case 'customerDebts': { const r = await customerService.debts({ branchId: f.branchId, customerId, pageSize: 500 }); const s = await customerService.debtStats(f.branchId); return { rows: r.data.filter((d) => d.remaining > 0) as unknown as Row[], totals: s as unknown as Row }; }
        case 'supplierBalances': { const r = await supplierService.debtOverview(); return { rows: r.suppliers as unknown as Row[], totals: { total: r.totalPayable } }; }
        case 'expenses': { const r = await branchService.expenses({ ...f, pageSize: 500, status: 'approved' }); const s = await branchService.expenseStats(f.branchId); return { rows: r.data as unknown as Row[], totals: { total: r.data.reduce((a, e) => a + e.amount, 0) }, chart: s.byCategory }; }
        case 'cashRegisters': { const r = await branchService.sessions({ branchId: f.branchId, pageSize: 500 }); const rows = r.data.filter((s) => s.openedAt >= f.from && s.openedAt <= f.to); return { rows: rows as unknown as Row[], totals: { shortage: rows.reduce((a, s) => a + Math.min(0, s.difference ?? 0), 0), overage: rows.reduce((a, s) => a + Math.max(0, s.difference ?? 0), 0) } }; }
        case 'employees': { const r = await reportService.employeePerformance(f); return { rows: r as unknown as Row[], chart: r.slice(0, 8).map((e) => ({ name: e.user.fullName, value: e.revenue })) }; }
        case 'branchPerformance': { const r = await branchService.performance(); return { rows: r as unknown as Row[], chart: r.map((b) => ({ name: b.branch.name, value: b.revenue })) }; }
        default: return { rows: [] };
      }
    },
  });
  React.useEffect(() => { setRun(1); }, []); // auto-run first time
  React.useEffect(() => setPage(1), [search, run]);

  if (!meta) return <Navigate to="/reports" replace />;
  if (meta.permission && !hasPermission(meta.permission)) return <Navigate to="/reports" replace />;

  const canCost = hasPermission('prices.view_cost');
  const m = (v: unknown) => <Money value={Number(v) || 0} />;
  const columns = ((): ColumnDef<Row, unknown>[] => {
    switch (key) {
      case 'sales': case 'profit': return [col('label', groupBy === 'day' ? t('common.date') : groupBy === 'cashier' ? t('common.cashier') : groupBy === 'branch' ? t('common.branch') : groupBy === 'product' ? t('common.product') : t('common.category'), (r) => tx(r.label as { ar: string; en: string })), col('invoices', t('dashboard.invoices'), (r) => <span className="num">{String(r.invoices)}</span>, 'end'), col('qty', t('common.quantity'), (r) => <span className="num">{String(r.qty)}</span>, 'end'), col('sales', t('sales.totalSales'), (r) => m(r.sales), 'end'), ...(canCost ? [col('cost', t('accounting.cogs'), (r) => m(r.cost), 'end'), col('profit', t('common.profit'), (r) => <span className="font-medium text-success">{m(r.profit)}</span>, 'end'), col('margin', t('common.margin'), (r) => <span className="num text-xs">{Number(r.cost) + Number(r.profit) ? ((Number(r.profit) / (Number(r.cost) + Number(r.profit))) * 100).toFixed(1) : 0}%</span>, 'end')] : [])];
      case 'topProducts': return [col('rank', '#', (r) => <span className="text-muted-foreground">{(q.data?.rows.indexOf(r) ?? 0) + 1}</span>), col('label', t('common.product'), (r) => <Link to={`/products/${r.key}`} className="hover:underline">{tx(r.label as { ar: string; en: string })}</Link>), col('qty', t('dashboard.qtySold'), (r) => <span className="num">{String(r.qty)}</span>, 'end'), col('sales', t('common.revenue'), (r) => m(r.sales), 'end'), ...(canCost ? [col('profit', t('common.profit'), (r) => m(r.profit), 'end')] : [])];
      case 'returns': return [col('returnNumber', t('sales.returnNumber'), (r) => <span className="num">{String(r.returnNumber)}</span>), col('invoice', t('sales.originalInvoice'), (r) => <Link to={`/sales/${r.saleId}`} className="num text-primary hover:underline">{String(r.invoiceNumber)}</Link>), col('date', t('common.date'), (r) => <span className="num text-xs">{formatDateTime(r.date as string, locale)}</span>), col('branch', t('common.branch'), (r) => branchName(r.branchId as string)), col('customer', t('common.customer'), (r) => customerName(r.customerId as string) ?? t('common.walkIn')), col('reason', t('common.reason'), (r) => (r.items as { reason: string }[]).map((i) => t(`sales.reasons.${i.reason}`)).join('، ')), col('refund', t('sales.refundAmount'), (r) => m(r.refundAmount), 'end')];
      case 'purchases': return [col('inv', t('common.invoiceNumber'), (r) => <Link to={`/purchases/${r.id}`} className="num text-primary hover:underline">{String(r.invoiceNumber)}</Link>), col('supplier', t('common.supplier'), (r) => supplierName(r.supplierId as string)), col('date', t('common.date'), (r) => <span className="num text-xs">{formatDate(r.date as string, locale)}</span>), col('branch', t('common.branch'), (r) => branchName(r.branchId as string)), col('total', t('common.total'), (r) => m(r.total), 'end'), col('paid', t('common.paid'), (r) => m(r.paid), 'end'), col('remaining', t('common.remaining'), (r) => m(r.remaining), 'end'), col('status', t('common.status'), (r) => <StatusBadge status={r.status as string} labelKey="purchases.status" />)];
      case 'inventory': case 'lowStock': return [col('product', t('common.product'), (r) => <Link to={`/products/${r.productId}`} className="hover:underline">{productName(r.productId as string)}</Link>), col('cat', t('common.category'), (r) => productCategoryIds(product(r.productId as string)).map(categoryName).join('، ')), col('qty', t('common.quantity'), (r) => <span className="num font-medium">{String(r.quantity)}</span>, 'end'), col('min', t('products.minStock'), (r) => <span className="num text-muted-foreground">{String(r.minStock)}</span>, 'end'), ...(key === 'lowStock' ? [col('short', t('inventory.shortageQty'), (r) => <span className="num text-destructive">{Math.max(0, Number(r.minStock) - Number(r.quantity))}</span>, 'end')] : []), ...(canCost ? [col('value', t('common.value'), (r) => m(r.value), 'end')] : []), col('status', t('common.status'), (r) => <StockBadge qty={Number(r.quantity)} min={Number(r.minStock)} />)];
      case 'productMovement': return [col('date', t('common.date'), (r) => <span className="num text-xs">{formatDateTime(r.date as string, locale)}</span>), col('type', t('common.type'), (r) => <StatusBadge status={Number(r.quantity) >= 0 ? 'increase' : 'decrease'} label={t(`inventory.types.${r.type}`)} />), col('qty', t('common.quantity'), (r) => <span className={`num font-medium ${Number(r.quantity) >= 0 ? 'text-success' : 'text-destructive'}`}>{Number(r.quantity) > 0 ? '+' : ''}{String(r.quantity)}</span>, 'end'), col('prev', t('inventory.previousStock'), (r) => <span className="num">{String(r.previousStock)}</span>, 'end'), col('new', t('inventory.newStock'), (r) => <span className="num">{String(r.newStock)}</span>, 'end'), col('branch', t('common.branch'), (r) => branchName(r.branchId as string)), col('user', t('common.user'), (r) => userName(r.userId as string)), col('ref', t('common.reference'), (r) => <span className="num text-xs">{String(r.reference)}</span>)];
      case 'customerDebts': return [col('customer', t('common.customer'), (r) => <Link to={`/customers/${r.customerId}`} className="hover:underline">{customerName(r.customerId as string)}</Link>), col('inv', t('common.invoice'), (r) => <span className="num">{String(r.invoiceNumber)}</span>), col('date', t('common.date'), (r) => <span className="num text-xs">{formatDate(r.invoiceDate as string, locale)}</span>), col('due', t('common.dueDate'), (r) => <span className="num text-xs">{formatDate(r.dueDate as string, locale)}</span>), col('orig', t('debts.originalAmount'), (r) => m(r.originalAmount), 'end'), col('paid', t('debts.paidAmount'), (r) => m(r.paidAmount), 'end'), col('rem', t('common.remaining'), (r) => <span className="font-medium text-destructive">{m(r.remaining)}</span>, 'end'), col('days', t('debts.daysOverdue'), (r) => <span className="num">{Number(r.daysOverdue) || '—'}</span>, 'center'), col('status', t('common.status'), (r) => <StatusBadge status={r.status as string} labelKey="debts.status" />)];
      case 'supplierBalances': return [col('supplier', t('common.supplier'), (r) => <Link to={`/suppliers/${r.id}`} className="hover:underline">{tx(r.name as { ar: string; en: string })}</Link>), col('contact', t('suppliers.contactPerson'), (r) => tx(r.contactPerson as { ar: string; en: string })), col('phone', t('common.phone'), (r) => <span className="num text-xs">{String(r.phone)}</span>), col('terms', t('suppliers.paymentTerms'), (r) => <span className="num">{String(r.paymentTermsDays)} {t('common.days')}</span>, 'center'), col('balance', t('suppliers.balance'), (r) => <span className="font-medium text-destructive">{m(r.balance)}</span>, 'end')];
      case 'expenses': return [col('date', t('common.date'), (r) => <span className="num text-xs">{formatDate(r.date as string, locale)}</span>), col('cat', t('expenses.category'), (r) => expenseCategoryName(r.categoryId as string)), col('desc', t('common.description'), (r) => tx(r.description as { ar: string; en: string })), col('branch', t('common.branch'), (r) => branchName(r.branchId as string)), col('user', t('common.user'), (r) => userName(r.userId as string)), col('amount', t('common.amount'), (r) => m(r.amount), 'end')];
      case 'cashRegisters': return [col('reg', t('cash.registers'), (r) => registerName(r.registerId as string)), col('user', t('common.user'), (r) => userName(r.userId as string)), col('open', t('cash.openedAt'), (r) => <span className="num text-xs">{formatDateTime(r.openedAt as string, locale)}</span>), col('expected', t('cash.expectedCash'), (r) => m(r.expectedCash), 'end'), col('actual', t('cash.actualCash'), (r) => (r.actualCash != null ? m(r.actualCash) : '—'), 'end'), col('diff', t('cash.difference'), (r) => { const d = r.difference as number | null; return d == null ? '—' : <Badge variant={d === 0 ? 'success' : d < 0 ? 'destructive' : 'warning'} className="num">{d === 0 ? t('cash.balanced') : formatNumber(d, 2)}</Badge>; }, 'center'), col('status', t('common.status'), (r) => <StatusBadge status={r.status as string} labelKey="cash.status" />)];
      case 'employees': return [col('user', t('common.employee'), (r) => { const u = r.user as { id: string; fullName: { ar: string; en: string }; role: string }; return <Link to={`/users/${u.id}`} className="hover:underline">{tx(u.fullName)} <span className="text-xs text-muted-foreground">· {t(`roles.${u.role}`)}</span></Link>; }), col('branch', t('common.branch'), (r) => branchName((r.user as { branchId: string }).branchId)), col('inv', t('dashboard.invoices'), (r) => <span className="num">{String(r.invoices)}</span>, 'end'), col('rev', t('common.revenue'), (r) => m(r.revenue), 'end'), ...(canCost ? [col('profit', t('common.profit'), (r) => m(r.profit), 'end')] : []), col('avg', t('sales.avgInvoice'), (r) => m(r.avg), 'end'), col('ret', t('nav.returns'), (r) => <span className="num">{String(r.returns)}</span>, 'end')];
      case 'branchPerformance': return [col('branch', t('common.branch'), (r) => { const b = r.branch as { id: string; name: { ar: string; en: string } }; return <Link to={`/branches/${b.id}`} className="hover:underline">{tx(b.name)}</Link>; }), col('inv', t('dashboard.invoices'), (r) => <span className="num">{String(r.invoices)}</span>, 'end'), col('rev', t('common.revenue'), (r) => m(r.revenue), 'end'), ...(canCost ? [col('profit', t('common.profit'), (r) => m(r.profit), 'end'), col('exp', t('common.inventory'), (r) => m(r.inventory), 'end'), col('net', t('accounting.netProfit'), (r) => <span className={Number(r.net) < 0 ? 'text-destructive' : 'text-success'}>{m(r.net)}</span>, 'end')] : []), col('emp', t('branches.employees'), (r) => <span className="num">{String(r.employees)}</span>, 'end')];
      default: return [];
    }
  })();

  const rows = (q.data?.rows ?? []).filter((r) => !search || matchSearch(Object.values(r).flatMap((v) => (v && typeof v === 'object' ? Object.values(v as Row).map(String) : [String(v)])), search));
  const totals = q.data?.totals as Row | undefined;
  const summary: { label: string; value: number; money?: boolean }[] = (() => {
    if (!totals) return [];
    switch (key) {
      case 'sales': case 'profit': return [{ label: t('dashboard.invoices'), value: Number(totals.invoices) }, { label: t('sales.totalSales'), value: Number(totals.sales), money: true }, ...(canCost ? [{ label: t('accounting.cogs'), value: Number(totals.cost), money: true }, { label: t('common.profit'), value: Number(totals.profit), money: true }] : [])];
      case 'purchases': return [{ label: t('common.total'), value: Number(totals.total), money: true }, { label: t('common.paid'), value: Number(totals.paid), money: true }, { label: t('common.remaining'), value: Number(totals.remaining), money: true }];
      case 'inventory': return [{ label: t('inventory.totalQty'), value: Number(totals.qty) }, ...(canCost ? [{ label: t('inventory.totalValue'), value: Number(totals.value), money: true }] : [])];
      case 'customerDebts': return [{ label: t('debts.remaining'), value: Number(totals.remaining), money: true }, { label: t('debts.overdue'), value: Number(totals.overdue), money: true }, { label: t('debts.collectionRate'), value: Number(totals.collectionRate) }];
      case 'supplierBalances': return [{ label: t('suppliers.totalPayable'), value: Number(totals.total), money: true }];
      case 'expenses': return [{ label: t('expenses.totalExpenses'), value: Number(totals.total), money: true }];
      case 'cashRegisters': return [{ label: t('cash.shortage'), value: round2(Number(totals.shortage)), money: true }, { label: t('cash.overage'), value: round2(Number(totals.overage)), money: true }];
      default: return [];
    }
  })();

  return (
    <div>
      <PageHeader
        backTo="/reports"
        title={t(`reports.${key}`)}
        subtitle={t(`reports.descriptions.${key}`)}
        actions={<ExportMenu payload={() => ({
          filename: `report-${key}`,
          title: t(`reports.${key}`),
          columns: columnsToExport(columns),
          rows,
          meta: [
            { label: t('common.date'), value: `${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}` },
            { label: t('common.branch'), value: range.branchId ? branchName(range.branchId) : t('common.allBranches') },
            ...(search ? [{ label: t('common.search'), value: search }] : []),
          ],
        })} />}
      />
      <Section title={t('reports.parameters')} className="mb-3">
        <div className="flex flex-wrap items-end gap-2">
          <DatePresetBar value={range} onChange={setRange} />
          {(key === 'sales' || key === 'profit') ? <><FilterSelect value={groupBy} onChange={(v) => setGroupBy(v as typeof groupBy)} options={[{ value: 'day', label: t('reports.daily') }, { value: 'cashier', label: t('common.cashier') }, { value: 'branch', label: t('common.branch') }, { value: 'product', label: t('common.product') }, { value: 'category', label: t('common.category') }]} allLabel={t('reports.groupBy')} /><FilterSelect value={employeeId} onChange={(v) => setEmployeeId(v === 'all' ? undefined : v)} options={options.users} allLabel={t('common.employee')} /><FilterSelect value={customerId} onChange={(v) => setCustomerId(v === 'all' ? undefined : v)} options={options.customers} allLabel={t('common.customer')} width="w-48" /></> : null}
          {key === 'productMovement' ? <div className="w-72"><Combobox value={productId} onChange={setProductId} options={options.products} placeholder={t('common.selectProduct')} size="sm" /></div> : null}
          {key === 'purchases' ? <FilterSelect value={supplierId} onChange={(v) => setSupplierId(v === 'all' ? undefined : v)} options={options.suppliers} allLabel={t('common.supplier')} width="w-48" /> : null}
          {key === 'customerDebts' ? <FilterSelect value={customerId} onChange={(v) => setCustomerId(v === 'all' ? undefined : v)} options={options.customers} allLabel={t('common.customer')} width="w-48" /> : null}
          <Button size="sm" onClick={() => setRun((r) => r + 1)} loading={q.isFetching}><Play /> {t('reports.runReport')}</Button>
        </div>
      </Section>
      {!enabled ? null : q.isLoading ? <LoadingState /> : (
        <>
          {summary.length ? <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summary.map((s) => <StatCard key={s.label} title={s.label} value={s.value} format={s.money ? 'money' : 'number'} />)}</div> : null}
          {(key === 'sales' || key === 'profit') && q.data?.series ? <ChartCard title={t('reports.chart')} className="mb-3">{key === 'profit' ? <SimpleLineChart data={q.data.series as never} dataKey="profit" name={t('common.profit')} color="#16a34a" height={220} /> : <SalesProfitChart data={q.data.series as never} keys={canCost ? ['sales', 'profit'] : ['sales']} height={220} />}</ChartCard> : null}
          {q.data?.chart?.length ? <ChartCard title={t('reports.chart')} className="mb-3"><NamedBarChart data={q.data.chart} height={240} horizontal={key === 'topProducts' || key === 'employees'} /></ChartCard> : null}
          <DataTable columns={columns} data={paginate(rows, page, pageSize)} total={rows.length} page={page} pageSize={pageSize} onPageChange={setPage} dense isError={q.isError} onRetry={q.refetch} toolbar={<SearchInput value={search} onChange={setSearch} />} emptyTitle={key === 'productMovement' && !productId ? t('common.selectProduct') : undefined} />
        </>
      )}
    </div>
  );
}
