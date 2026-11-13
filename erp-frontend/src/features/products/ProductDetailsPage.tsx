import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, Package, Pencil, Power, PowerOff, Printer, RefreshCw, Replace, Tag, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge, StockBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { ConfirmDialog, useConfirm } from '@/components/shared/confirm-dialog';
import { Barcode } from '@/components/shared/barcode';
import { Combobox } from '@/components/shared/pickers';
import { ProductFormDialog } from './ProductFormDialog';
import { ApiError, productService, inventoryService, reportService, salesService, purchaseService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { productCategoryIds } from '@moto/shared';
import { formatDate, formatDateTime, formatNumber } from '@/lib/utils';

export default function ProductDetailsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { confirm, dialog } = useConfirm();
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const actor = useAuthStore((s) => s.session!.user);
  const { brandName, categoryName, supplierName, branchName, warehouseName, userName, modelName, productName, models, options } = useLookups();
  const { settings } = useSettings();
  const tierLabels = settings.pricing.tierLabels;
  const [editOpen, setEditOpen] = React.useState(false);
  const [toggleOpen, setToggleOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [altPick, setAltPick] = React.useState<string | null>(null);

  const q = useQuery({ queryKey: ['product', id], queryFn: () => productService.get(id) });
  const levels = useQuery({ queryKey: ['product', id, 'levels'], queryFn: () => productService.stockLevels(id) });
  const moves = useQuery({ queryKey: ['movements', { productId: id }], queryFn: () => inventoryService.movementsForProduct(id, 30) });
  const prices = useQuery({ queryKey: ['priceHistory', id], queryFn: () => productService.priceHistory({ productId: id }) });
  const audit = useQuery({ queryKey: ['audit', { entityId: id }], queryFn: () => reportService.auditLogs({ pageSize: 30, search: id }) });
  const purchasesQ = useQuery({ queryKey: ['purchases', { productId: id }], queryFn: () => purchaseService.list({ productId: id, pageSize: 20 }) });
  const salesQ = useQuery({ queryKey: ['sales', { productId: id }], queryFn: () => salesService.list({ productId: id, pageSize: 20 }) });
  const canCost = hasPermission('prices.view_cost');
  const canEdit = hasPermission('inventory.adjust') || hasPermission('prices.edit');
  const canRegenerate = hasPermission('settings.edit');

  const deleteProduct = async () => {
    if (!await confirm({ title: t('products.deleteConfirm'), description: t('products.deleteDesc', { name: tx(q.data?.name) }), confirmText: t('products.deleteProduct'), variant: 'destructive' })) return;
    setDeleting(true);
    try {
      await productService.delete(id);
      toast.success(t('common.deleted'));
      navigate('/products', { replace: true });
      qc.setQueryData(['product', id], null);
      void qc.invalidateQueries({ queryKey: ['product', id], refetchType: 'none' });
      void qc.invalidateQueries({ queryKey: ['products'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      void qc.invalidateQueries({ queryKey: ['audit'] });
      for (const queryKey of [['pos'], ['quick'], ['specialPrices'], ['customer'], ['warehouse'], ['warehouses'], ['reports']]) void qc.invalidateQueries({ queryKey });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PRODUCT_HAS_STOCK') toast.error(t('products.deleteHasStock'));
      else if (e instanceof ApiError && e.code === 'PRODUCT_HAS_RESERVATIONS') toast.error(t('products.deleteHasReservations'));
      else toast.error(e instanceof Error ? e.message : t('products.deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  const regenerate = async () => {
    await productService.regenerateBarcode(id);
    toast.success(t('upgrade.barcodeRegenerated'));
    qc.invalidateQueries({ queryKey: ['product', id] });
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const p = q.data;
  const purchases = (purchasesQ.data?.data ?? []).filter((x) => x.items.some((i) => i.productId === id));
  const sales = (salesQ.data?.data ?? []).filter((x) => x.status !== 'held' && x.items.some((i) => i.productId === id));
  const marginFor = (price: number) => price ? ((price - p.lastPurchaseCost) / price) * 100 : 0;
  const soldQty = sales.filter((s) => s.status === 'completed').reduce((a, s) => a + (s.items.find((i) => i.productId === id)?.quantity ?? 0), 0);

  return (
    <div>
      <PageHeader
        backTo="/products" title={tx(p.name)}
        badge={<><StockBadge qty={p.totalStock} min={p.minStock} /><StatusBadge status={p.isActive ? 'active' : 'inactive'} label={p.isActive ? t('common.active') : t('common.inactive')} /></>}
        subtitle={<span className="num">{p.sku} · {p.internalBarcode} · {p.partNumber}</span>}
        actions={<>
          <Button variant="outline" asChild><Link to="/products/barcodes" state={{ ids: [p.id] }}><Printer /> {t('barcodes.printLabels')}</Link></Button>
          {canEdit ? <Button variant="outline" onClick={() => setToggleOpen(true)}>{p.isActive ? <PowerOff /> : <Power />} {p.isActive ? t('common.disable') : t('common.enable')}</Button> : null}
          {canEdit ? <Button variant="destructive" loading={deleting} onClick={deleteProduct}><Trash2 /> {t('products.deleteProduct')}</Button> : null}
          {canEdit ? <Button onClick={() => setEditOpen(true)}><Pencil /> {t('common.edit')}</Button> : null}
        </>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('products.totalStock')} value={p.totalStock} format="number" icon={<Package />} variant={p.stockStatus === 'out' ? 'destructive' : p.stockStatus === 'low' ? 'warning' : 'default'} hint={`${t('products.minStock')}: ${p.minStock}`} />
        <StatCard title={tx(tierLabels.retail1)} value={p.prices.retail1} icon={<Tag />} hint={`${tx(tierLabels.retail2)}: ${formatNumber(p.prices.retail2, 2)} · ${tx(tierLabels.wholesale)}: ${formatNumber(p.prices.wholesale, 2)}`} />
        {canCost ? <StatCard title={t('products.lastPurchaseCost')} value={p.lastPurchaseCost} icon={<Tag />} variant="info" hint={`${t('products.margin')}: ${tx(tierLabels.retail1)} ${marginFor(p.prices.retail1).toFixed(1)}% · ${tx(tierLabels.retail2)} ${marginFor(p.prices.retail2).toFixed(1)}% · ${tx(tierLabels.wholesale)} ${marginFor(p.prices.wholesale).toFixed(1)}%`} /> : null}
        <StatCard title={t('dashboard.qtySold')} value={soldQty} format="number" icon={<Tag />} variant="success" />
      </div>

      <Tabs defaultValue="general" className="mt-4">
        <TabsList variant="underline" className="overflow-x-auto">
          <TabsTrigger variant="underline" value="general">{t('products.generalTab')}</TabsTrigger>
          <TabsTrigger variant="underline" value="inventory">{t('products.inventoryTab')}</TabsTrigger>
          <TabsTrigger variant="underline" value="compat">{t('products.compatTab')}</TabsTrigger>
          <TabsTrigger variant="underline" value="purchases">{t('products.purchaseHistory')}</TabsTrigger>
          <TabsTrigger variant="underline" value="sales">{t('products.salesHistory')}</TabsTrigger>
          <TabsTrigger variant="underline" value="moves">{t('products.stockMovement')}</TabsTrigger>
          <TabsTrigger variant="underline" value="prices">{t('products.priceHistory')}</TabsTrigger>
          <TabsTrigger variant="underline" value="audit">{t('products.auditHistory')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('common.generalInfo')} className="lg:col-span-2">
              <KeyValue cols={3} items={[
                { label: t('products.nameAr'), value: p.name.ar }, { label: t('products.nameEn'), value: p.name.en }, { label: t('common.unit'), value: tx(p.unit) },
                { label: t('common.barcode'), value: <span className="num">{p.internalBarcode}</span> }, { label: t('upgrade.legacyBarcode'), value: p.legacyBarcode ? <span className="num text-xs text-muted-foreground">{p.legacyBarcode}</span> : '—' }, { label: t('products.sku'), value: <span className="num">{p.sku}</span> },
                { label: t('products.partNumber'), value: <span className="num">{p.partNumber}</span> }, { label: t('products.brand'), value: brandName(p.brandId) }, { label: t('products.categories'), value: productCategoryIds(p).map(categoryName).join('، ') },
                { label: t('products.size'), value: p.size ? <span className="num">{p.size}</span> : '—' },
                { label: t('products.supplier'), value: p.supplierId ? <Link to={`/suppliers/${p.supplierId}`} className="text-primary hover:underline">{supplierName(p.supplierId)}</Link> : '—' }, { label: t('common.createdAt'), value: formatDate(p.createdAt, locale) }, { label: t('common.updatedAt'), value: formatDate(p.updatedAt, locale) },
              ]} />
              <div className="mt-4 border-t pt-4">
                <h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t('common.pricing')}</h4>
                <KeyValue cols={4} items={[
                  ...(canCost ? [{ label: t('products.purchasePrice'), value: <Money value={p.purchasePrice} /> }, { label: t('products.lastPurchaseCost'), value: <Money value={p.lastPurchaseCost} /> }] : []),
                  { label: tx(tierLabels.retail1), value: <><Money value={p.prices.retail1} className="font-semibold" /> <span className="text-xs text-muted-foreground">({marginFor(p.prices.retail1).toFixed(1)}%)</span></> }, { label: tx(tierLabels.retail2), value: <><Money value={p.prices.retail2} /> <span className="text-xs text-muted-foreground">({marginFor(p.prices.retail2).toFixed(1)}%)</span></> }, { label: tx(tierLabels.wholesale), value: <><Money value={p.prices.wholesale} /> <span className="text-xs text-muted-foreground">({marginFor(p.prices.wholesale).toFixed(1)}%)</span></> },
                  { label: t('products.maxDiscountAmount'), value: <Money value={p.maxDiscountAmount ?? 0} /> },
                ]} />
              </div>
            </Section>
            <div className="space-y-3">
              <Section title={t('common.barcode')} actions={canRegenerate ? <Button size="xs" variant="outline" onClick={regenerate}><RefreshCw /> {t('upgrade.regenerateBarcode')}</Button> : undefined}>
                <div className="flex flex-col items-center gap-3">
                  <div className="flex size-24 items-center justify-center rounded-md border bg-muted text-muted-foreground"><Package className="size-10" /></div>
                  <Barcode value={p.internalBarcode} height={40} />
                  {p.legacyBarcode ? <div className="text-center text-[11px] text-muted-foreground"><div>{t('upgrade.legacyBarcode')}</div><div className="num">{p.legacyBarcode}</div></div> : null}
                </div>
              </Section>
              <Section title={t('products.alternatives')}>
                {p.alternativeProductIds.length ? <ul className="space-y-1 text-sm">{p.alternativeProductIds.map((a) => <li key={a} className="flex items-center justify-between"><Link to={`/products/${a}`} className="hover:underline">{productName(a)}</Link>{canEdit ? <Button size="icon-xs" variant="ghost" onClick={async () => { await productService.setAlternative(p.id, a, false); q.refetch(); }}>×</Button> : null}</li>)}</ul> : <p className="text-xs text-muted-foreground">{t('products.noAlternatives')}</p>}
                {canEdit ? <div className="mt-2 flex gap-1"><Combobox value={altPick} onChange={setAltPick} options={options.products.filter((o) => o.value !== p.id)} size="sm" placeholder={t('common.selectProduct')} /><Button size="sm" variant="outline" disabled={!altPick} onClick={async () => { await productService.setAlternative(p.id, altPick!, true); setAltPick(null); q.refetch(); }}><Replace /></Button></div> : null}
              </Section>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="inventory">
          <Section title={t('products.stockByBranch')}>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.branch')}</th><th className="pb-2 text-start font-medium">{t('common.warehouse')}</th><th className="pb-2 text-start font-medium">{t('products.location')}</th><th className="pb-2 text-start font-medium">{t('products.shelf')}</th><th className="pb-2 text-start font-medium">{t('products.bin')}</th><th className="pb-2 text-end font-medium">{t('inventory.reserved')}</th><th className="pb-2 text-end font-medium">{t('common.quantity')}</th></tr></thead>
              <tbody>{levels.data?.map((l) => <tr key={l.warehouseId} className="border-t"><td className="py-1.5">{branchName(l.branchId)}</td><td className="py-1.5">{warehouseName(l.warehouseId)}</td><td className="py-1.5 num">{l.locationCode}</td><td className="py-1.5 num">{l.shelf}</td><td className="py-1.5 num">{l.bin}</td><td className="py-1.5 text-end num text-muted-foreground">{l.reserved || '—'}</td><td className="py-1.5 text-end"><span className={`num font-medium ${l.quantity === 0 ? 'text-destructive' : ''}`}>{l.quantity}</span></td></tr>)}</tbody>
              <tfoot className="border-t font-semibold"><tr><td colSpan={6} className="pt-2">{t('products.totalStock')}</td><td className="pt-2 text-end num">{p.totalStock}</td></tr></tfoot>
            </table>
          </Section>
        </TabsContent>

        <TabsContent value="compat">
          <Section title={t('products.compatibleModels')} actions={<Button size="sm" variant="outline" asChild><Link to="/products/compatibility"><Bike /> {t('nav.compatibility')}</Link></Button>}>
            <div className="flex flex-wrap gap-2">{models.map((m) => { const on = p.compatibleModelIds.includes(m.id); return <button key={m.id} type="button" disabled={!canEdit} onClick={async () => { await productService.setCompatibility(p.id, m.id, !on); q.refetch(); }} className="disabled:cursor-default"><Badge variant={on ? 'success' : 'outline'} className="cursor-pointer px-2 py-1 text-xs">{on ? '✓ ' : ''}{m.code} · {modelName(m.id)}</Badge></button>; })}</div>
            {!p.compatibleModelIds.length ? <p className="mt-2 text-xs text-muted-foreground">{t('products.noCompatible')}</p> : null}
          </Section>
        </TabsContent>

        <TabsContent value="purchases">
          <Section>{purchases.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoiceNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.supplier')}</th><th className="pb-2 text-end font-medium">{t('common.quantity')}</th>{canCost ? <th className="pb-2 text-end font-medium">{t('purchases.unitCost')}</th> : null}<th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead><tbody>{purchases.map((pu) => { const it = pu.items.find((i) => i.productId === id)!; return <tr key={pu.id} className="border-t"><td className="py-1.5"><Link to={`/purchases/${pu.id}`} className="num text-primary hover:underline">{pu.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDate(pu.date, locale)}</td><td className="py-1.5">{supplierName(pu.supplierId)}</td><td className="py-1.5 text-end num">{it.receivedQty}/{it.quantity}</td>{canCost ? <td className="py-1.5 text-end"><Money value={it.unitCost} /></td> : null}<td className="py-1.5"><StatusBadge status={pu.status} labelKey="purchases.status" /></td></tr>; })}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>

        <TabsContent value="sales">
          <Section>{sales.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoiceNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.branch')}</th><th className="pb-2 text-start font-medium">{t('common.cashier')}</th><th className="pb-2 text-end font-medium">{t('common.quantity')}</th><th className="pb-2 text-end font-medium">{t('sales.unitPrice')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead><tbody>{sales.map((s) => { const it = s.items.find((i) => i.productId === id)!; return <tr key={s.id} className="border-t"><td className="py-1.5"><Link to={`/sales/${s.id}`} className="num text-primary hover:underline">{s.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDateTime(s.date, locale)}</td><td className="py-1.5 text-xs">{branchName(s.branchId)}</td><td className="py-1.5 text-xs">{userName(s.cashierId)}</td><td className="py-1.5 text-end num">{it.quantity}</td><td className="py-1.5 text-end"><Money value={it.unitPrice} /></td><td className="py-1.5"><StatusBadge status={s.status} labelKey="sales.status" /></td></tr>; })}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>

        <TabsContent value="moves">
          <Section actions={<Button size="sm" variant="outline" asChild><Link to={`/inventory/movements?productId=${id}`}>{t('dashboard.viewAll')}</Link></Button>}>
            {moves.data?.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.type')}</th><th className="pb-2 text-end font-medium">{t('common.quantity')}</th><th className="pb-2 text-end font-medium">{t('inventory.previousStock')}</th><th className="pb-2 text-end font-medium">{t('inventory.newStock')}</th><th className="pb-2 text-start font-medium">{t('common.warehouse')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-start font-medium">{t('common.reference')}</th></tr></thead><tbody>{moves.data.map((m) => <tr key={m.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(m.date, locale)}</td><td className="py-1.5"><StatusBadge status={m.quantity >= 0 ? 'increase' : 'decrease'} label={t(`inventory.types.${m.type}`)} /></td><td className={`py-1.5 text-end num font-medium ${m.quantity >= 0 ? 'text-success' : 'text-destructive'}`}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td className="py-1.5 text-end num text-muted-foreground">{m.previousStock}</td><td className="py-1.5 text-end num">{m.newStock}</td><td className="py-1.5 text-xs">{warehouseName(m.warehouseId)}</td><td className="py-1.5 text-xs">{userName(m.userId)}</td><td className="py-1.5 num text-xs">{m.reference}</td></tr>)}</tbody></table> : <EmptyState />}
          </Section>
        </TabsContent>

        <TabsContent value="prices">
          <Section>{prices.data?.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('pricing.field')}</th><th className="pb-2 text-end font-medium">{t('pricing.oldValue')}</th><th className="pb-2 text-end font-medium">{t('pricing.newValue')}</th><th className="pb-2 text-start font-medium">{t('pricing.changedBy')}</th><th className="pb-2 text-start font-medium">{t('common.reason')}</th></tr></thead><tbody>{prices.data.map((h) => <tr key={h.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(h.date, locale)}</td><td className="py-1.5">{h.field === 'purchasePrice' ? t('products.purchasePrice') : tx(tierLabels[h.field])}</td><td className="py-1.5 text-end text-muted-foreground"><Money value={h.oldValue} /></td><td className="py-1.5 text-end font-medium"><Money value={h.newValue} /> <span className={`text-xs ${h.newValue >= h.oldValue ? 'text-success' : 'text-destructive'}`}>({h.newValue >= h.oldValue ? '+' : ''}{(((h.newValue - h.oldValue) / h.oldValue) * 100).toFixed(1)}%)</span></td><td className="py-1.5 text-xs">{userName(h.userId)}</td><td className="py-1.5 text-xs text-muted-foreground">{h.reason ?? '—'}</td></tr>)}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>

        <TabsContent value="audit">
          <Section>{audit.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-start font-medium">{t('common.action')}</th><th className="pb-2 text-start font-medium">{t('common.before')}</th><th className="pb-2 text-start font-medium">{t('common.after')}</th></tr></thead><tbody>{audit.data.data.map((l) => <tr key={l.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(l.date, locale)}</td><td className="py-1.5 text-xs">{userName(l.userId)}</td><td className="py-1.5"><StatusBadge status="open" label={t(`audit.actions.${l.action}`)} /></td><td className="py-1.5 font-mono text-[11px] text-muted-foreground">{l.before ? JSON.stringify(l.before) : '—'}</td><td className="py-1.5 font-mono text-[11px]">{l.after ? JSON.stringify(l.after) : '—'}</td></tr>)}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>
      </Tabs>

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={p} onSaved={() => { q.refetch(); prices.refetch(); }} />
      {dialog}
      <ConfirmDialog open={toggleOpen} onOpenChange={setToggleOpen} title={p.isActive ? t('products.deactivateConfirm') : t('common.enable')} description={p.isActive ? t('products.deactivateDesc') : undefined} variant={p.isActive ? 'warning' : 'success'} onConfirm={async () => { await productService.update(p.id, { isActive: !p.isActive }, actor.id); toast.success(t('common.updated')); q.refetch(); qc.invalidateQueries({ queryKey: ['products'] }); }} />
    </div>
  );
}
