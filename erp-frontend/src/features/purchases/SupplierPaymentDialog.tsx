import * as React from 'react';
import { uuid } from '@moto/shared';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormField, FormGrid, SelectField, TextAreaField, TextField } from '@/components/shared/form';
import { Combobox } from '@/components/shared/pickers';
import { Money } from '@/components/shared/page';
import { purchaseService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { PaymentMethod } from '@/types';

export function SupplierPaymentDialog({ open, onOpenChange, supplierId: initialSupplier, purchaseId, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; supplierId?: string; purchaseId?: string; onDone?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const { options, suppliers } = useLookups();
  const [supplierId, setSupplierId] = React.useState<string | null>(initialSupplier ?? null);
  const paymentRequest = React.useRef<{ fingerprint: string; key: string } | null>(null);
  const supplier = suppliers.find((s) => s.id === supplierId);
  const purchaseQ = useQuery({ queryKey: ['purchase', purchaseId], queryFn: () => purchaseService.get(purchaseId!), enabled: open && !!purchaseId });
  const purchase = purchaseId ? purchaseQ.data : null;
  const max = purchase ? purchase.remaining : supplier?.balance ?? 0;
  const schema = z.object({ amount: z.coerce.number().positive(t('validation.positive')).max(max || Infinity, t('debts.amountExceeds')), method: z.enum(['cash', 'bank_transfer', 'card']), reference: z.string().optional(), notes: z.string().optional() });
  type F = z.infer<typeof schema>;
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { amount: max, method: 'bank_transfer', reference: '', notes: '' } });
  React.useEffect(() => { if (open) { setSupplierId(initialSupplier ?? null); form.reset({ amount: 0, method: 'bank_transfer', reference: '', notes: '' }); } }, [open, initialSupplier, form]);
  React.useEffect(() => { if (open) form.setValue('amount', max); }, [open, max, form]);

  const submit = form.handleSubmit(async (v) => {
    if (!supplierId) return;
    const input = { supplierId, purchaseId: purchaseId ?? null, amount: v.amount, method: v.method as PaymentMethod, reference: v.reference ?? '', userId: user.id, notes: v.notes };
    const fingerprint = JSON.stringify(input);
    if (paymentRequest.current?.fingerprint !== fingerprint) paymentRequest.current = { fingerprint, key: uuid() };
    try {
      await purchaseService.recordPayment(input, paymentRequest.current.key);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.error'));
      return;
    }
    paymentRequest.current = null;
    toast.success(t('purchases.paymentDone'));
    qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['supplier'] });
    onDone?.(); onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{t('purchases.newPayment')}</DialogTitle><DialogDescription>{purchase ? `${purchase.invoiceNumber} · ` : ''}{t('common.remaining')}: <Money value={max} /></DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          {!initialSupplier ? <FormField label={t('common.supplier')} required><Combobox value={supplierId} onChange={setSupplierId} options={options.suppliers} placeholder={t('common.selectSupplier')} /></FormField> : null}
          <FormGrid><TextField control={form.control} name="amount" type="number" label={t('common.amount')} required dir="ltr" /><SelectField control={form.control} name="method" label={t('common.paymentMethod')} options={[{ value: 'bank_transfer', label: t('sales.methods.bank_transfer') }, { value: 'cash', label: t('sales.methods.cash') }, { value: 'card', label: t('sales.methods.card') }]} /></FormGrid>
          <TextField control={form.control} name="reference" label={t('common.reference')} dir="ltr" />
          <TextAreaField control={form.control} name="notes" label={t('common.notes')} />
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" disabled={!supplierId} loading={form.formState.isSubmitting}>{t('common.confirm')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
