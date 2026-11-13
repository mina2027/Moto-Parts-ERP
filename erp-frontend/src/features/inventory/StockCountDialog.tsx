import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField, FormGrid, SelectField } from '@/components/shared/form';
import { Combobox } from '@/components/shared/pickers';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { productCategoryIds } from '@moto/shared';

export function StockCountDialog({ open, onOpenChange, initialProductIds = [], initialBranchId, initialWarehouseId }: { open: boolean; onOpenChange: (o: boolean) => void; initialProductIds?: string[]; initialBranchId?: string; initialWarehouseId?: string }) {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.session!.user);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const { options, warehouses, products, categoryName } = useLookups();
  const schema = z.object({
    branchId: z.string().min(1, t('validation.required')),
    warehouseId: z.string().min(1, t('validation.required')),
    scope: z.enum(['all', 'category', 'selected']),
    categoryIds: z.array(z.string()),
  }).refine((v) => v.scope !== 'category' || v.categoryIds.length > 0, { path: ['categoryIds'], message: t('common.selectCategory') });
  type F = z.infer<typeof schema>;
  const firstWarehouse = React.useCallback((b: string) => warehouses.find((w) => w.branchId === b && w.isMain)?.id ?? warehouses.find((w) => w.branchId === b)?.id ?? '', [warehouses]);
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { branchId: user.branchId, warehouseId: firstWarehouse(user.branchId), scope: 'all', categoryIds: [] } });
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) {
      const branch = canAll ? initialBranchId ?? user.branchId : user.branchId;
      form.reset({ branchId: branch, warehouseId: initialWarehouseId ?? firstWarehouse(branch), scope: initialProductIds.length ? 'selected' : 'all', categoryIds: [] });
    }
    wasOpen.current = open;
  }, [open, user.branchId, firstWarehouse, form, canAll, initialBranchId, initialWarehouseId, initialProductIds.length]);

  const v = form.watch();
  const whs = warehouses.filter((w) => w.branchId === v.branchId);
  React.useEffect(() => { if (!whs.some((w) => w.id === v.warehouseId)) { const id = firstWarehouse(v.branchId); if (id !== v.warehouseId) form.setValue('warehouseId', id); } }, [v.branchId, v.warehouseId, whs, firstWarehouse, form]);

  const selected = products.filter((p) => p.isActive && (v.scope === 'all' || (v.scope === 'selected' ? initialProductIds.includes(p.id) : productCategoryIds(p).some(id => v.categoryIds.includes(id)))));
  const remainingCategories = options.categories.filter((c) => !v.categoryIds.includes(c.value));

  const submit = form.handleSubmit(async (d) => {
    if (!selected.length) { toast.error(t('inventory.noProductsForCount')); return; }
    try {
      const c = await inventoryService.createCount({ branchId: d.branchId, warehouseId: d.warehouseId, userId: user.id, productIds: selected.map((p) => p.id) });
      toast.success(t('common.created'));
      qc.invalidateQueries({ queryKey: ['inventory', 'counts'] });
      onOpenChange(false);
      navigate(`/inventory/counts/${c.id}`);
    } catch (e) { toast.error((e as Error).message); }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{t('inventory.newCount')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid>
            {canAll ? <SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.activeBranches} required /> : null}
            <SelectField control={form.control} name="warehouseId" label={t('common.warehouse')} options={whs.map((w) => ({ value: w.id, label: tx(w.name) }))} required />
            <SelectField control={form.control} name="scope" label={t('inventory.countScope')} options={[{ value: 'all', label: t('inventory.countScopeAll') }, { value: 'category', label: t('inventory.countScopeCategory') }, ...(initialProductIds.length ? [{ value: 'selected', label: t('inventory.countScopeSelected') }] : [])]} />
          </FormGrid>
          {v.scope === 'category' ? (
            <FormField label={t('common.category')} required error={form.formState.errors.categoryIds?.message}>
              <Combobox value={null} onChange={(id) => { if (id) form.setValue('categoryIds', [...v.categoryIds, id], { shouldValidate: true }); }} options={remainingCategories} placeholder={t('common.selectCategory')} />
              {v.categoryIds.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {v.categoryIds.map((id) => (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-muted px-2.5 py-1 text-xs">
                      {categoryName(id)}
                      <button type="button" aria-label={t('common.delete')} className="text-muted-foreground hover:text-destructive" onClick={() => form.setValue('categoryIds', v.categoryIds.filter((x) => x !== id), { shouldValidate: true })}><X className="size-3" /></button>
                    </span>
                  ))}
                </div>
              ) : null}
            </FormField>
          ) : null}
          <div className="rounded-md border bg-muted/30 p-2 text-center text-sm"><span className="text-xs text-muted-foreground">{t('inventory.productsToCount')}</span> <span className="num font-semibold">{selected.length}</span></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={!selected.length}>{t('inventory.startCount')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
