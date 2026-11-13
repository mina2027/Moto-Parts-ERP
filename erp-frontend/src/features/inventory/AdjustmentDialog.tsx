import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/misc';
import { FormField, FormGrid, SelectField, TextAreaField, TextField } from '@/components/shared/form';
import { Combobox } from '@/components/shared/pickers';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { AdjustmentReason } from '@/types';

export function AdjustmentDialog({ open, onOpenChange, productId, damagedMode }: { open: boolean; onOpenChange: (o: boolean) => void; productId?: string; damagedMode?: boolean }) {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const { options, warehouses, product } = useLookups();
  const [confirm, setConfirm] = React.useState(false);
  const schema = z.object({ branchId: z.string().min(1, t('validation.required')), productId: z.string().min(1, t('validation.required')), warehouseId: z.string().min(1, t('validation.required')), direction: z.enum(['increase', 'decrease']), quantity: z.coerce.number().int(t('validation.integer')).positive(t('validation.positive')), reason: z.enum(['damaged', 'expired', 'lost', 'found', 'count_correction', 'other']), notes: z.string().optional() });
  type F = z.infer<typeof schema>;
  const firstWarehouse = React.useCallback((b: string) => warehouses.find((w) => w.branchId === b)?.id ?? '', [warehouses]);
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { branchId: user.branchId, productId: productId ?? '', warehouseId: firstWarehouse(user.branchId), direction: 'decrease', quantity: 1, reason: damagedMode ? 'damaged' : 'count_correction', notes: '' } });
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) form.reset({ branchId: user.branchId, productId: productId ?? '', warehouseId: firstWarehouse(user.branchId), direction: 'decrease', quantity: 1, reason: damagedMode ? 'damaged' : 'count_correction', notes: '' });
    wasOpen.current = open;
  }, [open, productId, damagedMode, user.branchId, firstWarehouse, form]);

  const v = form.watch();
  const whs = warehouses.filter((w) => w.branchId === v.branchId);
  React.useEffect(() => { if (v.warehouseId && !warehouses.some((w) => w.id === v.warehouseId && w.branchId === v.branchId)) form.setValue('warehouseId', firstWarehouse(v.branchId)); }, [v.branchId, v.warehouseId, warehouses, firstWarehouse, form]);
  const levels = useQuery({ queryKey: ['inventory', 'levels', v.productId, v.warehouseId], queryFn: () => inventoryService.levels({ productId: v.productId, warehouseId: v.warehouseId }), enabled: open && !!v.productId && !!v.warehouseId });
  const level = levels.data?.find((s) => s.productId === v.productId && s.warehouseId === v.warehouseId);
  const current = level?.quantity ?? 0;
  const next = v.direction === 'increase' ? current + (Number(v.quantity) || 0) : current - (Number(v.quantity) || 0);
  const reasons: AdjustmentReason[] = v.direction === 'increase' ? ['found', 'count_correction', 'other'] : ['damaged', 'expired', 'lost', 'count_correction', 'other'];

  const submit = form.handleSubmit(() => setConfirm(true));
  const doIt = async () => {
    const d = form.getValues();
    try {
      await inventoryService.createAdjustment({ branchId: d.branchId, warehouseId: d.warehouseId, productId: d.productId, direction: d.direction, quantity: d.quantity, reason: d.reason, notes: d.notes ?? '', userId: user.id });
      toast.success(t('inventory.adjustmentDone'));
      qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['movements'] }); qc.invalidateQueries({ queryKey: ['product'] });
      onOpenChange(false);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{damagedMode ? t('inventory.recordDamaged') : t('inventory.newAdjustment')}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <FormField label={t('common.product')} required error={form.formState.errors.productId?.message}><Combobox value={v.productId || null} onChange={(x) => form.setValue('productId', x ?? '', { shouldValidate: true })} options={options.products} placeholder={t('common.selectProduct')} /></FormField>
            <FormGrid>
              {canAll ? <SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.activeBranches} required /> : null}
              <SelectField control={form.control} name="warehouseId" label={t('common.warehouse')} options={whs.map((w) => ({ value: w.id, label: tx(w.name) }))} required />
              <SelectField control={form.control} name="direction" label={t('inventory.direction')} options={[{ value: 'increase', label: t('inventory.increase') }, { value: 'decrease', label: t('inventory.decrease') }]} disabled={damagedMode} />
              <TextField control={form.control} name="quantity" type="number" label={t('common.quantity')} required dir="ltr" />
              <SelectField control={form.control} name="reason" label={t('inventory.reason')} options={reasons.map((r) => ({ value: r, label: t(`inventory.reasons.${r}`) }))} required />
            </FormGrid>
            <TextAreaField control={form.control} name="notes" label={t('common.notes')} />
            {v.productId ? <div className="grid grid-cols-3 gap-2 rounded-md border bg-muted/30 p-2 text-center text-sm"><div><div className="text-xs text-muted-foreground">{t('inventory.previousStock')}</div><div className="font-semibold num">{current}</div></div><div><div className="text-xs text-muted-foreground">{t(`inventory.${v.direction}`)}</div><div className={`font-semibold num ${v.direction === 'increase' ? 'text-success' : 'text-destructive'}`}>{v.direction === 'increase' ? '+' : '−'}{v.quantity || 0}</div></div><div><div className="text-xs text-muted-foreground">{t('inventory.newStock')}</div><div className={`font-semibold num ${next < 0 ? 'text-destructive' : ''}`}>{next}</div></div></div> : null}
            {next < 0 ? <Alert variant="destructive">{t('pos.insufficientStock')}</Alert> : null}
            <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={next < 0}>{t('common.next')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('inventory.confirmAdjustment')} description={t('inventory.adjustmentWarning')} variant="warning" onConfirm={doIt}>
        <Alert variant="warning" icon={<AlertTriangle />}><div className="text-xs">{tx(product(v.productId)?.name)} · {t(`inventory.${v.direction}`)} {v.quantity} · {t(`inventory.reasons.${v.reason}`)}</div></Alert>
      </ConfirmDialog>
    </>
  );
}
