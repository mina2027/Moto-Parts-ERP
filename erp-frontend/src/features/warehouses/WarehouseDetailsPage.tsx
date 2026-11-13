import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, ChevronDown, ChevronRight, Grid3X3, Layers, MapPin, PackageX, AlertTriangle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/misc';
import { KeyValue, Money, PageHeader, SearchInput, Section, StatCard } from '@/components/shared/page';
import { StatusBadge, StockBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, matchSearch } from '@/lib/utils';

export default function WarehouseDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx } = useT();
  const { branchName, product } = useLookups();
  const canCost = useAuthStore((s) => s.hasPermission('prices.view_cost'));
  const [search, setSearch] = React.useState('');
  const [openLoc, setOpenLoc] = React.useState<Record<string, boolean>>({});
  const w = useQuery({ queryKey: ['warehouse', id], queryFn: () => inventoryService.getWarehouse(id) });
  const stats = useQuery({ queryKey: ['warehouse', id, 'stats'], queryFn: () => inventoryService.warehouseStats(id) });
  const levels = useQuery({ queryKey: ['inventory', 'levels', { warehouseId: id }], queryFn: () => inventoryService.levels({ warehouseId: id }) });
  if (w.isLoading) return <PageLoading />;
  if (w.isError || !w.data) return <ErrorState onRetry={() => w.refetch()} />;
  const wh = w.data;
  const rows = (levels.data ?? []).map((l) => ({ ...l, p: product(l.productId) })).filter((r) => r.p && matchSearch([r.p.name.ar, r.p.name.en, r.p.sku, r.locationCode, r.shelf, r.bin], search)).sort((a, b) => b.quantity - a.quantity);

  return (
    <div>
      <PageHeader backTo="/warehouses" title={tx(wh.name)} badge={<>{wh.isMain ? <Badge variant="info">{t('warehouses.main')}</Badge> : <Badge variant="secondary">{t('warehouses.secondary')}</Badge>}<StatusBadge status={wh.isActive ? 'active' : 'inactive'} label={wh.isActive ? t('common.active') : t('common.inactive')} /></>} subtitle={`${wh.code} · ${branchName(wh.branchId)}`} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard title={t('warehouses.productsCount')} value={stats.data?.skuCount ?? 0} format="number" icon={<Boxes />} />
        <StatCard title={t('warehouses.totalQty')} value={stats.data?.qty ?? 0} format="number" icon={<Layers />} variant="info" />
        {canCost ? <StatCard title={t('warehouses.stockValue')} value={stats.data?.value ?? 0} icon={<Boxes />} variant="success" /> : null}
        <StatCard title={t('warehouses.lowStockItems')} value={stats.data?.low ?? 0} format="number" icon={<AlertTriangle />} variant="warning" />
        <StatCard title={t('inventory.outOfStock')} value={stats.data?.out ?? 0} format="number" icon={<PackageX />} variant="destructive" />
      </div>
      <Tabs defaultValue="stock" className="mt-4">
        <TabsList><TabsTrigger value="stock">{t('common.inventory')}</TabsTrigger><TabsTrigger value="structure">{t('warehouses.structure')}</TabsTrigger><TabsTrigger value="info">{t('common.details')}</TabsTrigger></TabsList>
        <TabsContent value="stock">
          <Section title={t('warehouses.productsCount')} actions={<SearchInput value={search} onChange={setSearch} />}>
            {rows.length === 0 ? <EmptyState /> : (
              <div className="max-h-[60vh] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-2 py-2 text-start font-medium">{t('common.product')}</th><th className="px-2 py-2 text-start font-medium">{t('products.location')}</th><th className="px-2 py-2 text-start font-medium">{t('products.shelf')}</th><th className="px-2 py-2 text-start font-medium">{t('products.bin')}</th><th className="px-2 py-2 text-end font-medium">{t('inventory.reserved')}</th><th className="px-2 py-2 text-end font-medium">{t('common.quantity')}</th>{canCost ? <th className="px-2 py-2 text-end font-medium">{t('common.value')}</th> : null}<th className="px-2 py-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.productId} className="border-t"><td className="px-2 py-1.5"><Link to={`/products/${r.productId}`} className="hover:underline">{tx(r.p!.name)}</Link><div className="text-[10px] text-muted-foreground num">{r.p!.sku}</div></td><td className="px-2 py-1.5 num">{r.locationCode}</td><td className="px-2 py-1.5 num">{r.shelf}</td><td className="px-2 py-1.5 num">{r.bin}</td><td className="px-2 py-1.5 text-end num text-muted-foreground">{r.reserved || '—'}</td><td className="px-2 py-1.5 text-end num font-semibold">{r.quantity}</td>{canCost ? <td className="px-2 py-1.5 text-end"><Money value={r.quantity * r.p!.lastPurchaseCost} /></td> : null}<td className="px-2 py-1.5"><StockBadge qty={r.quantity} min={r.p!.minStock} /></td></tr>)}</tbody></table></div>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="structure">
          <Section title={t('warehouses.structure')} description={`${wh.locations.length} ${t('warehouses.locations')} · ${wh.locations.reduce((a, l) => a + l.shelves.length, 0)} ${t('warehouses.shelves')} · ${wh.locations.reduce((a, l) => a + l.shelves.reduce((x, s) => x + s.bins.length, 0), 0)} ${t('warehouses.bins')}`}>
            {wh.locations.length === 0 ? <EmptyState /> : (
              <div className="space-y-2">
                {wh.locations.map((loc) => { const open = openLoc[loc.id] ?? false; const qtyIn = (levels.data ?? []).filter((l) => l.locationCode === loc.code).reduce((a, l) => a + l.quantity, 0); return (
                  <div key={loc.id} className="rounded-md border">
                    <button type="button" onClick={() => setOpenLoc((o) => ({ ...o, [loc.id]: !open }))} className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm hover:bg-accent/40">
                      {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4 rtl:rotate-180" />}<MapPin className="size-4 text-primary" /><span className="font-medium">{tx(loc.name)}</span><Badge variant="outline">{loc.code}</Badge><span className="ms-auto text-xs text-muted-foreground">{loc.shelves.length} {t('warehouses.shelves')} · <span className="num">{qtyIn}</span> {t('common.piece')}</span>
                    </button>
                    {open ? <div className="grid gap-2 border-t p-3 sm:grid-cols-2 lg:grid-cols-4">{loc.shelves.map((sh) => <div key={sh.id} className="rounded border p-2"><div className="mb-1.5 flex items-center gap-1 text-xs font-medium"><Grid3X3 className="size-3.5" /> {t('products.shelf')} {sh.code}</div><div className="flex flex-wrap gap-1">{sh.bins.map((b) => { const q = (levels.data ?? []).filter((l) => l.bin === b.code).reduce((a, l) => a + l.quantity, 0); return <span key={b.id} className={cn('rounded border px-1.5 py-0.5 text-[10px] num', q ? 'border-primary/40 bg-primary/5' : 'text-muted-foreground')} title={`${q}`}>{b.code}</span>; })}</div></div>)}</div> : null}
                  </div>
                ); })}
              </div>
            )}
          </Section>
        </TabsContent>
        <TabsContent value="info">
          <Section title={t('common.generalInfo')}>
            <KeyValue cols={3} items={[{ label: t('common.code'), value: wh.code }, { label: t('common.nameAr'), value: wh.name.ar }, { label: t('common.nameEn'), value: wh.name.en }, { label: t('warehouses.assignedBranch'), value: <Link to={`/branches/${wh.branchId}`} className="text-primary hover:underline">{branchName(wh.branchId)}</Link> }, { label: t('warehouses.capacity'), value: <span className="num">{wh.capacity}</span> }, { label: t('warehouses.utilization'), value: <div className="flex items-center gap-2"><Progress value={stats.data?.utilization ?? 0} className="w-24" /><span className="num text-xs">{stats.data?.utilization ?? 0}%</span></div> }]} />
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
