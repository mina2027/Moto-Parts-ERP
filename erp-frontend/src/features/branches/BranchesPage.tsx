import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Building2, Monitor, Plus, Trophy, Users, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Money, PageHeader } from '@/components/shared/page';
import { ChartCard, NamedBarChart } from '@/components/shared/charts';
import { FormGrid, SelectField, TextField } from '@/components/shared/form';
import { StatusBadge } from '@/components/shared/status-badge';
import { CardsLoading, ErrorState } from '@/components/shared/states';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { Branch } from '@/types';

export function BranchFormDialog({ open, onOpenChange, branch, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; branch?: Branch | null; onSaved?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { options } = useLookups();
  const schema = z.object({ code: z.string().min(2, t('validation.required')).max(5), nameAr: z.string().min(2, t('validation.required')), nameEn: z.string().optional(), cityAr: z.string().optional(), cityEn: z.string().optional(), addressAr: z.string().optional(), addressEn: z.string().optional(), phone: z.string().optional(), managerId: z.string().optional(), posTerminals: z.coerce.number().int().min(0) });
  type F = z.infer<typeof schema>;
  const defaults = React.useCallback((b?: Branch | null): F => ({ code: b?.code ?? '', nameAr: b?.name.ar ?? '', nameEn: b?.name.en ?? '', cityAr: b?.city.ar ?? '', cityEn: b?.city.en ?? '', addressAr: b?.address.ar ?? '', addressEn: b?.address.en ?? '', phone: b?.phone ?? '', managerId: b?.managerId ?? '', posTerminals: b?.posTerminals ?? 1 }), []);
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: defaults(branch) });
  React.useEffect(() => { if (open) form.reset(defaults(branch)); }, [open, branch, defaults, form]);
  const submit = form.handleSubmit(async (v) => { await branchService.save({ id: branch?.id, code: v.code.toUpperCase(), name: { ar: v.nameAr, en: v.nameEn }, city: { ar: v.cityAr ?? '', en: v.cityEn }, address: { ar: v.addressAr ?? '', en: v.addressEn ?? '' }, phone: v.phone ?? '', managerId: v.managerId, posTerminals: v.posTerminals, isActive: branch?.isActive ?? true }); toast.success(t('branches.branchSaved')); qc.invalidateQueries({ queryKey: ['branches'] }); qc.invalidateQueries({ queryKey: ['branch'] }); onSaved?.(); onOpenChange(false); });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{branch ? t('common.edit') : t('branches.addBranch')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid><TextField control={form.control} name="code" label={t('common.code')} required dir="ltr" /><SelectField control={form.control} name="managerId" label={t('branches.manager')} options={options.users} /><TextField control={form.control} name="nameAr" label={t('common.nameAr')} required /><TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" /><TextField control={form.control} name="cityAr" label={`${t('branches.city')} (AR)`} /><TextField control={form.control} name="cityEn" label={`${t('branches.city')} (EN)`} dir="ltr" /><TextField control={form.control} name="addressAr" label={`${t('common.address')} (AR)`} /><TextField control={form.control} name="addressEn" label={`${t('common.address')} (EN)`} dir="ltr" /><TextField control={form.control} name="phone" label={t('common.phone')} dir="ltr" /><TextField control={form.control} name="posTerminals" type="number" label={t('branches.posTerminals')} dir="ltr" /></FormGrid>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function BranchesPage() {
  const { t, tx } = useT();
  const navigate = useNavigate();
  const canEdit = useAuthStore((s) => s.hasPermission('branches.edit'));
  const canFinancial = useAuthStore((s) => s.hasPermission('reports.financial') && s.hasPermission('prices.view_cost'));
  const { userName } = useLookups();
  const [addOpen, setAddOpen] = React.useState(false);
  const perf = useQuery({ queryKey: ['branches', 'performance'], queryFn: branchService.performance });

  return (
    <div>
      <PageHeader title={t('branches.title')} subtitle={t('branches.subtitle')} actions={canEdit ? <Button onClick={() => setAddOpen(true)}><Plus /> {t('branches.addBranch')}</Button> : undefined} />
      {perf.isLoading ? <CardsLoading count={5} /> : perf.isError ? <ErrorState onRetry={() => perf.refetch()} /> : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {perf.data?.map((p, i) => (
              <Card key={p.branch.id} className={cn('cursor-pointer transition-colors hover:bg-accent/40', !p.branch.isActive && 'opacity-60')} onClick={() => navigate(`/branches/${p.branch.id}`)}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2"><div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"><Building2 className="size-5" /></div><div><div className="font-medium">{tx(p.branch.name)}</div><div className="text-xs text-muted-foreground">{p.branch.code} · {tx(p.branch.city)}</div></div></div>
                    <div className="flex gap-1">{i === 0 && p.branch.isActive ? <Badge variant="warning"><Trophy className="size-3" /> #1</Badge> : <Badge variant="outline">#{i + 1}</Badge>}<StatusBadge status={p.branch.isActive ? 'active' : 'inactive'} label={p.branch.isActive ? t('common.active') : t('common.inactive')} /></div>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded bg-muted/50 p-2"><div className="text-muted-foreground">{t('branches.salesThisMonth')}</div><Money value={p.revenue} className="font-semibold" /></div>
                    {canFinancial ? <div className="rounded bg-muted/50 p-2"><div className="text-muted-foreground">{t('branches.profitThisMonth')}</div><Money value={p.net} className={cn('font-semibold', p.net < 0 ? 'text-destructive' : 'text-success')} /></div> : <div className="rounded bg-muted/50 p-2"><div className="text-muted-foreground">{t('dashboard.invoices')}</div><span className="font-semibold num">{p.invoices}</span></div>}
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-muted-foreground"><span className="inline-flex items-center gap-1"><Users className="size-3" /> {userName(p.branch.managerId)}</span><span className="inline-flex items-center gap-1"><Monitor className="size-3" /> {p.branch.posTerminals}</span><span className="inline-flex items-center gap-1"><Warehouse className="size-3" /> {p.warehouses}</span><span className="inline-flex items-center gap-1"><Users className="size-3" /> {p.employees}</span></div>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ChartCard title={`${t('branches.comparison')} — ${t('branches.sales')}`}><NamedBarChart data={(perf.data ?? []).filter((p) => p.branch.isActive).map((p) => ({ name: p.branch.name, value: p.revenue }))} height={240} /></ChartCard>
            {canFinancial ? <ChartCard title={`${t('branches.comparison')} — ${t('common.profit')}`}><NamedBarChart data={(perf.data ?? []).filter((p) => p.branch.isActive).map((p) => ({ name: p.branch.name, value: p.net }))} height={240} color="#16a34a" /></ChartCard> : <ChartCard title={`${t('branches.comparison')} — ${t('dashboard.invoices')}`}><NamedBarChart data={(perf.data ?? []).filter((p) => p.branch.isActive).map((p) => ({ name: p.branch.name, value: p.invoices }))} height={240} color="#0891b2" /></ChartCard>}
          </div>
        </>
      )}
      <BranchFormDialog open={addOpen} onOpenChange={setAddOpen} onSaved={() => perf.refetch()} />
    </div>
  );
}
