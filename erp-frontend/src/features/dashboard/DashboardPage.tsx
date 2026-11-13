import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Building2, HandCoins, Monitor, PackageX, Receipt, ReceiptText, ShoppingBag, TrendingUp, Truck, Wallet } from 'lucide-react';
import { PageHeader, StatCard, Money } from '@/components/shared/page';
import { ChartCard, DonutChart, NamedBarChart, SalesProfitChart } from '@/components/shared/charts';
import { DatePresetBar, useRangeState } from '@/components/shared/date-preset';
import { CardsLoading, ErrorState } from '@/components/shared/states';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/status-badge';
import { reportService, salesService, productService } from '@/services';
import { useT } from '@/i18n';
import { useLookups } from '@/hooks/useLookups';
import { useAuthStore } from '@/stores/authStore';
import { formatDateTime, formatNumber } from '@/lib/utils';

export default function DashboardPage() {
  const { t, tx, locale } = useT();
  const [range, setRange] = useRangeState('month');
  const { branchName, userName } = useLookups();
  const canFinancial = useAuthStore((s) => s.hasPermission('reports.financial'));
  const canCost = useAuthStore((s) => s.hasPermission('prices.view_cost'));

  const q = useQuery({ queryKey: ['dashboard', range.from, range.to, range.branchId], queryFn: () => reportService.dashboard({ from: range.from, to: range.to, branchId: range.branchId }) });
  const recent = useQuery({ queryKey: ['sales', 'recent', range.branchId], queryFn: () => salesService.list({ pageSize: 6, branchId: range.branchId }) });
  const lowStock = useQuery({ queryKey: ['products', 'low', range.branchId], queryFn: () => productService.list({ pageSize: 6, stockStatus: 'low', branchId: range.branchId }) });

  return (
    <div>
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} actions={<DatePresetBar value={range} onChange={setRange} />} />

      {q.isLoading ? <CardsLoading count={8} /> : q.isError || !q.data ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title={t('dashboard.todaySales')} value={q.data.kpis.todaySales} icon={<Receipt />} change={q.data.kpis.salesChange} />
            {canCost ? <StatCard title={t('dashboard.todayProfit')} value={q.data.kpis.todayProfit} icon={<TrendingUp />} variant="success" change={q.data.kpis.profitChange} /> : <StatCard title={t('dashboard.invoices')} value={q.data.kpis.invoicesCount} format="number" icon={<Receipt />} variant="info" />}
            <StatCard title={t('dashboard.purchases')} value={q.data.kpis.purchases} icon={<ShoppingBag />} variant="info" />
            <StatCard title={t('dashboard.expenses')} value={q.data.kpis.expenses} icon={<ReceiptText />} variant="warning" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title={t('dashboard.customerDebts')} value={q.data.kpis.customerDebts} icon={<HandCoins />} variant="destructive" />
            {canFinancial ? <StatCard title={t('dashboard.supplierDebts')} value={q.data.kpis.supplierDebts} icon={<Truck />} variant="warning" /> : null}
            <StatCard title={t('dashboard.inventoryValue')} value={q.data.kpis.inventoryValue} icon={<Boxes />} />
            <div className="grid grid-cols-2 gap-3">
              <StatCard title={t('dashboard.lowStock')} value={q.data.kpis.lowStockCount} format="number" icon={<AlertTriangle />} variant="warning" />
              <StatCard title={t('dashboard.outOfStock')} value={q.data.kpis.outOfStockCount} format="number" icon={<PackageX />} variant="destructive" />
            </div>
            {!canFinancial ? <div className="grid grid-cols-2 gap-3"><StatCard title={t('dashboard.activeBranches')} value={q.data.kpis.activeBranches} format="number" icon={<Building2 />} /><StatCard title={t('dashboard.activePos')} value={q.data.kpis.activePosTerminals} format="number" icon={<Monitor />} variant="success" /></div> : null}
          </div>
          {canFinancial ? (
            <div className="mt-3 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <StatCard title={t('dashboard.activeBranches')} value={q.data.kpis.activeBranches} format="number" icon={<Building2 />} />
              <StatCard title={t('dashboard.activePos')} value={q.data.kpis.activePosTerminals} format="number" icon={<Monitor />} variant="success" />
              <StatCard title={t('dashboard.invoices')} value={q.data.kpis.invoicesCount} format="number" icon={<Receipt />} variant="info" />
              <StatCard title={t('sales.avgInvoice')} value={q.data.kpis.invoicesCount ? q.data.kpis.todaySales / q.data.kpis.invoicesCount : 0} icon={<Wallet />} />
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <ChartCard title={t('dashboard.salesAndProfit')} className="xl:col-span-2">
              <SalesProfitChart data={q.data.salesSeries} keys={canCost ? ['sales', 'profit'] : ['sales']} />
            </ChartCard>
            <ChartCard title={t('dashboard.paymentMethods')}>
              <DonutChart data={q.data.paymentMethods} height={200} />
            </ChartCard>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <ChartCard title={t('dashboard.salesByBranch')}>
              <NamedBarChart data={q.data.salesByBranch} height={220} />
            </ChartCard>
            <ChartCard title={t('dashboard.salesByCategory')}>
              <NamedBarChart data={q.data.salesByCategory.slice(0, 7)} height={220} horizontal />
            </ChartCard>
            <ChartCard title={t('dashboard.debtAging')}>
              <DonutChart data={q.data.debtAging} height={200} />
            </ChartCard>
          </div>

          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <ChartCard title={t('dashboard.topProducts')} actions={<Button asChild variant="link" size="xs"><Link to="/reports/topProducts">{t('dashboard.viewAll')}</Link></Button>}>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr><th className="pb-1.5 text-start font-medium">{t('common.product')}</th><th className="pb-1.5 text-end font-medium">{t('dashboard.qtySold')}</th><th className="pb-1.5 text-end font-medium">{t('common.revenue')}</th></tr>
                </thead>
                <tbody>
                  {q.data.topProducts.map((p, i) => (
                    <tr key={p.product.id} className="border-t">
                      <td className="py-1.5"><Link to={`/products/${p.product.id}`} className="hover:underline"><span className="me-1.5 text-muted-foreground">{i + 1}.</span>{tx(p.product.name)}</Link></td>
                      <td className="py-1.5 text-end num">{formatNumber(p.qty)}</td>
                      <td className="py-1.5 text-end"><Money value={p.revenue} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ChartCard>
            <ChartCard title={t('dashboard.recentSales')} actions={<Button asChild variant="link" size="xs"><Link to="/sales">{t('dashboard.viewAll')}</Link></Button>}>
              {recent.isLoading ? <Skeleton className="h-40" /> : (
                <ul className="divide-y text-xs">
                  {recent.data?.data.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5">
                      <Link to={`/sales/${s.id}`} className="font-medium hover:underline num">{s.invoiceNumber}</Link>
                      <span className="truncate text-muted-foreground">{userName(s.cashierId)} · {branchName(s.branchId)}</span>
                      <span className="ms-auto shrink-0 text-muted-foreground">{formatDateTime(s.date, locale)}</span>
                      <Money value={s.total} className="shrink-0 font-medium" />
                      <StatusBadge status={s.status} labelKey="sales.status" />
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
            <ChartCard title={t('dashboard.lowStockAlerts')} actions={<Button asChild variant="link" size="xs"><Link to="/inventory?tab=low">{t('dashboard.viewAll')}</Link></Button>}>
              {lowStock.isLoading ? <Skeleton className="h-40" /> : lowStock.data?.data.length === 0 ? <div className="py-8 text-center text-xs text-muted-foreground">{t('common.noData')}</div> : (
                <ul className="divide-y text-xs">
                  {lowStock.data?.data.map((p) => (
                    <li key={p.id} className="flex items-center gap-2 py-1.5">
                      <AlertTriangle className="size-3.5 shrink-0 text-amber-500" />
                      <Link to={`/products/${p.id}`} className="truncate hover:underline">{tx(p.name)}</Link>
                      <span className="ms-auto shrink-0 num"><span className="font-medium text-amber-600">{p.totalStock}</span> / {p.minStock}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
