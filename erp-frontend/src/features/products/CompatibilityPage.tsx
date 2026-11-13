import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Bike, Check, Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PageHeader, Section, FilterSelect } from '@/components/shared/page';
import { Combobox } from '@/components/shared/pickers';
import { FormGrid, TextField } from '@/components/shared/form';
import { EmptyState, LoadingState } from '@/components/shared/states';
import { productService } from '@/services';
import { productCategoryIds } from '@moto/shared';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, matchSearch } from '@/lib/utils';

export default function CompatibilityPage() {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission('inventory.adjust'));
  const { options, categoryName, brandName } = useLookups();
  const [search, setSearch] = React.useState('');
  const [categoryId, setCategoryId] = React.useState<string>();
  const [productId, setProductId] = React.useState<string | null>(null);
  const [modelId, setModelId] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);

  const products = useQuery({ queryKey: ['products', 'all'], queryFn: () => productService.all() });
  const models = useQuery({ queryKey: ['models'], queryFn: productService.models });
  const toggle = async (pid: string, mid: string, on: boolean) => {
    await productService.setCompatibility(pid, mid, on);
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['product', pid] });
  };

  const filtered = React.useMemo(() => (products.data ?? []).filter((p) => p.isActive && (!categoryId || productCategoryIds(p).includes(categoryId)) && matchSearch([p.name.ar, p.name.en, p.sku, p.partNumber], search)), [products.data, categoryId, search]);
  const selectedProduct = products.data?.find((p) => p.id === productId);
  const modelProducts = modelId ? (products.data ?? []).filter((p) => p.compatibleModelIds.includes(modelId)) : [];

  const schema = z.object({ code: z.string().min(2, t('validation.required')), nameAr: z.string().min(2, t('validation.required')), nameEn: z.string().optional(), manufacturer: z.string().optional(), engineCc: z.coerce.number().int().min(0, t('validation.nonNegative')), years: z.string().optional() });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: '', nameAr: '', nameEn: '', manufacturer: '', engineCc: 125, years: '' } });
  const addModel = form.handleSubmit(async (v) => { await productService.addModel({ code: v.code, name: { ar: v.nameAr, en: v.nameEn }, manufacturer: v.manufacturer ?? '', engineCc: v.engineCc, years: v.years ?? '' }); toast.success(t('common.created')); models.refetch(); setAddOpen(false); form.reset(); });

  return (
    <div>
      <PageHeader title={t('compat.title')} subtitle={t('compat.subtitle')} backTo="/products" actions={canEdit ? <Button onClick={() => setAddOpen(true)}><Plus /> {t('compat.addModel')}</Button> : null} />
      <Tabs defaultValue="matrix">
        <TabsList><TabsTrigger value="matrix">{t('compat.matrix')}</TabsTrigger><TabsTrigger value="product">{t('compat.byProduct')}</TabsTrigger><TabsTrigger value="model">{t('compat.byModel')}</TabsTrigger></TabsList>

        <TabsContent value="matrix">
          <Section title={t('compat.matrix')} description={canEdit ? t('compat.toggleHint') : undefined} actions={<div className="flex gap-2"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('compat.searchProduct')} className="h-8 w-56" startIcon={<Search />} /><FilterSelect value={categoryId} onChange={(v) => setCategoryId(v === 'all' ? undefined : v)} options={options.categories} allLabel={t('common.category')} /></div>}>
            {products.isLoading || models.isLoading ? <LoadingState /> : (
              <div className="max-h-[65vh] overflow-auto rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 z-10 bg-muted">
                    <tr><th className="sticky start-0 z-20 bg-muted px-3 py-2 text-start font-medium">{t('common.product')}</th>{models.data?.map((m) => <th key={m.id} className="px-2 py-2 text-center font-medium whitespace-nowrap"><div>{m.code}</div><div className="font-normal text-muted-foreground">{m.engineCc}cc</div></th>)}<th className="px-2 py-2 text-center font-medium">{t('compat.productsCount')}</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.id} className="border-t hover:bg-muted/40">
                        <td className="sticky start-0 bg-card px-3 py-1.5"><Link to={`/products/${p.id}`} className="font-medium hover:underline">{tx(p.name)}</Link><div className="text-[10px] text-muted-foreground">{p.partNumber} · {brandName(p.brandId)}</div></td>
                        {models.data?.map((m) => { const on = p.compatibleModelIds.includes(m.id); return <td key={m.id} className="px-2 py-1 text-center"><button type="button" disabled={!canEdit} onClick={() => toggle(p.id, m.id, !on)} className={cn('inline-flex size-6 items-center justify-center rounded border transition-colors', on ? 'border-success bg-success/15 text-success' : 'border-border text-transparent hover:border-muted-foreground', canEdit && 'cursor-pointer')} aria-label={on ? t('compat.compatible') : t('compat.notCompatible')}><Check className="size-3.5" /></button></td>; })}
                        <td className="px-2 py-1 text-center num text-muted-foreground">{p.compatibleModelIds.length}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="product">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('compat.byProduct')}>
              <Combobox value={productId} onChange={setProductId} options={options.products} placeholder={t('common.selectProduct')} />
              {selectedProduct ? <div className="mt-3 space-y-1 text-sm"><div className="font-medium">{tx(selectedProduct.name)}</div><div className="text-xs text-muted-foreground">{selectedProduct.partNumber} · {productCategoryIds(selectedProduct).map(categoryName).join('، ')}</div></div> : null}
            </Section>
            <Section title={t('products.compatibleModels')} className="lg:col-span-2">
              {!selectedProduct ? <EmptyState icon={<Bike />} title={t('common.selectProduct')} /> : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {models.data?.map((m) => { const on = selectedProduct.compatibleModelIds.includes(m.id); return (
                    <button key={m.id} type="button" disabled={!canEdit} onClick={() => toggle(selectedProduct.id, m.id, !on)} className={cn('flex items-center gap-3 rounded-md border p-3 text-start transition-colors', on ? 'border-success bg-success/5' : 'hover:bg-accent')}>
                      <div className={cn('flex size-9 items-center justify-center rounded-md', on ? 'bg-success text-white' : 'bg-muted text-muted-foreground')}><Bike className="size-5" /></div>
                      <div className="min-w-0 flex-1"><div className="text-sm font-medium">{tx(m.name)}</div><div className="text-xs text-muted-foreground">{m.manufacturer} · {m.engineCc}cc · {m.years}</div></div>
                      <Badge variant={on ? 'success' : 'outline'}>{on ? t('compat.compatible') : t('compat.linkModel')}</Badge>
                    </button>
                  ); })}
                </div>
              )}
              {selectedProduct?.alternativeProductIds.length ? <div className="mt-4 border-t pt-3"><h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t('compat.alternatives')}</h4><div className="flex flex-wrap gap-2">{selectedProduct.alternativeProductIds.map((a) => <Link key={a} to={`/products/${a}`}><Badge variant="info" className="px-2 py-1">{tx(products.data?.find((p) => p.id === a)?.name)}</Badge></Link>)}</div></div> : null}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="model">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('compat.byModel')}>
              <div className="space-y-1">{models.data?.map((m) => <button key={m.id} type="button" onClick={() => setModelId(m.id)} className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-2 text-start text-sm', modelId === m.id ? 'border-primary bg-primary/5' : 'hover:bg-accent')}><Bike className="size-4 text-muted-foreground" /><span className="flex-1"><span className="font-medium">{tx(m.name)}</span><span className="block text-xs text-muted-foreground">{m.manufacturer} · {m.engineCc}cc · {m.years}</span></span><Badge variant="secondary">{(products.data ?? []).filter((p) => p.compatibleModelIds.includes(m.id)).length}</Badge></button>)}</div>
            </Section>
            <Section title={t('compat.compatibleProducts')} className="lg:col-span-2">
              {!modelId ? <EmptyState icon={<Bike />} title={t('compat.model')} /> : modelProducts.length === 0 ? <EmptyState /> : (
                <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-start font-medium">{t('common.partNumber')}</th><th className="pb-2 text-start font-medium">{t('common.category')}</th><th className="pb-2 text-end font-medium">{t('common.price')}</th><th className="pb-2 text-end font-medium">{t('pos.stock')}</th>{canEdit ? <th /> : null}</tr></thead><tbody>{modelProducts.map((p) => <tr key={p.id} className="border-t"><td className="py-1.5"><Link to={`/products/${p.id}`} className="hover:underline">{tx(p.name)}</Link></td><td className="py-1.5 num text-xs">{p.partNumber}</td><td className="py-1.5 text-xs">{productCategoryIds(p).map(categoryName).join('، ')}</td><td className="py-1.5 text-end num">{p.prices.retail1}</td><td className="py-1.5 text-end num">{p.totalStock}</td>{canEdit ? <td className="py-1.5 text-end"><Button size="xs" variant="ghost" onClick={() => toggle(p.id, modelId, false)}>{t('compat.unlinkModel')}</Button></td> : null}</tr>)}</tbody></table>
              )}
            </Section>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{t('compat.addModel')}</DialogTitle></DialogHeader>
          <form onSubmit={addModel} className="space-y-3">
            <FormGrid><TextField control={form.control} name="code" label={t('common.code')} required dir="ltr" placeholder="CG125" /><TextField control={form.control} name="manufacturer" label={t('compat.manufacturer')} dir="ltr" /><TextField control={form.control} name="nameAr" label={t('common.nameAr')} required /><TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" /><TextField control={form.control} name="engineCc" type="number" label={t('compat.engine')} dir="ltr" /><TextField control={form.control} name="years" label={t('compat.years')} dir="ltr" placeholder="2010-2024" /></FormGrid>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
