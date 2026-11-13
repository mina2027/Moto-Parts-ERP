import * as React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Check, Pencil, Percent, Tags, X, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, HintBanner } from '@/components/shared/page';
import { FormField } from '@/components/shared/form';
import { StatusBadge } from '@/components/shared/status-badge';
import { productService, customerService } from '@/services';
import type { ProductWithStock } from '@/services/productService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { cn, formatDate, formatDateTime, round2 } from '@/lib/utils';
import type { PriceHistoryEntry, ProductUpdateInput, SpecialPrice } from '@/types';
import { bulkPriceTargets } from './bulkPrices';
import { productCategoryIds } from '@moto/shared';

type Field = 'retail1' | 'retail2' | 'wholesale' | 'purchasePrice';
const FIELDS: Field[] = ['purchasePrice', 'retail1', 'retail2', 'wholesale'];

const valueOf = (p: ProductWithStock, field: Field): number => (field === 'purchasePrice' ? p.purchasePrice : p.prices[field]);
const patchFor = (field: Field, v: number): ProductUpdateInput => (field === 'purchasePrice' ? { purchasePrice: v } : { prices: { [field]: v } });

export default function PricingPage() {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const ls = useListState({ pageSize: 25 });
  const user = useAuthStore((s) => s.session!.user);
  const canEdit = useAuthStore((s) => s.hasPermission('prices.edit'));
  const canCost = useAuthStore((s) => s.hasPermission('prices.view_cost'));
  const { options, categoryName, brandName, userName, productName, customerName, product } = useLookups();
  const { settings } = useSettings();
  const tierLabels = settings.pricing.tierLabels;
  const fieldLabel = React.useCallback((field: Field) => (field === 'purchasePrice' ? t('products.purchasePrice') : tx(tierLabels[field])), [t, tx, tierLabels]);
  const [editing, setEditing] = React.useState<{ id: string; field: Field; value: string } | null>(null);
  const [reason, setReason] = React.useState('');
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [bulkField, setBulkField] = React.useState<Field>('retail1');
  const [bulkPct, setBulkPct] = React.useState(5);
  const [bulkCategory, setBulkCategory] = React.useState<string>('all');
  const [bulkBusy, setBulkBusy] = React.useState(false);
  const [selection, setSelection] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    const action = location.state as { productId?: string } | null;
    if (!action?.productId || !canEdit) return;
    setSelection({ [action.productId]: true });
    setBulkPct(-5);
    setBulkOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, canEdit, navigate]);

  const pricingQuery = { ...ls.query, categoryId: ls.filters.categoryId, brandId: ls.filters.brandId, isActive: true };
  const q = useQuery({ queryKey: ['products', 'pricing', ls.query], queryFn: () => productService.list(pricingQuery) });
  const history = useQuery({ queryKey: ['priceHistory'], queryFn: () => productService.priceHistory() });
  const special = useQuery({ queryKey: ['specialPrices'], queryFn: () => customerService.specialPrices() });

  const commit = async () => {
    if (!editing) return;
    const v = Number(editing.value);
    if (!v || v < 0) return;
    await productService.update(editing.id, patchFor(editing.field, v), user.id, reason || undefined);
    toast.success(t('pricing.priceUpdated'));
    setEditing(null); setReason('');
    qc.invalidateQueries({ queryKey: ['products'] }); history.refetch();
  };
  const cell = (p: ProductWithStock, field: Field) => {
    const isEditing = editing?.id === p.id && editing.field === field;
    if (isEditing) return <div className="flex items-center justify-end gap-1"><Input autoFocus type="number" step="0.01" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(null); }} className="h-7 w-24 text-end" dir="ltr" /><Button size="icon-xs" variant="ghost" onClick={commit}><Check className="text-success" /></Button><Button size="icon-xs" variant="ghost" onClick={() => setEditing(null)}><X /></Button></div>;
    return <button type="button" disabled={!canEdit} className={cn('group inline-flex items-center gap-1 rounded px-1 py-0.5', canEdit && 'hover:bg-accent')} onClick={() => setEditing({ id: p.id, field, value: String(valueOf(p, field)) })}><Money value={valueOf(p, field)} className={field === 'retail1' ? 'font-medium' : ''} />{canEdit ? <Pencil className="size-3 opacity-0 group-hover:opacity-60" /> : null}</button>;
  };

  const columns = React.useMemo<ColumnDef<ProductWithStock, unknown>[]>(() => [
    { id: 'name', header: t('common.product'), cell: ({ row }) => <div><Link to={`/products/${row.original.id}`} className="font-medium hover:underline">{tx(row.original.name)}</Link><div className="text-[10px] text-muted-foreground">{row.original.sku} · {brandName(row.original.brandId)} · {productCategoryIds(row.original).map(categoryName).join('، ')}</div></div> },
    ...(canCost ? [{ accessorKey: 'lastPurchaseCost', header: t('products.lastPurchaseCost'), cell: ({ row }: { row: { original: ProductWithStock } }) => <Money value={row.original.lastPurchaseCost} className="text-muted-foreground" />, meta: { align: 'end' as const } }, { accessorKey: 'purchasePrice', header: t('products.purchasePrice'), cell: ({ row }: { row: { original: ProductWithStock } }) => cell(row.original, 'purchasePrice'), meta: { align: 'end' as const } }] : []),
    { id: 'retail1', accessorFn: (p) => p.prices.retail1, header: tx(tierLabels.retail1), cell: ({ row }) => cell(row.original, 'retail1'), meta: { align: 'end' } },
    { id: 'retail2', accessorFn: (p) => p.prices.retail2, header: tx(tierLabels.retail2), cell: ({ row }) => cell(row.original, 'retail2'), meta: { align: 'end' } },
    { id: 'wholesale', accessorFn: (p) => p.prices.wholesale, header: tx(tierLabels.wholesale), cell: ({ row }) => cell(row.original, 'wholesale'), meta: { align: 'end' } },
    ...(canCost ? (['retail1', 'retail2', 'wholesale'] as const).map((tier) => ({ id: `${tier}Margin`, header: `${t('products.margin')} ${tx(tierLabels[tier])}`, cell: ({ row }: { row: { original: ProductWithStock } }) => { const price = row.original.prices[tier]; const m = price ? ((price - row.original.lastPurchaseCost) / price) * 100 : 0; return <span className={cn('num text-xs font-medium', m < 10 ? 'text-destructive' : m < 20 ? 'text-amber-600' : 'text-success')}>{m.toFixed(1)}%</span>; }, meta: { align: 'end' as const } })) : []),
    { id: 'updated', header: t('common.updatedAt'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{formatDate(row.original.updatedAt, locale)}</span> },
  ], [t, tx, brandName, categoryName, canCost, canEdit, editing, locale, tierLabels]);  

  const histCols = React.useMemo<ColumnDef<PriceHistoryEntry, unknown>[]>(() => [
    { accessorKey: 'date', header: t('pricing.changedAt'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'product', header: t('common.product'), cell: ({ row }) => <Link to={`/products/${row.original.productId}`} className="hover:underline">{productName(row.original.productId)}</Link> },
    { accessorKey: 'field', header: t('pricing.field'), cell: ({ row }) => <StatusBadge status="open" label={fieldLabel(row.original.field)} /> },
    { accessorKey: 'oldValue', header: t('pricing.oldValue'), cell: ({ row }) => <Money value={row.original.oldValue} className="text-muted-foreground" />, meta: { align: 'end' } },
    { accessorKey: 'newValue', header: t('pricing.newValue'), cell: ({ row }) => <span className="inline-flex items-center gap-1"><Money value={row.original.newValue} className="font-medium" /><span className={cn('text-[10px] num', row.original.newValue >= row.original.oldValue ? 'text-success' : 'text-destructive')}>({row.original.newValue >= row.original.oldValue ? '+' : ''}{(((row.original.newValue - row.original.oldValue) / row.original.oldValue) * 100).toFixed(1)}%)</span></span>, meta: { align: 'end' } },
    { id: 'user', header: t('pricing.changedBy'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { accessorKey: 'reason', header: t('common.reason'), cell: ({ row }) => <span className="text-xs text-muted-foreground">{row.original.reason ?? '—'}</span> },
  ], [t, locale, productName, userName, fieldLabel]);
  const spCols = React.useMemo<ColumnDef<SpecialPrice, unknown>[]>(() => [
    { id: 'customer', header: t('common.customer'), cell: ({ row }) => <Link to={`/customers/${row.original.customerId}`} className="font-medium hover:underline">{customerName(row.original.customerId)}</Link> },
    { id: 'product', header: t('common.product'), cell: ({ row }) => <Link to={`/products/${row.original.productId}`} className="hover:underline">{productName(row.original.productId)}</Link> },
    { id: 'retail', header: tx(tierLabels.retail1), cell: ({ row }) => <Money value={product(row.original.productId)?.prices.retail1 ?? 0} className="text-muted-foreground" />, meta: { align: 'end' } },
    { accessorKey: 'price', header: t('customers.specialPricing'), cell: ({ row }) => <Money value={row.original.price} className="font-medium text-success" />, meta: { align: 'end' } },
    { accessorKey: 'validFrom', header: t('pricing.validFrom'), cell: ({ row }) => <span className="num text-xs">{formatDate(row.original.validFrom, locale)}</span> },
    { accessorKey: 'validTo', header: t('pricing.validTo'), cell: ({ row }) => { const exp = row.original.validTo && new Date(row.original.validTo) < new Date(); return <span className={cn('num text-xs', exp && 'text-destructive')}>{row.original.validTo ? formatDate(row.original.validTo, locale) : t('pricing.indefinite')}</span>; } },
  ], [t, tx, locale, customerName, productName, product, tierLabels]);

  const exportPayload = async () => {
    const full = await productService.list({ ...pricingQuery, page: 1, pageSize: 500 });
    return {
      filename: 'price-list',
      title: t('pricing.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.filters'), value: [ls.filters.categoryId && categoryName(ls.filters.categoryId), ls.filters.brandId && brandName(ls.filters.brandId)].filter(Boolean).join(' · ') || '—' },
        { label: t('common.branch'), value: t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  const runBulk = async () => {
    if (bulkBusy || !canEdit || !Number.isFinite(bulkPct) || bulkPct < -100) return;
    setBulkBusy(true);
    let updated = 0;
    try {
      const targets = await bulkPriceTargets(productService, selection, bulkCategory);
      if (!targets.length) { toast.info(t('common.noResults')); return; }
      for (const p of targets) {
        await productService.update(p.id, patchFor(bulkField, round2(valueOf(p, bulkField) * (1 + bulkPct / 100))), user.id, `${t('pricing.bulkUpdate')} ${bulkPct}%`);
        updated++;
      }
      toast.success(`${t('pricing.priceUpdated')} (${updated})`);
      setBulkOpen(false); setSelection({});
    } catch (error) {
      toast.error(`${(error as Error).message} (${t('pricing.priceUpdated')}: ${updated})`);
    } finally {
      setBulkBusy(false);
      qc.invalidateQueries({ queryKey: ['products'] }); history.refetch();
    }
  };

  return (
    <div>
      <PageHeader title={t('pricing.title')} subtitle={t('pricing.subtitle')} actions={<><ExportMenu payload={exportPayload} />{canEdit ? <Button onClick={() => setBulkOpen(true)}><Percent /> {t('pricing.bulkUpdate')}</Button> : null}</>} />
      {!canEdit ? <Alert variant="info" icon={<Lock />} className="mb-3">{t('pricing.noPermission')}</Alert> : <HintBanner text={`${t('pricing.editPrices')}: ${t('compat.toggleHint')}`} />}
      {editing ? <div className="mb-3 flex items-center gap-2 rounded-md border bg-primary/5 p-2 text-sm"><Tags className="size-4 text-primary" /><span>{t('products.changeReason')}:</span><Input value={reason} onChange={(e) => setReason(e.target.value)} className="h-7 max-w-xs" placeholder={t('common.optional')} /></div> : null}
      <Tabs defaultValue="list">
        <TabsList><TabsTrigger value="list">{t('pricing.priceList')}</TabsTrigger><TabsTrigger value="special">{t('pricing.specialPrices')}</TabsTrigger><TabsTrigger value="history">{t('pricing.priceHistory')}</TabsTrigger></TabsList>
        <TabsContent value="list">
          <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} sorting={ls.sorting} onSortingChange={ls.setSorting} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} getRowId={(p) => p.id} dense enableSelection={canEdit} rowSelection={selection} onRowSelectionChange={setSelection}
            bulkActions={() => <Button size="xs" onClick={() => setBulkOpen(true)}><Percent /> {t('pricing.bulkUpdate')}</Button>}
            toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}><FilterSelect value={ls.filters.categoryId} onChange={(v) => ls.setFilter('categoryId', v)} options={options.categories} allLabel={t('common.category')} /><FilterSelect value={ls.filters.brandId} onChange={(v) => ls.setFilter('brandId', v)} options={options.brands} allLabel={t('common.brand')} width="w-32" /></FilterBar></>} />
        </TabsContent>
        <TabsContent value="special"><DataTable columns={spCols} data={special.data ?? []} isLoading={special.isLoading} isError={special.isError} onRetry={special.refetch} dense /></TabsContent>
        <TabsContent value="history"><DataTable columns={histCols} data={history.data ?? []} isLoading={history.isLoading} isError={history.isError} onRetry={history.refetch} dense /></TabsContent>
      </Tabs>

      <Dialog open={bulkOpen} onOpenChange={(open) => { if (!bulkBusy) setBulkOpen(open); }}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{t('pricing.bulkUpdate')}</DialogTitle><DialogDescription>{Object.keys(selection).length ? `${Object.keys(selection).length} ${t('common.selected')}` : t('pricing.applyTo')}</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <FormField label={t('pricing.field')}><Select value={bulkField} onValueChange={(v) => setBulkField(v as Field)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{FIELDS.filter((f) => f !== 'purchasePrice' || canCost).map((f) => <SelectItem key={f} value={f}>{fieldLabel(f)}</SelectItem>)}</SelectContent></Select></FormField>
            <FormField label={`${bulkPct >= 0 ? t('pricing.increaseBy') : t('pricing.decreaseBy')} %`}><Input type="number" value={bulkPct} onChange={(e) => setBulkPct(Number(e.target.value))} dir="ltr" /></FormField>
            {!Object.keys(selection).length ? <FormField label={t('common.category')}><Select value={bulkCategory} onValueChange={setBulkCategory}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('common.all')}</SelectItem>{options.categories.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select></FormField> : null}
            <Alert variant="warning">{t('common.irreversible')}</Alert>
          </div>
          <DialogFooter><Button variant="outline" disabled={bulkBusy} onClick={() => setBulkOpen(false)}>{t('common.cancel')}</Button><Button loading={bulkBusy} disabled={!Number.isFinite(bulkPct) || bulkPct < -100} onClick={runBulk}>{t('common.apply')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
