import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Eye, EyeOff, Plus, Printer, Save, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/misc';
import { PageHeader, Section } from '@/components/shared/page';
import { Combobox } from '@/components/shared/pickers';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { productService, settingsService, deviceLabelPref } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { LABEL_PRESETS, PRICE_TIERS, defaultLabelElements, defaultLabelTemplate } from '@moto/shared';
import type { LabelElement, LabelElementType, LabelTemplate, PriceTier } from '@/types';
import { LabelRenderer } from './LabelRenderer';
import { printBrowserLabels } from './labelPrint';

const ELEMENT_TYPES: LabelElementType[] = ['companyName', 'logo', 'productName', 'price', 'barcode', 'sku', 'partNumber', 'location', 'customText'];
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const r1 = (v: number) => Math.round(v * 10) / 10;

export default function LabelDesignerPage() {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit') || s.hasPermission('inventory.adjust'));
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const { settings, isLoading: settingsLoading } = useSettings();
  const { options } = useLookups();
  const templatesQ = useQuery({ queryKey: ['labelTemplates', branchId], queryFn: () => settingsService.labelTemplates(branchId) });
  const products = useQuery({ queryKey: ['products', 'all'], queryFn: () => productService.all() });

  const [draft, setDraft] = React.useState<LabelTemplate>(() => defaultLabelTemplate());
  const [selected, setSelected] = React.useState<string | null>(null);
  const [sampleId, setSampleId] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(5);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const printRef = React.useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = React.useState(false);
  const sample = products.data?.find((p) => p.id === sampleId) ?? products.data?.[0];
  const sampleLevels = useQuery({ queryKey: ['product', sample?.id, 'levels'], queryFn: () => productService.stockLevels(sample!.id), enabled: Boolean(sample) });
  const sampleLocation = React.useMemo(() => {
    const l = sampleLevels.data?.[0];
    return l ? [l.locationCode, l.shelf, l.bin].filter(Boolean).join(' · ') : '';
  }, [sampleLevels.data]);

  React.useEffect(() => {
    if (!templatesQ.data?.length || dirty) return;
    const pref = deviceLabelPref.get();
    const initial = templatesQ.data.find((x) => x.id === pref) ?? templatesQ.data.find((x) => x.isDefault) ?? templatesQ.data[0]!;
    setDraft(initial);
  }, [templatesQ.data]);

  const patch = (fn: (d: LabelTemplate) => LabelTemplate) => {
    setDraft(fn);
    setDirty(true);
  };
  const patchEl = (id: string, fn: (e: LabelElement) => LabelElement) => patch((d) => ({ ...d, elements: d.elements.map((e) => (e.id === id ? fn(e) : e)) }));
  const el = draft.elements.find((e) => e.id === selected) ?? null;

  const load = (tpl: LabelTemplate) => {
    setDraft(tpl);
    setSelected(null);
    setDirty(false);
  };
  const newTemplate = () => {
    load({ ...defaultLabelTemplate(`new-${Date.now()}`), id: '', name: `${t('upgrade.newTemplate')} ${(templatesQ.data?.length ?? 0) + 1}`, isDefault: false, branchId: null });
    setDirty(true);
  };
  const applyPreset = (w: number, h: number) => patch((d) => ({ ...d, widthMm: w, heightMm: h, elements: defaultLabelElements(w, h) }));
  const addElement = (type: LabelElementType) =>
    patch((d) => ({
      ...d,
      elements: [...d.elements, { id: `el-${Date.now().toString(36)}`, type, x: 1, y: 1, w: Math.min(20, d.widthMm - 2), h: Math.min(5, d.heightMm - 2), fontSize: 7, fontWeight: 500, align: 'center', visible: true, text: type === 'customText' ? t('upgrade.customText') : undefined, priceTier: type === 'price' ? 'retail1' : undefined }],
    }));

  const save = async () => {
    setSaving(true);
    try {
      const { id, ...rest } = draft;
      const saved = await settingsService.saveLabelTemplate({ ...rest, id: id || undefined, elements: rest.elements });
      toast.success(t('upgrade.templateSaved'));
      qc.invalidateQueries({ queryKey: ['labelTemplates'] });
      load(saved);
      deviceLabelPref.set(saved.id);
    } finally {
      setSaving(false);
    }
  };
  const remove = async () => {
    if (!draft.id) return;
    await settingsService.deleteLabelTemplate(draft.id);
    qc.invalidateQueries({ queryKey: ['labelTemplates'] });
    toast.success(t('common.deleted'));
    newTemplate();
  };
  const printTest = async () => {
    if (printing) return;
    setPrinting(true);
    try {
      await printBrowserLabels(printRef.current, draft);
    } catch {
      toast.error(t('barcodes.printFailed'));
    } finally {
      setPrinting(false);
    }
  };

  const elementLabel = (type: LabelElementType) => t(`upgrade.element.${type}`);

  return (
    <div>
      <PageHeader
        title={t('upgrade.labelDesigner')}
        subtitle={`${draft.name} · ${draft.widthMm}×${draft.heightMm} mm · ${draft.dpi} DPI`}
        backTo="/products/barcodes"
        actions={
          <>
            <Button variant="outline" onClick={() => void printTest()} disabled={!sample || settingsLoading || templatesQ.isPending} loading={printing}><Printer /> {t('common.print')}</Button>
            {canEdit ? <Button onClick={save} loading={saving} disabled={!dirty && Boolean(draft.id)}><Save /> {t('upgrade.saveTemplate')}</Button> : null}
          </>
        }
      />
      <div className="grid gap-3 xl:grid-cols-[260px_1fr_300px]">
        {/* Templates & size */}
        <div className="space-y-3">
          <Section title={t('upgrade.templates')} actions={canEdit ? <Button size="xs" variant="outline" onClick={newTemplate}><Plus /> {t('upgrade.newTemplate')}</Button> : undefined}>
            <div className="space-y-1">
              {(templatesQ.data ?? []).map((x) => (
                <button key={x.id} type="button" onClick={() => load(x)} className={cn('flex w-full items-center justify-between rounded-md border px-3 py-2 text-start text-sm', draft.id === x.id ? 'border-primary bg-primary/5' : 'hover:bg-accent')}>
                  <span className="truncate">{x.name}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">{x.widthMm}×{x.heightMm}{x.isDefault ? <Badge variant="outline" className="h-4 px-1 text-[9px]">{t('upgrade.isDefault')}</Badge> : null}</span>
                </button>
              ))}
            </div>
          </Section>
          <Section title={t('upgrade.presets')}>
            <div className="grid grid-cols-3 gap-1.5">
              {LABEL_PRESETS.map((pr) => (
                <Button key={pr.name} size="sm" variant={draft.widthMm === pr.widthMm && draft.heightMm === pr.heightMm ? 'secondary' : 'outline'} onClick={() => applyPreset(pr.widthMm, pr.heightMm)} disabled={!canEdit}>{pr.name}</Button>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div><Label>{t('upgrade.templateName')}</Label><Input value={draft.name} onChange={(e) => patch((d) => ({ ...d, name: e.target.value }))} disabled={!canEdit} /></div>
              <div><Label>{t('upgrade.dpi')}</Label><Select value={String(draft.dpi)} onValueChange={(v) => patch((d) => ({ ...d, dpi: Number(v) }))} disabled={!canEdit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[203, 300, 600].map((v) => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>{t('upgrade.width')}</Label><Input type="number" dir="ltr" value={draft.widthMm} onChange={(e) => patch((d) => ({ ...d, widthMm: clamp(Number(e.target.value) || 10, 10, 200) }))} disabled={!canEdit} /></div>
              <div><Label>{t('upgrade.height')}</Label><Input type="number" dir="ltr" value={draft.heightMm} onChange={(e) => patch((d) => ({ ...d, heightMm: clamp(Number(e.target.value) || 10, 10, 200) }))} disabled={!canEdit} /></div>
            </div>
            <div className="mt-3 flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{t('upgrade.isDefault')}</span><Switch checked={draft.isDefault} onCheckedChange={(v) => patch((d) => ({ ...d, isDefault: v }))} disabled={!canEdit} /></div>
            <div className="mt-2 flex items-center justify-between rounded-md border px-3 py-2 text-sm"><span>{t('upgrade.scope')}</span><Select value={draft.branchId ?? 'global'} onValueChange={(v) => patch((d) => ({ ...d, branchId: v === 'global' ? null : v }))} disabled={!canEdit}><SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="global">{t('upgrade.global')}</SelectItem>{options.branches.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent></Select></div>
            {draft.id && canEdit ? <Button variant="ghost" size="sm" className="mt-2 w-full text-destructive" onClick={() => setDeleteOpen(true)}><Trash2 /> {t('upgrade.deleteTemplate')}</Button> : null}
          </Section>
        </div>

        {/* Canvas */}
        <Section title={t('upgrade.livePreview')} actions={<div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{t('upgrade.sampleProduct')}</span><div className="w-56"><Combobox value={sample?.id ?? null} onChange={(v) => setSampleId(v)} options={options.products} /></div><Input type="range" min={2} max={10} step={0.5} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28" /></div>}>
          <div className="flex min-h-[320px] items-center justify-center overflow-auto rounded-md bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] p-6 dark:bg-[repeating-conic-gradient(#1f2937_0%_25%,#111827_0%_50%)]" onPointerDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
            {sample ? (
              <div className="shadow-xl ring-1 ring-black/10">
                <LabelRenderer
                  template={draft}
                  product={sample}
                  settings={settings}
                  location={sampleLocation}
                  scale={zoom}
                  interactive={canEdit}
                  showGrid
                  selectedId={selected}
                  onSelect={setSelected}
                  onMove={(id, dx, dy) => patchEl(id, (e) => ({ ...e, x: r1(clamp(e.x + dx, 0, draft.widthMm - e.w)), y: r1(clamp(e.y + dy, 0, draft.heightMm - e.h)) }))}
                  onResize={(id, dw, dh) => patchEl(id, (e) => ({ ...e, w: r1(clamp(e.w + dw, 2, draft.widthMm - e.x)), h: r1(clamp(e.h + dh, 1.5, draft.heightMm - e.y)) }))}
                />
              </div>
            ) : null}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">{t('upgrade.dragToReorder')} · mm</div>
          {sample ? (
            <div ref={printRef} className="hidden" aria-hidden="true">
              <div className="label-page"><LabelRenderer template={draft} product={sample} settings={settings} location={sampleLocation} /></div>
            </div>
          ) : null}
        </Section>

        {/* Elements */}
        <div className="space-y-3">
          <Section title={t('upgrade.elements')} actions={canEdit ? <Select value="" onValueChange={(v) => addElement(v as LabelElementType)}><SelectTrigger className="h-7 w-32"><Plus className="me-1 size-3" /><SelectValue placeholder={t('common.add')} /></SelectTrigger><SelectContent>{ELEMENT_TYPES.map((ty) => <SelectItem key={ty} value={ty}>{elementLabel(ty)}</SelectItem>)}</SelectContent></Select> : undefined}>
            <ul className="space-y-1">
              {draft.elements.map((e) => (
                <li key={e.id} className={cn('flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm', selected === e.id && 'border-primary bg-primary/5')}>
                  <button type="button" className="min-w-0 flex-1 truncate text-start" onClick={() => setSelected(e.id)}>{elementLabel(e.type)}{e.type === 'customText' && e.text ? <span className="text-muted-foreground"> — {e.text}</span> : null}</button>
                  <Button size="icon-xs" variant="ghost" onClick={() => patchEl(e.id, (x) => ({ ...x, visible: !x.visible }))} disabled={!canEdit} aria-label={t('upgrade.visible')}>{e.visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 opacity-50" />}</Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => patch((d) => ({ ...d, elements: [...d.elements, { ...e, id: `el-${Date.now().toString(36)}`, x: Math.min(e.x + 2, d.widthMm - e.w), y: Math.min(e.y + 2, d.heightMm - e.h) }] }))} disabled={!canEdit}><Copy className="size-3.5" /></Button>
                  <Button size="icon-xs" variant="ghost" className="text-destructive" onClick={() => { patch((d) => ({ ...d, elements: d.elements.filter((x) => x.id !== e.id) })); if (selected === e.id) setSelected(null); }} disabled={!canEdit}><Trash2 className="size-3.5" /></Button>
                </li>
              ))}
            </ul>
          </Section>
          {el ? (
            <Section title={elementLabel(el.type)}>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {(['x', 'y', 'w', 'h'] as const).map((k) => (
                  <div key={k}><Label className="uppercase">{k} (mm)</Label><Input type="number" step={0.5} dir="ltr" value={el[k]} onChange={(e) => patchEl(el.id, (x) => ({ ...x, [k]: r1(Number(e.target.value) || 0) }))} disabled={!canEdit} /></div>
                ))}
                <div><Label>{t('upgrade.fontSize')} (pt)</Label><Input type="number" step={0.5} dir="ltr" value={el.fontSize} onChange={(e) => patchEl(el.id, (x) => ({ ...x, fontSize: clamp(Number(e.target.value) || 4, 3, 40) }))} disabled={!canEdit} /></div>
                <div><Label>{t('upgrade.fontWeight')}</Label><Select value={String(el.fontWeight)} onValueChange={(v) => patchEl(el.id, (x) => ({ ...x, fontWeight: Number(v) as LabelElement['fontWeight'] }))} disabled={!canEdit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{[400, 500, 600, 700].map((v) => <SelectItem key={v} value={String(v)}>{v}</SelectItem>)}</SelectContent></Select></div>
                <div className="col-span-2"><Label>{t('upgrade.align')}</Label><div className="inline-flex rounded-md border p-0.5">{(['start', 'center', 'end'] as const).map((a) => <Button key={a} size="xs" variant={el.align === a ? 'secondary' : 'ghost'} onClick={() => patchEl(el.id, (x) => ({ ...x, align: a }))} disabled={!canEdit}>{t(`upgrade.align${a[0]!.toUpperCase()}${a.slice(1)}`)}</Button>)}</div></div>
                {el.type === 'customText' ? <div className="col-span-2"><Label>{t('upgrade.customText')}</Label><Input value={el.text ?? ''} onChange={(e) => patchEl(el.id, (x) => ({ ...x, text: e.target.value }))} disabled={!canEdit} /></div> : null}
                {el.type === 'price' ? <div className="col-span-2"><Label>{t('upgrade.priceTierOnLabel')}</Label><Select value={el.priceTier ?? 'retail1'} onValueChange={(v) => patchEl(el.id, (x) => ({ ...x, priceTier: v as PriceTier }))} disabled={!canEdit}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PRICE_TIERS.map((tier) => <SelectItem key={tier} value={tier}>{tx(settings.pricing.tierLabels[tier])}</SelectItem>)}</SelectContent></Select></div> : null}
                <div className="col-span-2 flex items-center justify-between rounded-md border px-3 py-2"><span>{t('upgrade.visible')}</span><Switch checked={el.visible} onCheckedChange={(v) => patchEl(el.id, (x) => ({ ...x, visible: v }))} disabled={!canEdit} /></div>
              </div>
            </Section>
          ) : null}
        </div>
      </div>
      <ConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} title={t('upgrade.deleteTemplate')} description={t('common.irreversible')} variant="destructive" onConfirm={remove} />
    </div>
  );
}
