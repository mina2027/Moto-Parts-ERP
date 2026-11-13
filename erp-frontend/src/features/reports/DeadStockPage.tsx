import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { ArrowLeftRight, Boxes, ClipboardList, Percent, PiggyBank, Snowflake, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, Money, PageHeader, StatCard } from '@/components/shared/page';
import type { ExportPayload } from '@/lib/export';
import { SalesProfitChart } from '@/components/shared/charts';
import { Section } from '@/components/shared/page';
import { reportService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { cn, formatDate, formatNumber } from '@/lib/utils';
import type { DeadStockRow } from '@/types';

const PRESETS = [30, 60, 90, 180] as const;

export default function DeadStockPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { options, branchName, categoryPath } = useLookups();
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const canEditPrices = useAuthStore((s) => s.hasPermission('prices.edit'));
  const canCount = useAuthStore((s) => s.hasPermission('inventory.count'));
  const canTransfer = useAuthStore((s) => s.hasPermission('inventory.transfer'));
  const currentBranch = useAuthStore((s) => s.session!.user.branchId);
  const [idle, setIdle] = React.useState<number>(settings.reports.deadStockDefaultIdleDays || 90);
  const [custom, setCustom] = React.useState('');
  const [branchId, setBranchId] = React.useState<string | undefined>(canAll ? undefined : currentBranch);
  const [warehouseId, setWarehouseId] = React.useState<string | undefined>();
  const [categoryId, setCategoryId] = React.useState<string | undefined>();
  const [minValue, setMinValue] = React.useState('');

  const q = useQuery({ queryKey: ['reports', 'deadStock', idle, branchId, warehouseId, categoryId, minValue], queryFn: () => reportService.deadStock({ idleDays: idle, branchId, warehouseId, categoryId, minValue: minValue ? Number(minValue) : undefined }) });
  const trend = useQuery({ queryKey: ['reports', 'deadStock', 'snapshots', branchId], queryFn: () => reportService.deadStockSnapshots(branchId) });

  const exportPayload = (): ExportPayload<DeadStockRow> => ({
    filename: `dead-stock-${idle}d`,
    title: t('upgrade.deadStock'),
    columns: [
      { header: t('common.product'), value: (r) => tx(r.product.name) },
      { header: t('common.sku'), value: (r) => r.product.sku },
      { header: t('common.partNumber'), value: (r) => r.product.partNumber },
      { header: t('common.branch'), value: (r) => branchName(r.branchId) },
      { header: t('upgrade.qtyOnHand'), value: (r) => r.qtyOnHand, numeric: true },
      { header: t('upgrade.lastSale'), value: (r) => (r.lastSaleDate ? formatDate(r.lastSaleDate, locale) : t('upgrade.neverSold')) },
      { header: t('upgrade.idleDays'), value: (r) => r.idleDays, numeric: true },
      { header: t('common.cost'), value: (r) => r.unitCost, numeric: true },
      { header: t('upgrade.frozenCapital'), value: (r) => r.frozenCapital, numeric: true },
      { header: t('upgrade.carryingCost'), value: (r) => r.carryingCost, numeric: true },
      { header: t('upgrade.suggestedAction'), value: (r) => t(`upgrade.action.${r.suggestedAction}`) },
    ],
    rows: q.data?.rows ?? [],
    meta: [
      { label: t('upgrade.idlePeriod'), value: `${idle} ${t('upgrade.days')}` },
      { label: t('common.branch'), value: branchId ? branchName(branchId) : t('common.allBranches') },
      { label: t('common.category'), value: categoryId ? categoryPath(categoryId) : t('common.all') },
    ],
  });

  const actionVariant: Record<DeadStockRow['suggestedAction'], 'warning' | 'info' | 'destructive' | 'secondary'> = { discount: 'warning', transfer: 'info', liquidate: 'destructive', return_to_supplier: 'secondary' };

  const columns = React.useMemo<ColumnDef<DeadStockRow, unknown>[]>(() => [
    { id: 'product', header: t('common.product'), cell: ({ row }) => <div><Link to={`/products/${row.original.product.id}`} className="font-medium hover:underline">{tx(row.original.product.name)}</Link><div className="text-[10px] text-muted-foreground num">{row.original.product.sku} · {row.original.product.partNumber}</div></div> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { accessorKey: 'qtyOnHand', header: t('upgrade.qtyOnHand'), cell: ({ row }) => <span className="num font-medium">{row.original.qtyOnHand}</span>, meta: { align: 'end' } },
    { accessorKey: 'idleDays', header: t('upgrade.idleDays'), cell: ({ row }) => <span className={cn('num', row.original.idleDays > idle * 2 ? 'text-destructive font-semibold' : '')}>{row.original.idleDays}</span>, meta: { align: 'end' } },
    { accessorKey: 'lastSaleDate', header: t('upgrade.lastSale'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.lastSaleDate ? formatDate(row.original.lastSaleDate, locale) : t('upgrade.neverSold')}</span> },
    { accessorKey: 'unitCost', header: t('common.cost'), cell: ({ row }) => <Money value={row.original.unitCost} className="text-muted-foreground" />, meta: { align: 'end' } },
    { accessorKey: 'frozenCapital', header: t('upgrade.frozenCapital'), cell: ({ row }) => <Money value={row.original.frozenCapital} className="font-semibold" />, meta: { align: 'end' } },
    { accessorKey: 'carryingCost', header: t('upgrade.carryingCost'), cell: ({ row }) => <Money value={row.original.carryingCost} className="text-amber-600" />, meta: { align: 'end' } },
    { accessorKey: 'suggestedAction', header: t('upgrade.suggestedAction'), cell: ({ row }) => <Badge variant={actionVariant[row.original.suggestedAction]}>{t(`upgrade.action.${row.original.suggestedAction}`)}</Badge> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button disabled={!canEditPrices} size="xs" variant="ghost" title={t('upgrade.createDiscount')} onClick={() => navigate('/pricing', { state: { productId: row.original.product.id } })}><Percent /></Button>
          {canTransfer ? <Button size="xs" variant="ghost" title={t('upgrade.createTransfer')} onClick={() => navigate('/transfers', { state: { productId: row.original.product.id, sourceBranchId: row.original.branchId, sourceWarehouseId: warehouseId } })}><ArrowLeftRight /></Button> : null}
          <Button disabled={!canCount} size="xs" variant="ghost" title={t('upgrade.addToCount')} onClick={() => navigate('/inventory', { state: { countProductIds: [row.original.product.id], branchId: row.original.branchId, warehouseId } })}><ClipboardList /></Button>
        </div>
      ),
    },
  ], [t, tx, locale, branchName, idle, canTransfer, canEditPrices, canCount, warehouseId, navigate]);

  const totals = q.data?.totals;
  return (
    <div>
      <PageHeader title={t('upgrade.deadStock')} subtitle={t('upgrade.deadStockSubtitle')} backTo="/reports" actions={<ExportMenu payload={exportPayload} />} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('upgrade.idlePeriod')}:</span>
        <div className="inline-flex rounded-md border p-0.5">
          {PRESETS.map((d) => <Button key={d} size="sm" variant={idle === d ? 'secondary' : 'ghost'} onClick={() => { setIdle(d); setCustom(''); }}>{d} {t('upgrade.days')}</Button>)}
        </div>
        <Input type="number" dir="ltr" placeholder={t('upgrade.custom')} value={custom} onChange={(e) => { setCustom(e.target.value); const n = Number(e.target.value); if (n >= 1) setIdle(n); }} className="h-8 w-24" />
        <FilterBar activeCount={[branchId, warehouseId, categoryId, minValue].filter(Boolean).length} onClear={() => { setBranchId(canAll ? undefined : currentBranch); setWarehouseId(undefined); setCategoryId(undefined); setMinValue(''); }}>
          {canAll ? <FilterSelect value={branchId} onChange={(v) => setBranchId(v === 'all' ? undefined : v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}
          <FilterSelect value={warehouseId} onChange={(v) => setWarehouseId(v === 'all' ? undefined : v)} options={options.warehouses} allLabel={t('common.warehouse')} />
          <FilterSelect value={categoryId} onChange={(v) => setCategoryId(v === 'all' ? undefined : v)} options={options.categories} allLabel={t('common.category')} />
          <Input type="number" dir="ltr" placeholder={t('upgrade.minValue')} value={minValue} onChange={(e) => setMinValue(e.target.value)} className="h-8 w-32" />
        </FilterBar>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('upgrade.itemsCount')} value={totals?.itemCount ?? 0} format="number" icon={<Boxes />} hint={`${formatNumber(totals?.qty ?? 0)} ${t('common.piece')}`} />
        <StatCard title={t('upgrade.frozenCapital')} value={totals?.frozenCapital ?? 0} icon={<Snowflake />} variant="info" />
        <StatCard title={t('upgrade.carryingCost')} value={totals?.carryingCost ?? 0} icon={<PiggyBank />} variant="warning" hint={`${t('upgrade.annualCarryingRate')}: ${formatNumber((q.data?.annualCarryingRate ?? settings.reports.annualCarryingRate) * 100)}%`} />
        <StatCard title={t('upgrade.idlePeriod')} value={`${idle} ${t('upgrade.days')}`} icon={<Timer />} format="raw" />
      </div>
      {trend.data?.length ? (
        <Section title={t('upgrade.trend')} className="mb-4" description={`${t('upgrade.frozenCapital')} / ${t('upgrade.carryingCost')}`}>
          <SalesProfitChart height={200} data={[...trend.data].reverse().map((s) => ({ date: s.date.slice(0, 10), sales: s.frozenCapital, profit: s.carryingCost }))} />
        </Section>
      ) : null}
      <DataTable columns={columns} data={q.data?.rows ?? []} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} getRowId={(r) => `${r.product.id}|${r.branchId}`} dense />
    </div>
  );
}
