import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Warehouse as WarehouseIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FilterSelect, Money, PageHeader } from '@/components/shared/page';
import { FormGrid, SelectField, TextField } from '@/components/shared/form';
import { CardsLoading, ErrorState } from '@/components/shared/states';
import { StatusBadge } from '@/components/shared/status-badge';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';

function WarehouseCard({ id, onClick }: { id: string; onClick: () => void }) {
  const { t, tx } = useT();
  const { warehouses, branchName } = useLookups();
  const canCost = useAuthStore((s) => s.hasPermission('prices.view_cost'));
  const w = warehouses.find((x) => x.id === id)!;
  const stats = useQuery({ queryKey: ['warehouse', id, 'stats'], queryFn: () => inventoryService.warehouseStats(id) });
  return (
    <Card className="cursor-pointer transition-colors hover:bg-accent/40" onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2"><div className="flex size-9 items-center justify-center rounded-md bg-primary/10 text-primary"><WarehouseIcon className="size-5" /></div><div><div className="font-medium">{tx(w.name)}</div><div className="text-xs text-muted-foreground">{w.code} · {branchName(w.branchId)}</div></div></div>
          <div className="flex gap-1">{w.isMain ? <Badge variant="info">{t('warehouses.main')}</Badge> : null}<StatusBadge status={w.isActive ? 'active' : 'inactive'} label={w.isActive ? t('common.active') : t('common.inactive')} /></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded bg-muted/50 p-1.5"><div className="font-semibold num">{stats.data?.skuCount ?? '—'}</div><div className="text-muted-foreground">{t('warehouses.productsCount')}</div></div>
          <div className="rounded bg-muted/50 p-1.5"><div className="font-semibold num">{stats.data?.qty ?? '—'}</div><div className="text-muted-foreground">{t('warehouses.totalQty')}</div></div>
          <div className="rounded bg-muted/50 p-1.5"><div className="font-semibold num text-amber-600">{stats.data?.low ?? '—'}</div><div className="text-muted-foreground">{t('warehouses.lowStockItems')}</div></div>
        </div>
        <div className="mt-3"><div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{t('warehouses.utilization')}</span><span className="num">{stats.data?.utilization ?? 0}%</span></div><Progress value={stats.data?.utilization ?? 0} color={(stats.data?.utilization ?? 0) > 90 ? 'bg-destructive' : (stats.data?.utilization ?? 0) > 70 ? 'bg-warning' : 'bg-primary'} /></div>
        {canCost ? <div className="mt-2 text-xs text-muted-foreground">{t('warehouses.stockValue')}: <Money value={stats.data?.value ?? 0} className="font-medium text-foreground" /></div> : null}
      </CardContent>
    </Card>
  );
}

export default function WarehousesPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission('branches.edit'));
  const { options } = useLookups();
  const [branchId, setBranchId] = React.useState<string>();
  const [addOpen, setAddOpen] = React.useState(false);
  const q = useQuery({ queryKey: ['warehouses', branchId], queryFn: () => inventoryService.warehouses(branchId) });
  const schema = z.object({ code: z.string().min(2, t('validation.required')), nameAr: z.string().min(2, t('validation.required')), nameEn: z.string().optional(), branchId: z.string().min(1, t('validation.required')), capacity: z.coerce.number().int().min(0, t('validation.nonNegative')) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { code: '', nameAr: '', nameEn: '', branchId: '', capacity: 1000 } });
  const submit = form.handleSubmit(async (v) => { await inventoryService.saveWarehouse({ code: v.code, name: { ar: v.nameAr, en: v.nameEn }, branchId: v.branchId, capacity: v.capacity }); toast.success(t('common.created')); qc.invalidateQueries({ queryKey: ['warehouses'] }); setAddOpen(false); form.reset(); });

  return (
    <div>
      <PageHeader title={t('warehouses.title')} subtitle={t('warehouses.subtitle')} actions={<><FilterSelect value={branchId} onChange={(v) => setBranchId(v === 'all' ? undefined : v)} options={options.branches} allLabel={t('common.allBranches')} />{canEdit ? <Button onClick={() => setAddOpen(true)}><Plus /> {t('warehouses.addWarehouse')}</Button> : null}</>} />
      {q.isLoading ? <CardsLoading count={6} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{q.data?.map((w) => <WarehouseCard key={w.id} id={w.id} onClick={() => navigate(`/warehouses/${w.id}`)} />)}</div>
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{t('warehouses.addWarehouse')}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <FormGrid><TextField control={form.control} name="code" label={t('common.code')} required dir="ltr" /><SelectField control={form.control} name="branchId" label={t('warehouses.assignedBranch')} options={options.activeBranches} required /><TextField control={form.control} name="nameAr" label={t('common.nameAr')} required /><TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" /><TextField control={form.control} name="capacity" type="number" label={t('warehouses.capacity')} dir="ltr" /></FormGrid>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
