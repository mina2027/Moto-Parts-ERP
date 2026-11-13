import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormGrid, SelectField, TextField, FormField, SwitchField } from '@/components/shared/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Barcode } from '@/components/shared/barcode';
import { productService, ApiError } from '@/services';
import { useAuthStore, useCurrentUser } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { productCategoryIds } from '@moto/shared';
import { Combobox } from '@/components/shared/pickers';
import type { Product, Warehouse } from '@/types';

const SHELF_SEP = '::';
const NO_BIN = '__none';
const shelvesOf = (wh?: Warehouse) => (wh?.locations ?? []).flatMap((loc) => loc.shelves.map((sh) => ({ loc, sh, key: `${loc.code}${SHELF_SEP}${sh.code}` })));

export function ProductFormDialog({ open, onOpenChange, product, onSaved, defaultCategoryId }: { open: boolean; onOpenChange: (o: boolean) => void; product?: Product | null; onSaved?: (p: Product) => void; defaultCategoryId?: string }) {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const canEditPrice = useAuthStore((s) => s.hasPermission('prices.edit'));
  const { options, warehouses, categories = [] } = useLookups();
  const user = useCurrentUser();
  const { settings } = useSettings();
  const tierLabels = settings.pricing.tierLabels;
  const schema = z
    .object({
      nameAr: z.string().optional(),
      nameEn: z.string().optional(),
      sku: z.string().optional(),
      partNumber: z.string().optional(),
      brandId: z.string().min(1, t('validation.required')),
      categoryIds: z.array(z.string().min(1)).min(1, t('validation.required')).max(100),
      supplierId: z.string().optional(),
    size: z.string().max(60).optional(),
    purchasePrice: z.coerce.number().min(0, t('validation.nonNegative')),
    retail1: z.coerce.number().positive(t('validation.positive')),
    retail2: z.coerce.number().min(0, t('validation.nonNegative')),
    wholesale: z.coerce.number().min(0, t('validation.nonNegative')),
    maxDiscountAmount: z.coerce.number().min(0, t('validation.nonNegative')),
    minStock: z.coerce.number().int(t('validation.integer')).min(0),
    unit: z.enum(['piece', 'set', 'liter']),
      changeReason: z.string().optional(),
      legacyBarcode: z.string().max(40).optional(),
      isQuickProduct: z.boolean(),
      warehouseId: z.string().optional(),
      shelf: z.string().max(20).optional(),
      bin: z.string().max(20).optional(),
    })
    // Either language alone is enough; the system must never block a save over a missing English name.
    .refine((v) => Boolean(v.nameAr?.trim() || v.nameEn?.trim()), { message: t('products.nameRequired'), path: ['nameAr'] })
    .refine((v) => !v.sku?.trim() || v.sku.trim().length >= 3, { message: t('validation.minLength', { n: 3 }), path: ['sku'] });
  type F = z.infer<typeof schema>;
  const unitOf = (p?: Product | null): F['unit'] => (p?.unit.ar === 'طقم' || p?.unit.en === 'Set' ? 'set' : p?.unit.ar === 'لتر' || p?.unit.en === 'Liter' ? 'liter' : 'piece');
  const defaults = (p?: Product | null): F => ({
    nameAr: p?.name.ar ?? '',
    nameEn: p?.name.en ?? '',
    sku: p?.sku ?? '',
    partNumber: p?.partNumber ?? '',
    brandId: p?.brandId ?? '',
    categoryIds: p ? productCategoryIds(p) : defaultCategoryId ? [defaultCategoryId] : [],
    supplierId: p?.supplierId ?? '',
    size: p?.size ?? '',
    purchasePrice: (p?.purchasePrice ?? '') as F['purchasePrice'],
    retail1: (p?.prices.retail1 ?? '') as F['retail1'],
    retail2: (p?.prices.retail2 ?? '') as F['retail2'],
    wholesale: (p?.prices.wholesale ?? '') as F['wholesale'],
    maxDiscountAmount: (p?.maxDiscountAmount ?? '') as F['maxDiscountAmount'],
    minStock: p?.minStock ?? 10,
    unit: unitOf(p),
    changeReason: '',
    legacyBarcode: p?.legacyBarcode ?? '',
    isQuickProduct: p?.isQuickProduct ?? true,
    warehouseId: '',
    shelf: '',
    bin: '',
  });
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: defaults(product) });
  const selectedCategories = form.watch('categoryIds');
  const initialPlacement = React.useRef<{ warehouseId: string; shelf: string; bin: string } | null>(null);
  React.useEffect(() => {
    if (open) {
      form.reset(defaults(product));
      initialPlacement.current = null;
    }
  }, [open, product, defaultCategoryId]);

  // Placement (warehouse → shelf → bin) lives on the stock level, so it is loaded separately from the product.
  const levels = useQuery({ queryKey: ['product', product?.id, 'levels'], queryFn: () => productService.stockLevels(product!.id), enabled: open && !!product });
  const activeWarehouses = React.useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);
  const placementFor = React.useCallback(
    (warehouseId: string) => {
      const wh = activeWarehouses.find((w) => w.id === warehouseId);
      const level = levels.data?.find((l) => l.warehouseId === warehouseId);
      if (!wh || !level) return { shelf: '', bin: '' };
      const structured = shelvesOf(wh);
      if (!structured.length) return { shelf: level.shelf ?? '', bin: level.bin ?? '' };
      const hit = structured.find((s) => s.loc.code === level.locationCode && s.sh.code === level.shelf);
      return hit ? { shelf: hit.key, bin: hit.sh.bins.some((b) => b.code === level.bin) ? level.bin : NO_BIN } : { shelf: '', bin: '' };
    },
    [activeWarehouses, levels.data],
  );
  React.useEffect(() => {
    if (!open) {
      initialPlacement.current = null;
      return;
    }
    if (initialPlacement.current || !activeWarehouses.length || (product && !levels.data)) return;
    const mine = activeWarehouses.filter((w) => w.branchId === user?.branchId);
    const warehouseId = (mine.find((w) => w.isMain) ?? mine[0] ?? activeWarehouses.find((w) => w.isMain) ?? activeWarehouses[0])!.id;
    const init = { warehouseId, ...placementFor(warehouseId) };
    initialPlacement.current = init;
    form.setValue('warehouseId', init.warehouseId);
    form.setValue('shelf', init.shelf);
    form.setValue('bin', init.bin);
  }, [open, product, activeWarehouses, levels.data, user?.branchId, placementFor]);

  const warehouseId = form.watch('warehouseId');
  const shelfKey = form.watch('shelf');
  const warehouse = activeWarehouses.find((w) => w.id === warehouseId);
  const shelfChoices = shelvesOf(warehouse);
  const structured = shelfChoices.length > 0;
  const chosenShelf = shelfChoices.find((s) => s.key === shelfKey);
  const onWarehouseChange = (id: string) => {
    // Radix's hidden native select re-emits (or blanks) the value while options mount; only real changes count.
    if (!id || id === form.getValues('warehouseId')) return;
    form.setValue('warehouseId', id, { shouldDirty: true });
    const next = placementFor(id);
    form.setValue('shelf', next.shelf, { shouldDirty: true });
    form.setValue('bin', next.bin, { shouldDirty: true });
  };

  const [newBrand, setNewBrand] = React.useState<string | null>(null);
  const [addingBrand, setAddingBrand] = React.useState(false);
  const addBrand = async () => {
    const name = newBrand?.trim() ?? '';
    if (name.length < 2) return;
    setAddingBrand(true);
    try {
      const brand = await productService.addBrand({ name: { ar: name } });
      await qc.invalidateQueries({ queryKey: ['brands'] });
      form.setValue('brandId', brand.id, { shouldValidate: true, shouldDirty: true });
      setNewBrand(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setAddingBrand(false);
    }
  };

  const [newCategory, setNewCategory] = React.useState<string | null>(null);
  const [addingCategory, setAddingCategory] = React.useState(false);
  const addCategory = async () => {
    const name = newCategory?.trim() ?? '';
    if (name.length < 2) return;
    setAddingCategory(true);
    try {
      const cat = await productService.addCategory({ name: { ar: name } });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      form.setValue('categoryIds', [...new Set([...form.getValues('categoryIds'), cat.id])], { shouldValidate: true, shouldDirty: true });
      setNewCategory(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setAddingCategory(false);
    }
  };

  const retail = form.watch('retail1');
  const cost = form.watch('purchasePrice');
  const unitNames = { piece: { ar: 'قطعة', en: 'Piece' }, set: { ar: 'طقم', en: 'Set' }, liter: { ar: 'لتر', en: 'Liter' } };

  const placementOf = (v: F) => {
    const shelf = v.shelf?.trim() ?? '';
    if (!v.warehouseId || !shelf) return undefined;
    const init = initialPlacement.current;
    if (product && init && init.warehouseId === v.warehouseId && init.shelf === shelf && init.bin === (v.bin ?? '')) return undefined;
    const bin = !v.bin || v.bin === NO_BIN ? '' : v.bin.trim();
    if (!structured) return { warehouseId: v.warehouseId, locationCode: '', shelf, bin };
    const [locationCode = '', shelfCode = ''] = shelf.split(SHELF_SEP);
    return { warehouseId: v.warehouseId, locationCode, shelf: shelfCode, bin };
  };

  const submit = form.handleSubmit(async (v) => {
    const payload = {
      name: { ar: v.nameAr?.trim() ?? '', en: v.nameEn?.trim() || undefined },
      sku: v.sku?.trim() || undefined,
      partNumber: v.partNumber?.trim() ?? '',
      brandId: v.brandId,
      categoryId: v.categoryIds[0]!,
      categoryIds: v.categoryIds,
      supplierId: v.supplierId ?? '',
      size: v.size?.trim() || undefined,
      purchasePrice: v.purchasePrice,
      prices: { retail1: v.retail1, retail2: v.retail2 || v.retail1, wholesale: v.wholesale || v.retail1 },
      maxDiscountAmount: v.maxDiscountAmount,
      minStock: v.minStock,
      unit: unitNames[v.unit],
      legacyBarcode: v.legacyBarcode?.trim() || undefined,
      isQuickProduct: v.isQuickProduct,
      placement: placementOf(v),
    };
    try {
      const saved = product
        ? await productService.update(product.id, payload, undefined, v.changeReason)
        : await productService.create({ ...payload, lastPurchaseCost: v.purchasePrice, compatibleModelIds: [], alternativeProductIds: [], isActive: true });
      toast.success(product ? t('common.updated') : t('common.created'));
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', saved.id] });
      qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
      if (payload.placement) qc.invalidateQueries({ queryKey: ['inventory', 'levels'] });
      onSaved?.(saved);
      onOpenChange(false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SKU_EXISTS') form.setError('sku', { message: t('validation.unique') });
      else if (e instanceof ApiError && e.code === 'BARCODE_EXISTS') form.setError('legacyBarcode', { message: t('validation.unique') });
      else if (e instanceof ApiError && e.code === 'INVALID_PLACEMENT') form.setError('shelf', { message: t('products.invalidShelf') });
      else if (e instanceof ApiError && e.code === 'INVALID_CATEGORY') form.setError('categoryIds', { message: t('products.invalidCategory') });
      else toast.error(e instanceof Error ? e.message : t('common.error'));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader>
          <DialogTitle>{product ? t('products.editProduct') : t('products.addProduct')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">{t('products.generalTab')}</TabsTrigger>
              <TabsTrigger value="pricing">{t('products.pricingTab')}</TabsTrigger>
            </TabsList>
            <TabsContent value="general">
              <FormGrid cols={3}>
                <TextField control={form.control} name="nameAr" label={t('products.nameAr')} required />
                <TextField control={form.control} name="nameEn" label={t('products.nameEn')} hint={t('common.optional')} dir="ltr" />
                <SelectField control={form.control} name="unit" label={t('common.unit')} options={[{ value: 'piece', label: t('products.unitPiece') }, { value: 'set', label: t('products.unitSet') }, { value: 'liter', label: t('products.unitLiter') }]} />
                <FormField label={t('products.internalBarcode')} hint={product ? undefined : t('upgrade.barcodeAutoHint')}>
                  {product ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2 py-1">
                      <Barcode value={product.internalBarcode} height={24} barWidth={1.1} fontSize={8} />
                    </div>
                  ) : (
                    <Input value={t('upgrade.barcodeAuto')} readOnly dir="ltr" className="text-muted-foreground" />
                  )}
                </FormField>
                <TextField control={form.control} name="sku" label={t('products.sku')} required dir="ltr" />
                <TextField control={form.control} name="partNumber" label={t('products.partNumber')} dir="ltr" />
                {newBrand === null ? (
                  <div className="flex items-end gap-1 self-start">
                    <SelectField control={form.control} name="brandId" label={t('products.brand')} options={options.brands} required placeholder={t('common.selectBrand')} className="min-w-0 flex-1" />
                    <Button type="button" variant="outline" size="icon" title={t('products.newBrand')} aria-label={t('products.newBrand')} onClick={() => setNewBrand('')}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <FormField label={t('products.newBrand')} required hint={t('products.newBrandHint')}>
                    <div className="flex items-center gap-1">
                      <Input
                        value={newBrand}
                        autoFocus
                        placeholder={t('products.newBrandPlaceholder')}
                        onChange={(e) => setNewBrand(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addBrand();
                          }
                        }}
                      />
                      <Button type="button" size="sm" onClick={addBrand} loading={addingBrand} disabled={newBrand.trim().length < 2}>
                        {t('common.add')}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={() => setNewBrand(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </FormField>
                )}
                {newCategory === null ? (
                  <FormField label={t('products.categories')} required hint={t('products.categoriesHint')} error={form.formState.errors.categoryIds?.message}>
                  <div className="flex items-center gap-1">
                    <Combobox value={null} options={options.categories.filter(c => !selectedCategories.includes(c.value))} ariaLabel={t('products.categories')} placeholder={t('common.selectCategory')} disabled={selectedCategories.length >= 100} onChange={(id) => { if (id) form.setValue('categoryIds', [...selectedCategories, id], { shouldValidate: true, shouldDirty: true }); }} className="min-w-0 flex-1" />
                    <Button type="button" variant="outline" size="icon" title={t('products.newCategory')} aria-label={t('products.newCategory')} onClick={() => setNewCategory('')}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                  {selectedCategories.length ? <div className="flex flex-wrap gap-1.5">
                    {selectedCategories.map(id => {
                      const label = options.categories.find(c => c.value === id)?.label || tx(categories.find(c => c.id === id)?.name) || t('common.category');
                      return <span key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted px-2 py-1 text-xs"><span className="break-words">{label}</span><button type="button" aria-label={`${t('common.delete')}: ${label}`} onClick={() => form.setValue('categoryIds', selectedCategories.filter(c => c !== id), { shouldValidate: true, shouldDirty: true })} className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-3" /></button></span>;
                    })}
                  </div> : null}
                  </FormField>
                ) : (
                  <FormField label={t('products.newCategory')} required hint={t('products.newCategoryHint')}>
                    <div className="flex items-center gap-1">
                      <Input
                        value={newCategory}
                        autoFocus
                        placeholder={t('products.newCategoryPlaceholder')}
                        onChange={(e) => setNewCategory(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void addCategory();
                          }
                        }}
                      />
                      <Button type="button" size="sm" onClick={addCategory} loading={addingCategory} disabled={newCategory.trim().length < 2}>
                        {t('common.add')}
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={() => setNewCategory(null)}>
                        <X className="size-4" />
                      </Button>
                    </div>
                  </FormField>
                )}
                <TextField control={form.control} name="size" label={t('products.size')} hint={t('products.sizeHint')} dir="ltr" placeholder="90/90-17" />
                <SelectField control={form.control} name="supplierId" label={t('products.supplier')} options={options.suppliers} placeholder={t('common.selectSupplier')} />
                <TextField control={form.control} name="minStock" type="number" label={t('products.minStock')} dir="ltr" />
                <FormField label={t('common.warehouse')} hint={t('products.shelfHint')}>
                  <Select value={warehouseId ?? ''} onValueChange={onWarehouseChange} disabled={!activeWarehouses.length}>
                    <SelectTrigger id="warehouseId"><SelectValue placeholder={t('common.selectWarehouse')} /></SelectTrigger>
                    <SelectContent>
                      {activeWarehouses.map((w) => <SelectItem key={w.id} value={w.id}>{tx(w.name)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                {structured || !warehouse ? (
                  <FormField label={t('products.shelf')} error={form.formState.errors.shelf?.message}>
                    <Select
                      value={shelfKey ?? ''}
                      onValueChange={(key) => {
                        if (!key || key === form.getValues('shelf')) return;
                        form.setValue('shelf', key, { shouldDirty: true });
                        form.setValue('bin', NO_BIN, { shouldDirty: true });
                        form.clearErrors('shelf');
                      }}
                      disabled={!warehouse}
                    >
                      <SelectTrigger id="shelf" className={form.formState.errors.shelf ? 'border-destructive' : undefined}><SelectValue placeholder={t('products.selectShelf')} /></SelectTrigger>
                      <SelectContent>
                        {shelfChoices.map((s) => <SelectItem key={s.key} value={s.key}>{`${s.sh.code} — ${tx(s.loc.name) || s.loc.code}`}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : (
                  <TextField control={form.control} name="shelf" label={t('products.shelf')} hint={t('products.shelfFreeHint')} dir="ltr" placeholder="A1" />
                )}
                {structured ? (
                  <FormField label={t('products.bin')}>
                    <Select value={form.watch('bin') ?? ''} onValueChange={(code) => code && form.setValue('bin', code, { shouldDirty: true })} disabled={!chosenShelf}>
                      <SelectTrigger id="bin"><SelectValue placeholder={t('products.noBin')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_BIN}>{t('products.noBin')}</SelectItem>
                        {(chosenShelf?.sh.bins ?? []).map((b) => <SelectItem key={b.id} value={b.code}>{b.code}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormField>
                ) : warehouse ? (
                  <TextField control={form.control} name="bin" label={t('products.bin')} hint={t('common.optional')} dir="ltr" placeholder="A1-1" />
                ) : null}
                <TextField control={form.control} name="legacyBarcode" label={t('upgrade.legacyBarcode')} hint={t('upgrade.legacyBarcodeHint')} dir="ltr" placeholder="6221031000000" />
                <SwitchField control={form.control} name="isQuickProduct" label={t('products.isQuickProduct')} hint={t('products.isQuickProductHint')} className="md:col-span-2" />
              </FormGrid>
            </TabsContent>
            <TabsContent value="pricing">
              <FormGrid cols={4}>
                <TextField control={form.control} name="purchasePrice" type="number" label={t('products.purchasePrice')} dir="ltr" disabled={!!product && !canEditPrice} step="0.01" />
                <TextField control={form.control} name="retail1" type="number" label={tx(tierLabels.retail1)} dir="ltr" disabled={!!product && !canEditPrice} step="0.01" required />
                <TextField control={form.control} name="retail2" type="number" label={tx(tierLabels.retail2)} dir="ltr" disabled={!!product && !canEditPrice} step="0.01" />
                <TextField control={form.control} name="wholesale" type="number" label={tx(tierLabels.wholesale)} dir="ltr" disabled={!!product && !canEditPrice} step="0.01" />
                <TextField control={form.control} name="maxDiscountAmount" type="number" label={t('products.maxDiscountAmount')} hint={t('products.maxDiscountHint')} dir="ltr" disabled={!!product && !canEditPrice} step="0.01" />
              </FormGrid>
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                {[['retail1', tierLabels.retail1, retail], ['retail2', tierLabels.retail2, form.watch('retail2')], ['wholesale', tierLabels.wholesale, form.watch('wholesale')]].map(([key, label, value]) => {
                  const tierMargin = value && cost ? ((Number(value) - cost) / Number(value)) * 100 : 0;
                  return <span key={key as string} className="inline-flex items-center gap-1"><span className="text-muted-foreground">{tx(label as typeof tierLabels.retail1)}:</span><span className={`font-semibold num ${tierMargin < 10 ? 'text-destructive' : tierMargin < 20 ? 'text-amber-600' : 'text-success'}`}>{tierMargin.toFixed(1)}%</span></span>;
                })}
                {retail > 0 && retail < cost ? <span className="text-xs text-destructive">{t('pricing.belowCost')}</span> : null}
              </div>
              {product && canEditPrice ? (
                <div className="mt-3">
                  <TextField control={form.control} name="changeReason" label={t('products.changeReason')} hint={t('common.optional')} />
                </div>
              ) : null}
              {product && !canEditPrice ? <p className="mt-2 text-xs text-muted-foreground">{t('pricing.noPermission')}</p> : null}
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={form.formState.isSubmitting}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
