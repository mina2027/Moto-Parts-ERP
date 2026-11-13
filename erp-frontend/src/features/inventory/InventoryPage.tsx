import * as React from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeftRight, Boxes, ClipboardList, PackageX, Plus, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { DataTable } from '@/components/shared/data-table';
import { ExportMenu, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge, StockBadge } from '@/components/shared/status-badge';
import { EmptyState, LoadingState } from '@/components/shared/states';
import { AdjustmentDialog } from './AdjustmentDialog';
import { StockCountDialog } from './StockCountDialog';
import { inventoryService, productService } from '@/services';
import type { InventoryRow } from '@/services/inventoryService';
import type { ProductWithStock } from '@/services/productService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDateTime, matchSearch, paginate } from '@/lib/utils';
import { columnsToExport } from '@/lib/tableExport';
import { productCategoryIds } from '@moto/shared';

type Row = InventoryRow & { name: string; sku: string; categoryId: string; categoryIds: string[]; cost: number };

export default function InventoryPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'overview';
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const canCost = hasPermission('prices.view_cost');
  const currentBranch = user.branchId;
  const { branches, warehouses, options, branchName, warehouseName, userName, productName, categoryName } = useLookups();
  const [branchId, setBranchId] = React.useState<string | undefined>(canAll ? undefined : currentBranch);
  const [warehouseId, setWarehouseId] = React.useState<string>();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(25);
  const [adjOpen, setAdjOpen] = React.useState(false);
  const [damagedOpen, setDamagedOpen] = React.useState(false);
  const [countOpen, setCountOpen] = React.useState(false);
  const [adjProduct, setAdjProduct] = React.useState<string>();
  const [countProducts, setCountProducts] = React.useState<string[]>([]);
  React.useEffect(() => {
    const action = location.state as { countProductIds?: string[]; branchId?: string; warehouseId?: string } | null;
    if (!action?.countProductIds?.length || !hasPermission('inventory.count')) return;
    const targetBranch = canAll ? action.branchId ?? currentBranch : currentBranch;
    setBranchId(targetBranch);
    setWarehouseId(action.warehouseId);
    setCountProducts(action.countProductIds);
    setCountOpen(true);
    navigate(location.pathname + location.search, { replace: true, state: null });
  }, [location.state, location.pathname, location.search, hasPermission, canAll, currentBranch, navigate]);

  const ov = useQuery({ queryKey: ['inventory', 'overview', branchId, warehouseId], queryFn: () => inventoryService.overview(branchId, warehouseId) });
  const products = useQuery<ProductWithStock[]>({ queryKey: ['products', 'all'], queryFn: () => productService.all() });
  const adjustments = useQuery({ queryKey: ['inventory', 'adjustments', branchId], queryFn: () => inventoryService.adjustments({ branchId, pageSize: 50 }) });
  const counts = useQuery({ queryKey: ['inventory', 'counts'], queryFn: inventoryService.counts });

  const rows = React.useMemo<Row[]>(() => {
    const pm = new Map((products.data ?? []).map((p) => [p.id, p]));
    return (ov.data?.rows ?? []).map((r) => { const p = pm.get(r.productId); return { ...r, name: tx(p?.name), sku: p?.sku ?? '', categoryId: p?.categoryId ?? '', categoryIds: productCategoryIds(p), cost: p?.lastPurchaseCost ?? 0 }; });
  }, [ov.data, products.data, tx]);
  const filtered = React.useMemo(() => {
    let r = rows.filter((x) => matchSearch([x.name, x.sku], search));
    // Short in any branch counts, otherwise a healthy company-wide total hides a branch that has run down.
    const isOut = (x: Row) => x.status === 'out' || (x.outBranches?.length ?? 0) > 0;
    const isLow = (x: Row) => !isOut(x) && (x.status === 'low' || (x.lowBranches?.length ?? 0) > 0);
    if (tab === 'low') r = r.filter(isLow);
    if (tab === 'out') r = r.filter(isOut);
    return r;
  }, [rows, search, tab]);
  React.useEffect(() => setPage(1), [search, tab, branchId, warehouseId]);

  const baseCols: ColumnDef<Row, unknown>[] = [
    { accessorKey: 'name', header: t('common.product'), cell: ({ row }) => <div><Link to={`/products/${row.original.productId}`} className="font-medium hover:underline">{row.original.name}</Link><div className="text-[10px] text-muted-foreground">{row.original.sku} · {row.original.categoryIds.map(categoryName).join('، ')}</div></div> },
    { accessorKey: 'quantity', header: t('common.quantity'), cell: ({ row }) => <span className="num font-semibold">{row.original.quantity}</span>, meta: { align: 'end' } },
    { accessorKey: 'reserved', header: t('inventory.reserved'), cell: ({ row }) => <span className="num text-muted-foreground">{row.original.reserved || '—'}</span>, meta: { align: 'end' } },
    { accessorKey: 'minStock', header: t('products.minStock'), cell: ({ row }) => <span className="num text-muted-foreground">{row.original.minStock}</span>, meta: { align: 'end' } },
    ...(canCost ? [{ accessorKey: 'value', header: t('common.value'), cell: ({ row }: { row: { original: Row } }) => <Money value={row.original.value} />, meta: { align: 'end' as const } }] : []),
    { id: 'status', header: t('common.status'), cell: ({ row }) => <StockBadge qty={row.original.quantity} min={row.original.minStock} /> },
  ];
  const branchCols: ColumnDef<Row, unknown>[] = [baseCols[0], ...branches.filter((b) => b.isActive).map<ColumnDef<Row, unknown>>((b) => ({ id: b.id, header: tx(b.name), cell: ({ row }) => <span className={`num ${!row.original.byBranch[b.id] ? 'text-muted-foreground' : ''}`}>{row.original.byBranch[b.id] ?? 0}</span>, meta: { align: 'center' } })), baseCols[1]];
  const whCols: ColumnDef<Row, unknown>[] = [baseCols[0], ...warehouses.filter((w) => branches.find((b) => b.id === w.branchId)?.isActive !== false && (!branchId || w.branchId === branchId)).map<ColumnDef<Row, unknown>>((w) => ({ id: w.id, header: w.code, cell: ({ row }) => <span className={`num ${!row.original.byWarehouse[w.id] ? 'text-muted-foreground' : ''}`}>{row.original.byWarehouse[w.id] ?? 0}</span>, meta: { align: 'center' } })), baseCols[1]];
  const shortBranches = (r: Row) => [...(r.outBranches ?? []), ...(r.lowBranches ?? [])];
  const lowCols: ColumnDef<Row, unknown>[] = [...baseCols.slice(0, 4),
    // The gap that matters is the worst short branch, not the healthy company-wide total.
    { id: 'shortage', header: t('inventory.shortageQty'), cell: ({ row }) => { const r = row.original; const gaps = shortBranches(r).map((b) => r.minStock - (r.byBranch[b] ?? 0)); return <span className="num font-medium text-destructive">{Math.max(0, r.minStock - r.quantity, ...gaps)}</span>; }, meta: { align: 'end' } },
    { id: 'shortBranches', header: t('inventory.shortInBranches'), cell: ({ row }) => { const b = shortBranches(row.original); return b.length ? <span className="text-[11px]">{b.map(branchName).join('، ')}</span> : <span className="text-muted-foreground">—</span>; } }, { id: 'act', header: '', cell: ({ row }) => <div className="flex justify-end gap-1">{hasPermission('inventory.transfer') ? <Button size="xs" variant="outline" asChild><Link to="/transfers" state={{ productId: row.original.productId }}><ArrowLeftRight /> {t('nav.transfers')}</Link></Button> : null}{hasPermission('purchases.create') ? <Button size="xs" variant="outline" asChild><Link to="/purchases" state={{ productId: row.original.productId }}><Plus /> {t('nav.purchases')}</Link></Button> : null}</div> }];

  const exportPayload = (cols: ColumnDef<Row, unknown>[]) => () => ({
    filename: `inventory-${tab}`,
    title: `${t('inventory.title')} — ${t(tab === 'low' ? 'inventory.lowStock' : tab === 'out' ? 'inventory.outOfStock' : 'inventory.overview')}`,
    columns: columnsToExport(cols),
    rows: filtered,
    meta: [
      { label: t('common.branch'), value: branchId ? branchName(branchId) : t('common.allBranches') },
      { label: t('common.warehouse'), value: warehouseId ? warehouseName(warehouseId) : t('common.all') },
      ...(search ? [{ label: t('common.search'), value: search }] : []),
    ],
  });

  const table = (cols: ColumnDef<Row, unknown>[]) => (
    <DataTable columns={cols} data={paginate(filtered, page, pageSize)} total={filtered.length} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} isLoading={ov.isLoading} isError={ov.isError} onRetry={ov.refetch} getRowId={(r) => r.productId} dense enableColumnVisibility
      onRowClick={hasPermission('inventory.adjust') ? (r) => { setAdjProduct(r.productId); setAdjOpen(true); } : undefined}
      toolbar={<><SearchInput value={search} onChange={setSearch} />{canAll ? <FilterSelect value={branchId} onChange={(v) => { setBranchId(v === 'all' ? undefined : v); setWarehouseId(undefined); }} options={options.activeBranches} allLabel={t('common.allBranches')} /> : null}<FilterSelect value={warehouseId} onChange={(v) => setWarehouseId(v === 'all' ? undefined : v)} options={warehouses.filter((w) => !branchId || w.branchId === branchId).map((w) => ({ value: w.id, label: tx(w.name) }))} allLabel={t('common.warehouse')} width="w-48" /><ExportMenu payload={exportPayload(cols)} /></>}
    />
  );

  return (
    <div>
      <PageHeader title={t('inventory.title')} subtitle={t('inventory.subtitle')} actions={<><Button variant="outline" asChild><Link to="/inventory/movements"><ClipboardList /> {t('inventory.movements')}</Link></Button>{hasPermission('inventory.adjust') ? <><Button variant="outline" onClick={() => setDamagedOpen(true)}><Trash2 /> {t('inventory.recordDamaged')}</Button><Button onClick={() => { setAdjProduct(undefined); setAdjOpen(true); }}><Plus /> {t('inventory.newAdjustment')}</Button></> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('inventory.totalItems')} value={ov.data?.skuCount ?? 0} format="number" icon={<Boxes />} />
        <StatCard title={t('inventory.totalQty')} value={ov.data?.totalQty ?? 0} format="number" icon={<Tag />} variant="info" />
        <StatCard title={t('inventory.lowStock')} value={ov.data?.lowCount ?? 0} format="number" icon={<AlertTriangle />} variant="warning" onClick={() => setParams({ tab: 'low' })} />
        <StatCard title={t('inventory.outOfStock')} value={ov.data?.outCount ?? 0} format="number" icon={<PackageX />} variant="destructive" onClick={() => setParams({ tab: 'out' })} />
      </div>
      {canCost ? <div className="mb-4"><StatCard title={t('inventory.totalValue')} value={ov.data?.totalValue ?? 0} icon={<Tag />} variant="success" className="max-w-xs" /></div> : null}

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="overview">{t('inventory.overview')}</TabsTrigger>
          <TabsTrigger value="branch">{t('inventory.byBranch')}</TabsTrigger>
          <TabsTrigger value="warehouse">{t('inventory.byWarehouse')}</TabsTrigger>
          <TabsTrigger value="low">{t('inventory.lowStock')} <Badge variant="warning" className="ms-1">{ov.data?.lowCount ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="out">{t('inventory.outOfStock')} <Badge variant="destructive" className="ms-1">{ov.data?.outCount ?? 0}</Badge></TabsTrigger>
          <TabsTrigger value="adjustments">{t('inventory.adjustments')}</TabsTrigger>
          <TabsTrigger value="counts">{t('inventory.stockCount')}</TabsTrigger>
          <TabsTrigger value="damaged">{t('inventory.damaged')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">{table(baseCols)}</TabsContent>
        <TabsContent value="branch">{table(branchCols)}</TabsContent>
        <TabsContent value="warehouse">{table(whCols)}</TabsContent>
        <TabsContent value="low">{table(lowCols)}</TabsContent>
        <TabsContent value="out">{table(lowCols)}</TabsContent>
        <TabsContent value="adjustments">
          <div className="rounded-lg border bg-card">
            {adjustments.isLoading ? <LoadingState /> : !adjustments.data?.data.length ? <EmptyState /> : (
              <table className="w-full text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start font-medium">{t('common.date')}</th><th className="px-3 py-2 text-start font-medium">{t('common.product')}</th><th className="px-3 py-2 text-start font-medium">{t('common.warehouse')}</th><th className="px-3 py-2 text-start font-medium">{t('inventory.direction')}</th><th className="px-3 py-2 text-end font-medium">{t('common.quantity')}</th><th className="px-3 py-2 text-start font-medium">{t('common.reason')}</th><th className="px-3 py-2 text-start font-medium">{t('common.user')}</th><th className="px-3 py-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody>{adjustments.data.data.map((a) => <tr key={a.id} className="border-t"><td className="px-3 py-1.5 num text-xs">{formatDateTime(a.date, locale)}</td><td className="px-3 py-1.5"><Link to={`/products/${a.productId}`} className="hover:underline">{productName(a.productId)}</Link></td><td className="px-3 py-1.5 text-xs">{warehouseName(a.warehouseId)}</td><td className="px-3 py-1.5"><StatusBadge status={a.direction} label={t(`inventory.${a.direction}`)} /></td><td className="px-3 py-1.5 text-end num font-medium">{a.quantity}</td><td className="px-3 py-1.5 text-xs">{t(`inventory.reasons.${a.reason}`)}{a.notes ? <span className="text-muted-foreground"> — {a.notes}</span> : null}</td><td className="px-3 py-1.5 text-xs">{userName(a.userId)}</td><td className="px-3 py-1.5"><StatusBadge status={a.status} labelKey="expenses.status" /></td></tr>)}</tbody></table>
            )}
          </div>
        </TabsContent>
        <TabsContent value="counts">
          <div className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b p-2"><span className="text-sm font-medium px-1">{t('inventory.stockCount')}</span>{hasPermission('inventory.count') ? <Button size="sm" onClick={() => setCountOpen(true)}><Plus /> {t('inventory.newCount')}</Button> : null}</div>
            {counts.isLoading ? <LoadingState /> : !counts.data?.length ? <EmptyState /> : (
              <table className="w-full text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start font-medium">{t('common.code')}</th><th className="px-3 py-2 text-start font-medium">{t('common.date')}</th><th className="px-3 py-2 text-start font-medium">{t('common.branch')}</th><th className="px-3 py-2 text-start font-medium">{t('common.warehouse')}</th><th className="px-3 py-2 text-start font-medium">{t('common.user')}</th><th className="px-3 py-2 text-center font-medium">{t('common.items')}</th><th className="px-3 py-2 text-center font-medium">{t('inventory.variance')}</th><th className="px-3 py-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody>{counts.data.map((c) => <tr key={c.id} className="cursor-pointer border-t hover:bg-muted/40" onClick={() => navigate(`/inventory/counts/${c.id}`)}><td className="px-3 py-1.5 num font-medium">{c.code}</td><td className="px-3 py-1.5 num text-xs">{formatDateTime(c.date, locale)}</td><td className="px-3 py-1.5 text-xs">{branchName(c.branchId)}</td><td className="px-3 py-1.5 text-xs">{warehouseName(c.warehouseId)}</td><td className="px-3 py-1.5 text-xs">{userName(c.userId)}</td><td className="px-3 py-1.5 text-center num">{c.items.filter((i) => i.counted != null).length}/{c.items.length}</td><td className="px-3 py-1.5 text-center num">{c.items.filter((i) => i.counted != null && i.counted !== i.expected).length}</td><td className="px-3 py-1.5"><StatusBadge status={c.status} label={c.status === 'draft' ? t('common.draft') : c.status === 'in_progress' ? t('common.pending') : t('common.completed')} /></td></tr>)}</tbody></table>
            )}
          </div>
        </TabsContent>
        <TabsContent value="damaged">
          <div className="rounded-lg border bg-card">
            {adjustments.isLoading ? <LoadingState /> : (() => { const d = adjustments.data?.data.filter((a) => a.reason === 'damaged' || a.reason === 'expired') ?? []; return !d.length ? <EmptyState /> : (
              <table className="w-full text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start font-medium">{t('common.date')}</th><th className="px-3 py-2 text-start font-medium">{t('common.product')}</th><th className="px-3 py-2 text-start font-medium">{t('common.warehouse')}</th><th className="px-3 py-2 text-end font-medium">{t('inventory.damagedQty')}</th>{canCost ? <th className="px-3 py-2 text-end font-medium">{t('common.value')}</th> : null}<th className="px-3 py-2 text-start font-medium">{t('common.notes')}</th><th className="px-3 py-2 text-start font-medium">{t('common.user')}</th></tr></thead>
                <tbody>{d.map((a) => { const cost = products.data?.find((p) => p.id === a.productId)?.lastPurchaseCost ?? 0; return <tr key={a.id} className="border-t"><td className="px-3 py-1.5 num text-xs">{formatDateTime(a.date, locale)}</td><td className="px-3 py-1.5">{productName(a.productId)}</td><td className="px-3 py-1.5 text-xs">{warehouseName(a.warehouseId)}</td><td className="px-3 py-1.5 text-end num font-medium text-destructive">{a.quantity}</td>{canCost ? <td className="px-3 py-1.5 text-end"><Money value={a.quantity * cost} /></td> : null}<td className="px-3 py-1.5 text-xs text-muted-foreground">{t(`inventory.reasons.${a.reason}`)}{a.notes ? ` — ${a.notes}` : ''}</td><td className="px-3 py-1.5 text-xs">{userName(a.userId)}</td></tr>; })}</tbody></table>
            ); })()}
          </div>
        </TabsContent>
      </Tabs>
      <AdjustmentDialog open={adjOpen} onOpenChange={setAdjOpen} productId={adjProduct} />
      <AdjustmentDialog open={damagedOpen} onOpenChange={setDamagedOpen} damagedMode />
      <StockCountDialog open={countOpen} onOpenChange={(open) => { setCountOpen(open); if (!open) setCountProducts([]); }} initialProductIds={countProducts} initialBranchId={branchId} initialWarehouseId={warehouseId} />
    </div>
  );
}
