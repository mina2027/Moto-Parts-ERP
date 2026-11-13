import * as React from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, type FieldValues, type DefaultValues } from 'react-hook-form';
import { toast } from 'sonner';
import { BarChart3, Barcode as BarcodeIcon, Bell, BellRing, Building2, Coins, FileText, Globe, Monitor, MonitorSmartphone, Palette, Pencil, Plus, Printer, Receipt, Settings2, ShieldCheck, Store, Tags, Trash2, Upload } from 'lucide-react';
import { PAPER_SIZES, ALERT_TYPES, PRICE_TIERS, type PrintProfileSaveInput } from '@moto/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader, Section } from '@/components/shared/page';
import { FormField, FormGrid, SelectField, SwitchField, TextField } from '@/components/shared/form';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { PageLoading } from '@/components/shared/states';
import { Receipt as ReceiptPreview } from '@/features/sales/receipt';
import { settingsService, salesService, devicePrintPref, whatsappService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime } from '@/lib/utils';
import type { AppSettings, AlertType, PaperKind, PriceTier, PrintDetail, PrintProfile, Sale } from '@/types';

const TIER_LABEL_KEY: Record<PriceTier, string> = { retail1: 'upgrade.tierRetail1', retail2: 'upgrade.tierRetail2', wholesale: 'upgrade.tierWholesale' };
const PAPER_KINDS: PaperKind[] = ['thermal80', 'a4'];
const PRINT_DETAILS: PrintDetail[] = ['detailed', 'compact'];

function errorMessage(e: unknown, fallback: string) {
  return e instanceof Error && e.message ? e.message : fallback;
}

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
/** Two parallel textareas (one per language) zipped back into a bilingual list. */
function zipNotes(ar: string, en: string) {
  const [a, e] = [lines(ar), lines(en)];
  return a.map((x, i) => ({ ar: x, en: e[i] || undefined }));
}
/** One brand per line, `NAME #RRGGBB`; an invalid or missing colour falls back to the ink colour. */
function parseBrandLogos(text: string) {
  return lines(text).map((line) => {
    const m = /^(.*?)\s*(#[0-9a-fA-F]{6})?$/.exec(line);
    return { name: (m?.[1] ?? line).trim(), color: m?.[2] ?? '#1F2937' };
  }).filter((b) => b.name);
}

function SectionForm<T extends FieldValues>({ defaults, onSave, children, disabled }: { defaults: DefaultValues<T>; onSave: (v: T) => Promise<void>; children: (form: ReturnType<typeof useForm<T>>) => React.ReactNode; disabled?: boolean }) {
  const { t } = useT();
  const form = useForm<T>({ defaultValues: defaults });
  return (
    <form onSubmit={form.handleSubmit(async (v) => { try { await onSave(v); form.reset(v as DefaultValues<T>); } catch (error) { toast.error(errorMessage(error, t('common.error'))); } })} className="space-y-3">
      <fieldset disabled={disabled} className="space-y-3">{children(form)}</fieldset>
      {!disabled ? <div className="flex justify-end gap-2 border-t pt-3"><Button type="button" variant="ghost" onClick={() => form.reset()} disabled={!form.formState.isDirty}>{t('common.reset')}</Button><Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>{t('common.save')}</Button></div> : null}
    </form>
  );
}

// ---------- Company: logo upload ----------
function LogoUploader({ logoUrl, canEdit }: { logoUrl?: string; canEdit: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => settingsService.uploadLogo(file),
    onSuccess: () => { toast.success(t('settings.settingsSaved')); qc.invalidateQueries({ queryKey: ['settings'] }); },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      {logoUrl ? <img src={logoUrl} alt={t('settings.logo')} className="size-16 rounded border bg-white object-contain" /> : <div className="flex size-16 items-center justify-center rounded border bg-muted text-xs text-muted-foreground">{t('settings.logo')}</div>}
      <div className="space-y-1">
        <div className="text-sm font-medium">{t('settings.logo')}</div>
        <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
        <Button type="button" variant="outline" size="sm" disabled={!canEdit} loading={upload.isPending} onClick={() => inputRef.current?.click()}><Upload /> {t('common.upload')}</Button>
      </div>
    </div>
  );
}

// ---------- Printing ----------
const GLOBAL_SCOPE = '__global';
interface ProfileForm { name: string; paper: PaperKind; detail: PrintDetail; copies: number; footerAr: string; footerEn: string; printerName: string; branchId: string; showLogo: boolean; showQr: boolean; showCompatibility: boolean; showPartNumber: boolean; showCashier: boolean; showCustomerBalance: boolean; showStamp: boolean; showReviewStamp: boolean; isDefault: boolean }

function profileToForm(p: PrintProfile | null): ProfileForm {
  return {
    name: p?.name ?? '', paper: p?.paper ?? 'thermal80', detail: p?.detail ?? 'detailed', copies: p?.copies ?? 1,
    footerAr: p?.footer.ar ?? '', footerEn: p?.footer.en ?? '', printerName: p?.printerName ?? '', branchId: p?.branchId ?? GLOBAL_SCOPE,
    showLogo: p?.showLogo ?? true, showQr: p?.showQr ?? true, showCompatibility: p?.showCompatibility ?? false, showPartNumber: p?.showPartNumber ?? true,
    showCashier: p?.showCashier ?? true, showCustomerBalance: p?.showCustomerBalance ?? false,
    showStamp: p?.showStamp ?? true, showReviewStamp: p?.showReviewStamp ?? false, isDefault: p?.isDefault ?? false,
  };
}

function PrintProfileDialog({ profile, open, onOpenChange, onSave, saving }: { profile: PrintProfile | null; open: boolean; onOpenChange: (o: boolean) => void; onSave: (input: PrintProfileSaveInput) => Promise<unknown>; saving: boolean }) {
  const { t } = useT();
  const { options } = useLookups();
  const form = useForm<ProfileForm>({ defaultValues: profileToForm(profile) });
  React.useEffect(() => { form.reset(profileToForm(profile)); }, [profile, form]);
  const submit = form.handleSubmit(async (v) => {
    await onSave({
      id: profile?.id, name: v.name, branchId: v.branchId === GLOBAL_SCOPE ? null : v.branchId, paper: v.paper, detail: v.detail,
      showLogo: v.showLogo, showQr: v.showQr, showCompatibility: v.showCompatibility, showPartNumber: v.showPartNumber, showCashier: v.showCashier, showCustomerBalance: v.showCustomerBalance,
      showStamp: v.showStamp, showReviewStamp: v.showReviewStamp,
      copies: Number(v.copies) || 1, footer: { ar: v.footerAr, en: v.footerEn || undefined }, printerName: v.printerName || undefined, isDefault: v.isDefault,
    });
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>{profile ? `${t('common.edit')} — ${profile.name}` : t('upgrade.addProfile')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid>
            <TextField control={form.control} name="name" label={t('common.name')} required />
            <TextField control={form.control} name="printerName" label={`${t('upgrade.printerName')} (${t('common.optional')})`} dir="ltr" />
            <SelectField control={form.control} name="paper" label={t('upgrade.paper')} options={PAPER_KINDS.map((p) => ({ value: p, label: PAPER_SIZES[p].label }))} />
            <SelectField control={form.control} name="detail" label={t('upgrade.detail')} options={PRINT_DETAILS.map((d) => ({ value: d, label: t(`upgrade.${d}`) }))} />
            <SelectField control={form.control} name="branchId" label={t('upgrade.scope')} options={[{ value: GLOBAL_SCOPE, label: t('upgrade.global') }, ...options.branches]} />
            <TextField control={form.control} name="copies" type="number" label={t('upgrade.copies')} dir="ltr" />
            <TextField control={form.control} name="footerAr" label={`${t('upgrade.footer')} (AR)`} />
            <TextField control={form.control} name="footerEn" label={`${t('upgrade.footer')} (EN)`} dir="ltr" />
          </FormGrid>
          <FormGrid cols={2}>
            <SwitchField control={form.control} name="showLogo" label={t('upgrade.showLogo')} />
            <SwitchField control={form.control} name="showQr" label={t('upgrade.showQr')} />
            <SwitchField control={form.control} name="showCompatibility" label={t('upgrade.showCompatibility')} />
            <SwitchField control={form.control} name="showPartNumber" label={t('upgrade.showPartNumber')} />
            <SwitchField control={form.control} name="showCashier" label={t('settings.showCashier')} />
            <SwitchField control={form.control} name="showCustomerBalance" label={t('settings.showCustomerBalance')} />
            <SwitchField control={form.control} name="showStamp" label={t('upgrade.showStamp')} />
            <SwitchField control={form.control} name="showReviewStamp" label={t('upgrade.showReviewStamp')} />
            <SwitchField control={form.control} name="isDefault" label={t('upgrade.isDefault')} />
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={saving}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrintingTab({ sampleSale, canEdit }: { sampleSale: Sale | null; canEdit: boolean }) {
  const { t } = useT();
  const qc = useQueryClient();
  const profiles = useQuery({ queryKey: ['printProfiles'], queryFn: () => settingsService.printProfiles() });
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ open: boolean; profile: PrintProfile | null }>({ open: false, profile: null });
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [devicePref, setDevicePref] = React.useState<string | null>(() => devicePrintPref.get());
  const invalidate = () => qc.invalidateQueries({ queryKey: ['printProfiles'] });
  const saveM = useMutation({
    mutationFn: (input: PrintProfileSaveInput) => settingsService.savePrintProfile(input),
    onSuccess: () => { toast.success(t('common.saved')); setEditing({ open: false, profile: null }); invalidate(); },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => settingsService.deletePrintProfile(id),
    onSuccess: (_r, id) => { toast.success(t('common.deleted')); if (selectedId === id) setSelectedId(null); if (devicePref === id) { devicePrintPref.set(null); setDevicePref(null); } invalidate(); },
    onError: (e) => toast.error(errorMessage(e, t('common.error'))),
  });
  const list = profiles.data ?? [];
  const selected = list.find((p) => p.id === selectedId) ?? list.find((p) => p.id === devicePref) ?? list.find((p) => p.isDefault) ?? list[0] ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_340px]">
      <Section title={t('upgrade.printProfiles')} actions={canEdit ? <Button size="sm" onClick={() => setEditing({ open: true, profile: null })}><Plus /> {t('upgrade.addProfile')}</Button> : undefined}>
        {profiles.isLoading ? <PageLoading /> : list.length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">{t('common.noData')}</div> : (
          <div className="space-y-2">
            {list.map((p) => (
              <div key={p.id} role="button" tabIndex={0} onClick={() => setSelectedId(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(p.id); }} className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent/50', selected?.id === p.id && 'border-primary bg-primary/5')}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 font-medium">
                    {p.name}
                    {p.isDefault ? <Badge variant="success">{t('upgrade.isDefault')}</Badge> : null}
                    {devicePref === p.id ? <Badge variant="info">{t('upgrade.deviceDefault')}</Badge> : null}
                  </div>
                  <div className="text-xs text-muted-foreground">{PAPER_SIZES[p.paper].label} · {t(`upgrade.${p.detail}`)} · {t('upgrade.copies')}: {p.copies}{p.printerName ? ` · ${p.printerName}` : ''}</div>
                </div>
                <div className="flex items-center gap-1">
                  {devicePref !== p.id ? <Button variant="outline" size="xs" onClick={(e) => { e.stopPropagation(); devicePrintPref.set(p.id); setDevicePref(p.id); toast.success(t('common.saved')); }}>{t('upgrade.setDeviceDefault')}</Button> : null}
                  {canEdit ? <>
                    <Button variant="ghost" size="icon-xs" aria-label={t('common.edit')} onClick={(e) => { e.stopPropagation(); setEditing({ open: true, profile: p }); }}><Pencil /></Button>
                    <Button variant="ghost" size="icon-xs" aria-label={t('common.delete')} className="text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteId(p.id); }}><Trash2 /></Button>
                  </> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
      <Section title={t('upgrade.preview')} description={selected?.name}>
        <div className="max-h-[600px] overflow-auto rounded border bg-white p-2 text-black">
          {sampleSale && selected ? <ReceiptPreview sale={sampleSale} profile={selected} /> : <div className="p-3 text-xs text-muted-foreground">{t('common.noData')}</div>}
        </div>
      </Section>
      <PrintProfileDialog profile={editing.profile} open={editing.open} onOpenChange={(o) => setEditing((s) => ({ ...s, open: o }))} onSave={(input) => saveM.mutateAsync(input)} saving={saveM.isPending} />
      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }} title={t('common.confirmDelete')} description={t('common.confirmDeleteDesc')} variant="destructive" loading={deleteM.isPending} onConfirm={async () => { if (deleteId) { await deleteM.mutateAsync(deleteId); setDeleteId(null); } }} />
    </div>
  );
}

// ---------- Terminals ----------
function TerminalsTab() {
  const { t, locale } = useT();
  const { branchName } = useLookups();
  const q = useQuery({ queryKey: ['terminals'], queryFn: () => settingsService.terminals() });
  return (
    <Section title={t('upgrade.terminals')}>
      {q.isLoading ? <PageLoading /> : (q.data ?? []).length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">{t('common.noData')}</div> : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-start">{t('common.code')}</th><th className="px-3 py-2 text-start">{t('common.name')}</th><th className="px-3 py-2 text-start">{t('common.branch')}</th><th className="px-3 py-2 text-start">{t('upgrade.lastSeen')}</th><th className="px-3 py-2 text-start">{t('upgrade.appVersion')}</th></tr></thead>
            <tbody>
              {(q.data ?? []).map((tm) => (
                <tr key={tm.id} className="border-t"><td className="px-3 py-2 font-mono text-xs" dir="ltr">{tm.code}</td><td className="px-3 py-2">{tm.name}</td><td className="px-3 py-2">{branchName(tm.branchId)}</td><td className="px-3 py-2 text-xs">{formatDateTime(tm.lastSeenAt, locale)}</td><td className="px-3 py-2 font-mono text-xs" dir="ltr">{tm.appVersion ?? '—'}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t('upgrade.openDesktopPos')}</p>
    </Section>
  );
}

// ---------- Form shapes for new settings tabs ----------
type PricingForm = Record<`${PriceTier}Ar` | `${PriceTier}En`, string>;
interface AlertsForm { enabled: Record<AlertType, boolean>; countVarianceThresholdPct: number; largeReturnAmount: number; maxReturnsPerCashierPerDay: number; registerVarianceAmount: number; unusualDiscountAmount: number; maxVoidsPerCashierPerDay: number; whatsappManagerPhone: string; whatsappOnCritical: boolean }
interface ReportsForm { annualCarryingRatePct: number; deadStockDefaultIdleDays: number }

export default function SettingsPage() {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'));
  const { theme, setTheme, setLocale } = useUiStore();
  const { branches, warehouses } = useLookups();
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsService.get });
  const whatsappMode = useQuery({ queryKey: ['whatsapp', 'stats'], queryFn: whatsappService.stats, enabled: canEdit });
  const sampleQ = useQuery({ queryKey: ['sales', 'sample'], queryFn: () => salesService.list({ pageSize: 1, status: 'completed' }).then((r) => r.data[0] ?? null) });
  if (q.isLoading || !q.data) return <PageLoading />;
  const s = q.data;
  const sampleSale = sampleQ.data ?? null;
  const save = async <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => { await settingsService.update(k, v, user.id); toast.success(t('settings.settingsSaved')); qc.invalidateQueries({ queryKey: ['settings'] }); };

  const pricingDefaults = Object.fromEntries(PRICE_TIERS.flatMap((tier) => [[`${tier}Ar`, s.pricing.tierLabels[tier].ar], [`${tier}En`, s.pricing.tierLabels[tier].en ?? '']])) as PricingForm;

  const tabs: [string, React.ComponentType<{ className?: string }>, string][] = [
    ['company', Building2, t('settings.company')], ['branch', Store, t('settings.branch')], ['currency', Coins, t('settings.currency')], ['invoice', FileText, t('settings.invoice')],
    ['receipt', Receipt, t('settings.receipt')], ['printing', Printer, t('upgrade.printing')], ['barcode', BarcodeIcon, t('settings.barcode')], ['pos', Monitor, t('settings.pos')],
    ['pricing', Tags, t('upgrade.pricing')], ['alerts', BellRing, t('upgrade.alerts')], ['reports', BarChart3, t('upgrade.reports')],
    ['terminals', MonitorSmartphone, t('upgrade.terminals')], ['notifications', Bell, t('settings.notifications')], ['appearance', Palette, `${t('settings.language')} / ${t('settings.theme')}`],
    ['permissions', ShieldCheck, t('settings.permissions')], ['system', Settings2, t('settings.system')],
  ];

  return (
    <div>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      {!canEdit ? <Alert variant="info" className="mb-3">{t('common.noPermissionDesc')}</Alert> : null}
      <Tabs defaultValue="company" orientation="vertical" className="flex flex-col gap-4 lg:flex-row">
        <TabsList className="h-auto w-full flex-row flex-wrap justify-start bg-transparent p-0 lg:w-56 lg:flex-col lg:items-stretch lg:border lg:bg-card">
          {tabs.map(([k, Icon, label]) => (
            <TabsTrigger key={k} value={k} className="justify-start gap-2 data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none lg:rounded-none lg:border-b lg:last:border-0 lg:px-3 lg:py-2"><Icon className="size-4" /> {label}</TabsTrigger>
          ))}
        </TabsList>
        <div className="min-w-0 flex-1">
          <TabsContent value="company" className="mt-0">
            <Section title={t('settings.company')}>
              <div className="space-y-3">
                <LogoUploader logoUrl={s.company.logoUrl} canEdit={canEdit} />
                <SectionForm
                  defaults={{ nameAr: s.company.name.ar, nameEn: s.company.name.en ?? '', taxNumber: s.company.taxNumber, commercialRegister: s.company.commercialRegister, phone: s.company.phone, email: s.company.email, addressAr: s.company.address.ar, addressEn: s.company.address.en ?? '', vatRegistered: s.company.vatRegistered, legalAr: s.company.invoiceLegalText.ar, legalEn: s.company.invoiceLegalText.en ?? '' }}
                  disabled={!canEdit}
                  onSave={(v) => save('company', { ...s.company, name: { ar: v.nameAr, en: v.nameEn || undefined }, taxNumber: v.taxNumber, commercialRegister: v.commercialRegister, phone: v.phone, email: v.email, address: { ar: v.addressAr, en: v.addressEn || undefined }, vatRegistered: v.vatRegistered, invoiceLegalText: { ar: v.legalAr, en: v.legalEn || undefined } })}
                >
                  {(f) => <>
                    <FormGrid>
                      <TextField control={f.control} name="nameAr" label={`${t('settings.companyName')} (AR)`} /><TextField control={f.control} name="nameEn" label={`${t('settings.companyName')} (EN)`} dir="ltr" />
                      <TextField control={f.control} name="taxNumber" label={t('settings.taxNumber')} dir="ltr" /><TextField control={f.control} name="commercialRegister" label={t('settings.commercialRegister')} dir="ltr" />
                      <TextField control={f.control} name="phone" label={t('common.phone')} dir="ltr" /><TextField control={f.control} name="email" label={t('common.email')} dir="ltr" />
                      <TextField control={f.control} name="addressAr" label={`${t('common.address')} (AR)`} /><TextField control={f.control} name="addressEn" label={`${t('common.address')} (EN)`} dir="ltr" />
                      <TextField control={f.control} name="legalAr" label={`${t('upgrade.invoiceLegalText')} (AR)`} /><TextField control={f.control} name="legalEn" label={`${t('upgrade.invoiceLegalText')} (EN)`} dir="ltr" />
                    </FormGrid>
                    <SwitchField control={f.control} name="vatRegistered" label={t('upgrade.vatRegistered')} />
                  </>}
                </SectionForm>
              </div>
            </Section>
          </TabsContent>
          <TabsContent value="branch" className="mt-0"><Section title={t('settings.branch')} description={t('branches.subtitle')}><div className="space-y-2">{branches.map((b) => <Link key={b.id} to={`/branches/${b.id}`} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"><span>{tx(b.name)} <span className="text-xs text-muted-foreground">({b.code})</span></span><span className="text-xs text-muted-foreground">{b.posTerminals} POS · {warehouses.filter((w) => w.branchId === b.id).length} {t('nav.warehouses')}</span></Link>)}</div><Button variant="outline" size="sm" className="mt-3" asChild><Link to="/branches">{t('nav.branches')}</Link></Button></Section></TabsContent>
          <TabsContent value="currency" className="mt-0"><Section title={t('settings.currency')}><SectionForm defaults={{ code: s.currency.code, symbolAr: s.currency.symbol.ar, symbolEn: s.currency.symbol.en ?? '', decimals: s.currency.decimals, symbolPosition: s.currency.symbolPosition }} disabled={!canEdit} onSave={(v) => save('currency', { code: v.code, symbol: { ar: v.symbolAr, en: v.symbolEn || undefined }, decimals: Number(v.decimals), symbolPosition: v.symbolPosition })}>{(f) => <FormGrid><TextField control={f.control} name="code" label={t('settings.currencyCode')} dir="ltr" /><TextField control={f.control} name="decimals" type="number" label={t('settings.decimals')} dir="ltr" /><TextField control={f.control} name="symbolAr" label={`${t('settings.currencySymbol')} (AR)`} /><TextField control={f.control} name="symbolEn" label={`${t('settings.currencySymbol')} (EN)`} dir="ltr" /><SelectField control={f.control} name="symbolPosition" label={t('settings.symbolPosition')} options={[{ value: 'before', label: t('settings.before') }, { value: 'after', label: t('settings.after') }]} /></FormGrid>}</SectionForm></Section></TabsContent>
          <TabsContent value="invoice" className="mt-0"><Section title={t('settings.invoice')}><SectionForm defaults={{ prefix: s.invoice.prefix, nextNumber: s.invoice.nextNumber, footerAr: s.invoice.footerText.ar, footerEn: s.invoice.footerText.en ?? '', showLogo: s.invoice.showLogo }} disabled={!canEdit} onSave={(v) => save('invoice', { prefix: v.prefix, nextNumber: Number(v.nextNumber), footerText: { ar: v.footerAr, en: v.footerEn || undefined }, showLogo: v.showLogo, showTax: false, taxEnabled: false, taxRate: 0, allowNegativeStock: false })}>{(f) => <><FormGrid><TextField control={f.control} name="prefix" label={t('settings.invoicePrefix')} dir="ltr" /><TextField control={f.control} name="nextNumber" type="number" label={t('settings.nextNumber')} dir="ltr" /><TextField control={f.control} name="footerAr" label={`${t('settings.footerText')} (AR)`} /><TextField control={f.control} name="footerEn" label={`${t('settings.footerText')} (EN)`} dir="ltr" /></FormGrid><FormGrid cols={3}><SwitchField control={f.control} name="showLogo" label={t('settings.showLogo')} /></FormGrid></>}</SectionForm></Section></TabsContent>
          <TabsContent value="receipt" className="mt-0"><div className="grid gap-3 lg:grid-cols-[1fr_320px]"><Section title={t('settings.receipt')}><SectionForm defaults={{ paperWidth: String(s.receipt.paperWidth), showBarcode: s.receipt.showBarcode, showCashier: s.receipt.showCashier, showCustomerBalance: s.receipt.showCustomerBalance, copies: s.receipt.copies, headerLines: s.receipt.headerLines.join('\n'), subtitleAr: s.receipt.subtitle.ar, subtitleEn: s.receipt.subtitle.en ?? '', taglineAr: s.receipt.tagline.ar, taglineEn: s.receipt.tagline.en ?? '', sloganAr: s.receipt.slogan.ar, sloganEn: s.receipt.slogan.en ?? '', warrantyAr: s.receipt.warrantyNotes.map((x) => x.ar).join('\n'), warrantyEn: s.receipt.warrantyNotes.map((x) => x.en ?? '').join('\n'), brandLogos: s.receipt.brandLogos.map((b) => `${b.name} ${b.color}`).join('\n') }} disabled={!canEdit} onSave={(v) => save('receipt', { paperWidth: 80, showBarcode: v.showBarcode, showCashier: v.showCashier, showCustomerBalance: v.showCustomerBalance, copies: Number(v.copies), headerLines: lines(v.headerLines), subtitle: { ar: v.subtitleAr, en: v.subtitleEn || undefined }, tagline: { ar: v.taglineAr, en: v.taglineEn || undefined }, slogan: { ar: v.sloganAr, en: v.sloganEn || undefined }, warrantyNotes: zipNotes(v.warrantyAr, v.warrantyEn), brandLogos: parseBrandLogos(v.brandLogos) })}>{(f) => <><FormGrid><SelectField control={f.control} name="paperWidth" label={t('settings.paperWidth')} options={[{ value: '80', label: '80 mm' }]} /><TextField control={f.control} name="copies" type="number" label={t('settings.copies')} dir="ltr" /></FormGrid><FormField label={t('settings.headerLines')}><textarea {...f.register('headerLines')} rows={3} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></FormField><FormGrid cols={3}><SwitchField control={f.control} name="showBarcode" label={t('settings.showBarcode')} /><SwitchField control={f.control} name="showCashier" label={t('settings.showCashier')} /><SwitchField control={f.control} name="showCustomerBalance" label={t('settings.showCustomerBalance')} /></FormGrid><div className="border-t pt-3"><h4 className="mb-2 text-xs font-semibold text-muted-foreground">{t('settings.invoiceBranding')}</h4><FormGrid><TextField control={f.control} name="subtitleAr" label={`${t('settings.storeSubtitle')} (AR)`} /><TextField control={f.control} name="subtitleEn" label={`${t('settings.storeSubtitle')} (EN)`} dir="ltr" /><TextField control={f.control} name="taglineAr" label={`${t('settings.storeTagline')} (AR)`} /><TextField control={f.control} name="taglineEn" label={`${t('settings.storeTagline')} (EN)`} dir="ltr" /><TextField control={f.control} name="sloganAr" label={`${t('settings.storeSlogan')} (AR)`} /><TextField control={f.control} name="sloganEn" label={`${t('settings.storeSlogan')} (EN)`} dir="ltr" /></FormGrid><FormGrid><FormField label={`${t('settings.warrantyNotes')} (AR)`} hint={t('settings.onePerLine')}><textarea {...f.register('warrantyAr')} rows={3} className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></FormField><FormField label={`${t('settings.warrantyNotes')} (EN)`} hint={t('settings.onePerLine')}><textarea {...f.register('warrantyEn')} rows={3} dir="ltr" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></FormField></FormGrid><FormField label={t('settings.brandLogos')} hint={t('settings.brandLogosHint')}><textarea {...f.register('brandLogos')} rows={3} dir="ltr" className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm" /></FormField></div></>}</SectionForm></Section><Section title={t('settings.receiptPreview')}><div className="overflow-auto rounded border bg-white text-black">{sampleSale ? <ReceiptPreview sale={sampleSale} /> : <div className="p-3 text-xs text-muted-foreground">{t('common.noData')}</div>}</div></Section></div></TabsContent>
          <TabsContent value="printing" className="mt-0"><PrintingTab sampleSale={sampleSale} canEdit={canEdit} /></TabsContent>
          <TabsContent value="barcode" className="mt-0"><Section title={t('settings.barcode')}><SectionForm defaults={{ ...s.barcode }} disabled={!canEdit} onSave={(v) => save('barcode', { internalPrefix: v.internalPrefix, length: Number(v.length), labelWidth: Number(v.labelWidth), labelHeight: Number(v.labelHeight), showPrice: v.showPrice, showName: v.showName })}>{(f) => <><FormGrid><TextField control={f.control} name="internalPrefix" label={t('settings.internalPrefix')} dir="ltr" /><TextField control={f.control} name="length" type="number" label={t('settings.barcodeLength')} dir="ltr" /><TextField control={f.control} name="labelWidth" type="number" label={t('settings.labelWidth')} dir="ltr" /><TextField control={f.control} name="labelHeight" type="number" label={t('settings.labelHeight')} dir="ltr" /></FormGrid><FormGrid><SwitchField control={f.control} name="showPrice" label={t('settings.showPrice')} /><SwitchField control={f.control} name="showName" label={t('settings.showName')} /></FormGrid></>}</SectionForm></Section></TabsContent>
          <TabsContent value="pos" className="mt-0">
            <Section title={t('settings.pos')}>
              <SectionForm
                defaults={{ defaultPaymentMethod: s.pos.defaultPaymentMethod, autoPrint: s.pos.autoPrint, maxDiscountAmount: s.pos.maxDiscountAmount, soundOnScan: s.pos.soundOnScan, openDrawerOnSale: s.pos.openDrawerOnSale, defaultPriceTier: s.pos.defaultPriceTier, showTierChooserOnScan: s.pos.showTierChooserOnScan, idleLockMinutes: s.pos.idleLockMinutes }}
                disabled={!canEdit}
                onSave={(v) => save('pos', { ...s.pos, ...v, idleLockMinutes: Math.min(240, Math.max(0, Number(v.idleLockMinutes) || 0)) })}
              >
                {(f) => <>
                  <FormGrid>
                    <SelectField control={f.control} name="defaultPaymentMethod" label={t('settings.defaultPayment')} options={[{ value: 'cash', label: t('sales.methods.cash') }, { value: 'card', label: t('sales.methods.card') }, { value: 'bank_transfer', label: t('sales.methods.bank_transfer') }]} />
                    <SelectField control={f.control} name="defaultPriceTier" label={t('upgrade.defaultTier')} options={PRICE_TIERS.map((tier) => ({ value: tier, label: tx(s.pricing.tierLabels[tier]) || t(TIER_LABEL_KEY[tier]) }))} />
                    <TextField control={f.control} name="maxDiscountAmount" type="number" label={t('settings.maxDiscount')} dir="ltr" step="0.01" />
                    <TextField control={f.control} name="idleLockMinutes" type="number" label={t('settings.idleLock')} dir="ltr" />
                  </FormGrid>
                  <FormGrid>
                    <SwitchField control={f.control} name="autoPrint" label={t('settings.autoPrint')} />
                    <SwitchField control={f.control} name="soundOnScan" label={t('settings.soundOnScan')} />
                    <SwitchField control={f.control} name="openDrawerOnSale" label={t('settings.openDrawer')} />
                    <SwitchField control={f.control} name="showTierChooserOnScan" label={t('upgrade.showTierChooserOnScan')} />
                  </FormGrid>
                </>}
              </SectionForm>
            </Section>
          </TabsContent>
          <TabsContent value="pricing" className="mt-0">
            <Section title={t('upgrade.tierLabels')}>
              <SectionForm<PricingForm>
                defaults={pricingDefaults}
                disabled={!canEdit}
                onSave={(v) => save('pricing', { tierLabels: { retail1: { ar: v.retail1Ar, en: v.retail1En || undefined }, retail2: { ar: v.retail2Ar, en: v.retail2En || undefined }, wholesale: { ar: v.wholesaleAr, en: v.wholesaleEn || undefined } } })}
              >
                {(f) => <FormGrid>{PRICE_TIERS.map((tier) => <React.Fragment key={tier}><TextField control={f.control} name={`${tier}Ar`} label={`${t(TIER_LABEL_KEY[tier])} (AR)`} /><TextField control={f.control} name={`${tier}En`} label={`${t(TIER_LABEL_KEY[tier])} (EN)`} dir="ltr" /></React.Fragment>)}</FormGrid>}
              </SectionForm>
            </Section>
          </TabsContent>
          <TabsContent value="alerts" className="mt-0">
            <Section title={t('upgrade.alerts')}>
              <SectionForm<AlertsForm>
                defaults={{ enabled: s.alerts.enabled, countVarianceThresholdPct: s.alerts.countVarianceThresholdPct, largeReturnAmount: s.alerts.largeReturnAmount, maxReturnsPerCashierPerDay: s.alerts.maxReturnsPerCashierPerDay, registerVarianceAmount: s.alerts.registerVarianceAmount, unusualDiscountAmount: s.alerts.unusualDiscountAmount, maxVoidsPerCashierPerDay: s.alerts.maxVoidsPerCashierPerDay, whatsappManagerPhone: s.alerts.whatsappManagerPhone, whatsappOnCritical: s.alerts.whatsappOnCritical }}
                disabled={!canEdit}
                onSave={(v) => save('alerts', { ...s.alerts, ...v, countVarianceThresholdPct: Number(v.countVarianceThresholdPct), largeReturnAmount: Number(v.largeReturnAmount), maxReturnsPerCashierPerDay: Number(v.maxReturnsPerCashierPerDay), registerVarianceAmount: Number(v.registerVarianceAmount), unusualDiscountAmount: Number(v.unusualDiscountAmount), maxVoidsPerCashierPerDay: Number(v.maxVoidsPerCashierPerDay) })}
              >
                {(f) => <>
                  <div className="mb-1 text-xs font-semibold">{t('upgrade.enabledTypes')}</div>
                  <FormGrid cols={3}>{ALERT_TYPES.map((type) => <SwitchField key={type} control={f.control} name={`enabled.${type}`} label={t(`upgrade.alertType.${type}`)} />)}</FormGrid>
                  <div className="mb-1 mt-3 text-xs font-semibold">{t('upgrade.thresholds')}</div>
                  <FormGrid>
                    <TextField control={f.control} name="countVarianceThresholdPct" type="number" label={t('upgrade.countVarianceThresholdPct')} dir="ltr" />
                    <TextField control={f.control} name="largeReturnAmount" type="number" label={t('upgrade.largeReturnAmount')} dir="ltr" />
                    <TextField control={f.control} name="maxReturnsPerCashierPerDay" type="number" label={t('upgrade.maxReturnsPerCashierPerDay')} dir="ltr" />
                    <TextField control={f.control} name="registerVarianceAmount" type="number" label={t('upgrade.registerVarianceAmount')} dir="ltr" />
                    <TextField control={f.control} name="unusualDiscountAmount" type="number" label={t('upgrade.unusualDiscountAmount')} dir="ltr" />
                    <TextField control={f.control} name="maxVoidsPerCashierPerDay" type="number" label={t('upgrade.maxVoidsPerCashierPerDay')} dir="ltr" />
                    <TextField control={f.control} name="whatsappManagerPhone" label={t('upgrade.whatsappManagerPhone')} dir="ltr" />
                    <SwitchField control={f.control} name="whatsappOnCritical" label={t('upgrade.whatsappOnCriticalCloud')} disabled={whatsappMode.data?.mode !== 'cloud' && !f.watch('whatsappOnCritical')} />
                  </FormGrid>
                </>}
              </SectionForm>
            </Section>
          </TabsContent>
          <TabsContent value="reports" className="mt-0">
            <Section title={t('upgrade.reports')}>
              <SectionForm<ReportsForm>
                defaults={{ annualCarryingRatePct: Math.round(s.reports.annualCarryingRate * 10000) / 100, deadStockDefaultIdleDays: s.reports.deadStockDefaultIdleDays }}
                disabled={!canEdit}
                onSave={(v) => save('reports', { annualCarryingRate: Number(v.annualCarryingRatePct) / 100, deadStockDefaultIdleDays: Number(v.deadStockDefaultIdleDays) })}
              >
                {(f) => <FormGrid><TextField control={f.control} name="annualCarryingRatePct" type="number" step="0.1" label={t('upgrade.annualCarryingRate')} dir="ltr" /><TextField control={f.control} name="deadStockDefaultIdleDays" type="number" label={t('upgrade.deadStockDefaultIdleDays')} dir="ltr" /></FormGrid>}
              </SectionForm>
            </Section>
          </TabsContent>
          <TabsContent value="terminals" className="mt-0"><TerminalsTab /></TabsContent>
          <TabsContent value="notifications" className="mt-0"><Section title={t('settings.notifications')}><SectionForm defaults={{ ...s.notifications }} disabled={!canEdit} onSave={(v) => save('notifications', v)}>{(f) => <FormGrid><SwitchField control={f.control} name="lowStock" label={t('settings.notifyLowStock')} /><SwitchField control={f.control} name="overdueDebts" label={t('settings.notifyOverdue')} /><SwitchField control={f.control} name="transfers" label={t('settings.notifyTransfers')} /><SwitchField control={f.control} name="registerClose" label={t('settings.notifyRegister')} /><SwitchField control={f.control} name="dailySummary" label={t('settings.dailySummary')} /></FormGrid>}</SectionForm></Section></TabsContent>
          <TabsContent value="appearance" className="mt-0"><Section title={`${t('settings.language')} / ${t('settings.theme')}`}><FormGrid><FormField label={t('settings.defaultLanguage')}><Select value={locale} onValueChange={(v) => setLocale(v as 'ar' | 'en')}><SelectTrigger><Globe className="size-4 me-2" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ar">العربية (RTL)</SelectItem><SelectItem value="en">English (LTR)</SelectItem></SelectContent></Select></FormField><FormField label={t('settings.defaultTheme')}><Select value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}><SelectTrigger><Palette className="size-4 me-2" /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="light">{t('header.light')}</SelectItem><SelectItem value="dark">{t('header.dark')}</SelectItem><SelectItem value="system">{t('header.system')}</SelectItem></SelectContent></Select></FormField></FormGrid></Section></TabsContent>
          <TabsContent value="permissions" className="mt-0"><Section title={t('settings.permissions')} description={t('users.permissionMatrix')}><div className="flex flex-wrap gap-2"><Button asChild variant="outline"><Link to="/roles"><ShieldCheck /> {t('users.rolesTitle')}</Link></Button><Button asChild variant="outline"><Link to="/users">{t('nav.users')}</Link></Button><Button asChild variant="outline"><Link to="/audit-logs">{t('nav.auditLogs')}</Link></Button></div></Section></TabsContent>
          <TabsContent value="system" className="mt-0"><div className="space-y-3"><Section title={t('settings.system')}><div className="text-xs text-muted-foreground">{t('common.version')}: {__APP_VERSION__}</div></Section></div></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
