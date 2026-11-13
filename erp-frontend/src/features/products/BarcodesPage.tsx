import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Printer, Settings2, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section, SearchInput } from '@/components/shared/page';
import { Barcode } from '@/components/shared/barcode';
import { NumberStepper, Combobox } from '@/components/shared/pickers';
import { EmptyState, LoadingState } from '@/components/shared/states';
import { deviceLabelPref, inventoryService, productService, settingsService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { matchSearch } from '@/lib/utils';
import { defaultLabelTemplate } from '@moto/shared';
import type { LabelJob, LabelTemplate } from '@/types';
import { LabelRenderer } from './LabelRenderer';
import { printBrowserLabels } from './labelPrint';

export default function BarcodesPage() {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const location = useLocation();
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'));
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const { options } = useLookups();
  const { settings, isLoading: settingsLoading } = useSettings();
  const products = useQuery({ queryKey: ['products', 'all'], queryFn: () => productService.all() });
  const levels = useQuery({ queryKey: ['inventory', 'levels', branchId], queryFn: () => inventoryService.levels({ branchId }) });
  const templatesQ = useQuery({ queryKey: ['labelTemplates', branchId], queryFn: () => settingsService.labelTemplates(branchId) });
  const templates: LabelTemplate[] = templatesQ.data?.length ? templatesQ.data : [defaultLabelTemplate()];
  const [templateId, setTemplateId] = React.useState<string | null>(deviceLabelPref.get());
  const template = templates.find((x) => x.id === templateId) ?? templates.find((x) => x.isDefault) ?? templates[0]!;
  const [queue, setQueue] = React.useState<LabelJob[]>(() => ((location.state as { ids?: string[] } | null)?.ids ?? []).map((id) => ({ productId: id, quantity: 1 })));
  const [search, setSearch] = React.useState('');
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const printRef = React.useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = React.useState(false);

  const list = React.useMemo(() => (products.data ?? []).filter((p) => matchSearch([p.name.ar, p.name.en, p.sku, p.internalBarcode, p.legacyBarcode, p.partNumber], search)), [products.data, search]);
  // Shelf/bin only makes sense per branch, so labels print the location of the user's own branch.
  const locationOf = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const l of levels.data ?? []) {
      if (map.has(l.productId)) continue;
      map.set(l.productId, [l.locationCode, l.shelf, l.bin].filter(Boolean).join(' · '));
    }
    return (id: string) => map.get(id) ?? '';
  }, [levels.data]);
  const addToQueue = (id: string, qty = 1) => setQueue((q) => (q.some((j) => j.productId === id) ? q.map((j) => (j.productId === id ? { ...j, quantity: j.quantity + qty } : j)) : [...q, { productId: id, quantity: qty }]));
  const totalLabels = queue.reduce((a, j) => a + j.quantity, 0);
  const preview = products.data?.find((p) => p.id === (previewId ?? queue[0]?.productId ?? products.data?.[0]?.id));

  const regenerate = async (id: string) => {
    await productService.regenerateBarcode(id);
    toast.success(t('upgrade.barcodeRegenerated'));
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const print = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      await printBrowserLabels(printRef.current, template);
    } catch {
      toast.error(t('barcodes.printFailed'));
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('barcodes.title')}
        subtitle={t('barcodes.subtitle')}
        backTo="/products"
        actions={
          <>
            <Select value={template.id} onValueChange={(v) => { setTemplateId(v); deviceLabelPref.set(v); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{templates.map((x) => <SelectItem key={x.id} value={x.id}>{x.name} ({x.widthMm}×{x.heightMm})</SelectItem>)}</SelectContent>
            </Select>
            <Button variant="outline" asChild><Link to="/products/labels/designer"><Settings2 /> {t('upgrade.labelDesigner')}</Link></Button>
          </>
        }
      />
      <Tabs defaultValue="manage">
        <TabsList>
          <TabsTrigger value="manage">{t('barcodes.internal')}</TabsTrigger>
          <TabsTrigger value="print">{t('barcodes.printLabels')} {totalLabels ? <Badge variant="default" className="ms-1">{totalLabels}</Badge> : null}</TabsTrigger>
        </TabsList>

        <TabsContent value="manage">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('common.products')} className="lg:col-span-2" actions={<SearchInput value={search} onChange={setSearch} />}>
              {products.isLoading ? <LoadingState /> : list.length === 0 ? <EmptyState /> : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="px-2 py-2 text-start font-medium">{t('common.product')}</th><th className="px-2 py-2 text-start font-medium">{t('barcodes.internal')}</th><th className="px-2 py-2 text-start font-medium">{t('upgrade.legacyBarcode')}</th><th className="px-2 py-2 text-end font-medium">{t('common.actions')}</th></tr></thead>
                    <tbody>{list.map((p) => (
                      <tr key={p.id} className="border-t hover:bg-muted/40">
                        <td className="px-2 py-1.5"><button type="button" className="text-start hover:underline" onClick={() => setPreviewId(p.id)}>{tx(p.name)}</button><div className="text-[10px] text-muted-foreground num">{p.sku}</div></td>
                        <td className="px-2 py-1.5 num text-xs font-medium">{p.internalBarcode}</td>
                        <td className="px-2 py-1.5 num text-xs text-muted-foreground">{p.legacyBarcode ?? '—'}</td>
                        <td className="px-2 py-1.5 text-end">
                          {canEdit ? <Button size="xs" variant="ghost" onClick={() => regenerate(p.id)} title={t('upgrade.regenerateBarcode')}><Wand2 /></Button> : null}
                          <Button size="xs" variant="ghost" onClick={() => { addToQueue(p.id); toast.success(t('barcodes.addToQueue')); }}><Plus /> {t('barcodes.addToQueue')}</Button>
                        </td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </Section>
            <Section title={t('barcodes.preview')}>
              {preview ? (
                <div className="space-y-3">
                  <div className="text-sm font-medium">{tx(preview.name)}</div>
                  <div className="rounded border bg-white p-3 text-black"><Barcode value={preview.internalBarcode} height={40} /></div>
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">{t('barcodes.labelPreview')} ({template.widthMm}×{template.heightMm} mm · {template.name})</div>
                    <div className="inline-block rounded border border-dashed border-gray-400"><LabelRenderer template={template} product={preview} settings={settings} scale={4} location={locationOf(preview.id)} /></div>
                  </div>
                </div>
              ) : <EmptyState />}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="print">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('barcodes.printQueue')} actions={<Button size="sm" variant="ghost" onClick={() => setQueue([])} disabled={!queue.length}><Trash2 /> {t('barcodes.clearQueue')}</Button>}>
              <div className="mb-3"><Combobox value={null} onChange={(v) => v && addToQueue(v)} options={options.products} placeholder={t('common.selectProduct')} /></div>
              {queue.length === 0 ? <EmptyState title={t('barcodes.queueEmpty')} /> : (
                <ul className="divide-y">
                  {queue.map((j) => { const p = products.data?.find((x) => x.id === j.productId); return p ? (
                    <li key={j.productId} className="flex items-center gap-2 py-2 text-sm"><div className="min-w-0 flex-1"><div className="truncate">{tx(p.name)}</div><div className="text-[10px] text-muted-foreground num">{p.internalBarcode}</div></div><NumberStepper value={j.quantity} min={1} max={500} onChange={(v) => setQueue((q) => q.map((x) => (x.productId === j.productId ? { ...x, quantity: v } : x)))} size="sm" /><Button size="icon-xs" variant="ghost" onClick={() => setQueue((q) => q.filter((x) => x.productId !== j.productId))}><Trash2 /></Button></li>
                  ) : null; })}
                </ul>
              )}
              <div className="mt-3 flex items-center justify-between border-t pt-3"><span className="text-sm">{t('barcodes.labelsCount')}: <b className="num">{totalLabels}</b></span><Button disabled={!queue.some((job) => products.data?.some((product) => product.id === job.productId)) || settingsLoading || templatesQ.isPending} loading={printing} onClick={() => void print()}><Printer /> {t('barcodes.printNow')}</Button></div>
            </Section>
            <Section title={t('barcodes.labelPreview')} className="lg:col-span-2" description={`${t('barcodes.labelSize')}: ${template.widthMm}×${template.heightMm} mm · ${template.name}`}>
              {queue.length === 0 ? <EmptyState title={t('barcodes.queueEmpty')} /> : (
                <>
                  <div className="flex flex-wrap gap-2 rounded-md bg-gray-100 p-3 dark:bg-gray-900">
                    {queue.flatMap((j) => { const p = products.data?.find((x) => x.id === j.productId); return p ? Array.from({ length: Math.min(j.quantity, 60) }, (_, i) => <div key={`${j.productId}-${i}`} className="border border-dashed border-gray-400"><LabelRenderer template={template} product={p} settings={settings} scale={3} location={locationOf(p.id)} /></div>) : []; })}
                    {totalLabels > 60 ? <div className="w-full text-center text-xs text-muted-foreground">+{totalLabels - 60}…</div> : null}
                  </div>
                </>
              )}
            </Section>
          </div>
        </TabsContent>
      </Tabs>
      <div ref={printRef} className="hidden" aria-hidden="true">
        {queue.flatMap((j) => { const p = products.data?.find((x) => x.id === j.productId); return p ? Array.from({ length: j.quantity }, (_, i) => <div key={`${j.productId}-${i}`} className="label-page"><LabelRenderer template={template} product={p} settings={settings} location={locationOf(p.id)} /></div>) : []; })}
      </div>
    </div>
  );
}
