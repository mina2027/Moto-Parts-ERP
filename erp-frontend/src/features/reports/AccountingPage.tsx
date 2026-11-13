import { useQuery } from '@tanstack/react-query';
import { Boxes, HandCoins, Info, Receipt, ReceiptText, TrendingDown, TrendingUp, Truck, Wallet } from 'lucide-react';
import { Alert } from '@/components/ui/misc';
import { Money, PageHeader, Section, StatCard, ExportMenu } from '@/components/shared/page';
import { DatePresetBar, useRangeState } from '@/components/shared/date-preset';
import { ChartCard, DonutChart, SalesProfitChart } from '@/components/shared/charts';
import { CardsLoading, ErrorState } from '@/components/shared/states';
import { reportService } from '@/services';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { ExportPayload } from '@/lib/export';
import { cn, formatDate, formatNumber } from '@/lib/utils';

export default function AccountingPage() {
  const { t, tx, locale } = useT();
  const { branchName } = useLookups();
  const [range, setRange] = useRangeState('month');
  const q = useQuery({ queryKey: ['accounting', range.from, range.to, range.branchId], queryFn: () => reportService.accounting({ from: range.from, to: range.to, branchId: range.branchId }) });
  const d = q.data;
  const gm = d && d.netSales ? (d.grossProfit / d.netSales) * 100 : 0;
  const nm = d && d.netSales ? (d.netProfit / d.netSales) * 100 : 0;

  const exportPayload = (): ExportPayload<{ label: string; amount: number }> => ({
    filename: 'accounting',
    title: t('accounting.title'),
    columns: [
      { header: t('common.description'), value: (r) => r.label },
      { header: t('common.amount'), value: (r) => r.amount, numeric: true },
    ],
    rows: d ? [
      { label: t('accounting.totalSales'), amount: d.totalSales },
      { label: t('accounting.returns'), amount: -(d.returns ?? 0) },
      { label: t('accounting.tax'), amount: -d.tax },
      { label: t('accounting.netSales'), amount: d.netSales },
      { label: `(−) ${t('accounting.cogs')}`, amount: -d.cogs },
      { label: t('accounting.grossProfit'), amount: d.grossProfit },
      { label: `(−) ${t('accounting.expenses')}`, amount: -d.expenses },
      { label: t('accounting.netProfit'), amount: d.netProfit },
      { label: t('accounting.inventoryValue'), amount: d.inventoryValue },
      { label: t('accounting.receivables'), amount: d.receivables },
      { label: t('accounting.payables'), amount: -d.payables },
      ...d.expenseBreakdown.map((e) => ({ label: `${t('accounting.expenses')}: ${tx(e.name)}`, amount: e.value })),
    ] : [],
    meta: [
      { label: t('common.dateRange'), value: `${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}` },
      { label: t('common.branch'), value: range.branchId ? branchName(range.branchId) : t('common.allBranches') },
      { label: t('accounting.grossMargin'), value: `${formatNumber(gm, 1)}%` },
      { label: t('accounting.netMargin'), value: `${formatNumber(nm, 1)}%` },
    ],
  });

  return (
    <div>
      <PageHeader title={t('accounting.title')} subtitle={t('accounting.subtitle')} actions={<><DatePresetBar value={range} onChange={setRange} /><ExportMenu payload={exportPayload} /></>} />
      <Alert variant="info" icon={<Info />} className="mb-4">{t('accounting.notice')}</Alert>
      {q.isLoading ? <CardsLoading count={8} /> : q.isError || !d ? <ErrorState onRetry={() => q.refetch()} /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title={t('accounting.netSales')} value={d.netSales} icon={<Receipt />} />
            <StatCard title={t('accounting.cogs')} value={d.cogs} icon={<TrendingDown />} variant="warning" />
            <StatCard title={t('accounting.grossProfit')} value={d.grossProfit} icon={<TrendingUp />} variant="success" hint={`${t('accounting.grossMargin')}: ${formatNumber(gm, 1)}%`} />
            <StatCard title={t('accounting.expenses')} value={d.expenses} icon={<ReceiptText />} variant="destructive" />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard title={t('accounting.netProfit')} value={d.netProfit} icon={<Wallet />} variant={d.netProfit >= 0 ? 'success' : 'destructive'} hint={`${t('accounting.netMargin')}: ${formatNumber(nm, 1)}%`} />
            <StatCard title={t('accounting.inventoryValue')} value={d.inventoryValue} icon={<Boxes />} variant="info" />
            <StatCard title={t('accounting.receivables')} value={d.receivables} icon={<HandCoins />} />
            <StatCard title={t('accounting.payables')} value={d.payables} icon={<Truck />} variant="warning" />
          </div>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <Section title={t('accounting.plStatement')}>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    { l: t('accounting.totalSales'), v: d.totalSales, bold: true }, { l: `(−) ${t('accounting.returns')}`, v: -(d.returns ?? 0) }, { l: `(−) ${t('accounting.tax')}`, v: -d.tax }, { l: t('accounting.netSales'), v: d.netSales, bold: true }, { l: `(−) ${t('accounting.cogs')}`, v: -d.cogs }, { l: t('accounting.grossProfit'), v: d.grossProfit, bold: true, line: true, pct: gm },
                    { l: `(−) ${t('accounting.expenses')}`, v: -d.expenses }, { l: t('accounting.netProfit'), v: d.netProfit, bold: true, line: true, pct: nm, final: true },
                  ].map((r, i) => (
                    <tr key={i} className={cn(r.line && 'border-t', r.final && 'bg-muted/40')}>
                      <td className={cn('py-2', r.bold && 'font-semibold')}>{r.l}{r.pct !== undefined ? <span className="ms-2 text-xs text-muted-foreground num">({formatNumber(r.pct, 1)}%)</span> : null}</td>
                      <td className={cn('py-2 text-end', r.bold && 'font-semibold', r.v < 0 && !r.bold && 'text-destructive', r.final && (r.v >= 0 ? 'text-success' : 'text-destructive'))}><Money value={r.v} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 space-y-1.5 border-t pt-3 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('accounting.inventoryValue')}</span><Money value={d.inventoryValue} /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('accounting.receivables')}</span><Money value={d.receivables} className="text-success" /></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('accounting.payables')}</span><Money value={-d.payables} className="text-destructive" /></div>
              </div>
            </Section>
            <ChartCard title={t('accounting.trend')} className="xl:col-span-2"><SalesProfitChart data={d.series} keys={['sales', 'profit', 'expenses']} height={300} /></ChartCard>
          </div>
          <div className="mt-3 grid gap-3 xl:grid-cols-3">
            <ChartCard title={t('accounting.expenseBreakdown')}>{d.expenseBreakdown.length ? <DonutChart data={d.expenseBreakdown} height={200} /> : <div className="py-10 text-center text-xs text-muted-foreground">{t('common.noData')}</div>}</ChartCard>
            <ChartCard title={`${t('dashboard.purchases')} / ${t('dashboard.expenses')}`} className="xl:col-span-2"><SalesProfitChart data={d.series} keys={['purchases', 'expenses']} height={200} /></ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
