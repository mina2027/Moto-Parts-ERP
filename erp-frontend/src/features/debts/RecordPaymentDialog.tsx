import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormGrid, SelectField, TextAreaField, TextField } from '@/components/shared/form';
import { Money } from '@/components/shared/page';
import { customerService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { CustomerDebt, PaymentMethod } from '@/types';

export function RecordPaymentDialog({ open, onOpenChange, customerId, customerName, debt, maxAmount, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; customerId: string; customerName: string; debt?: CustomerDebt | null; maxAmount: number; onDone?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const { options } = useLookups();
  const defaultBranch = debt?.branchId ?? user.branchId;
  const schema = z.object({
    branchId: z.string().min(1, t('validation.required')),
    amount: z.coerce.number().positive(t('validation.positive')).max(maxAmount, t('debts.amountExceeds')),
    method: z.enum(['cash', 'card', 'bank_transfer']),
    reference: z.string().optional(),
    notes: z.string().optional(),
  });
  type F = z.infer<typeof schema>;
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { branchId: defaultBranch, amount: maxAmount, method: 'cash', reference: '', notes: '' } });
  React.useEffect(() => { if (open) form.reset({ branchId: defaultBranch, amount: maxAmount, method: 'cash', reference: '', notes: '' }); }, [open, maxAmount, defaultBranch, form]);

  const submit = form.handleSubmit(async (v) => {
    await customerService.recordPayment({ customerId, debtId: debt?.id ?? null, amount: v.amount, method: v.method as PaymentMethod, reference: v.reference ?? '', userId: user.id, branchId: v.branchId, notes: v.notes });
    toast.success(t('debts.paymentDone'));
    qc.invalidateQueries({ queryKey: ['debts'] });
    qc.invalidateQueries({ queryKey: ['customers'] });
    qc.invalidateQueries({ queryKey: ['customer'] });
    onDone?.();
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('debts.recordPayment')}</DialogTitle>
          <DialogDescription>{customerName}{debt ? ` — ${t('debts.paymentFor')} ${debt.invoiceNumber}` : ''} · {t('common.remaining')}: <Money value={maxAmount} /></DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="flex gap-2">
            <Button type="button" size="xs" variant="outline" onClick={() => form.setValue('amount', maxAmount)}>{t('debts.fullPayment')}</Button>
            <Button type="button" size="xs" variant="outline" onClick={() => form.setValue('amount', Math.round(maxAmount / 2))}>{t('debts.partialPayment')} 50%</Button>
          </div>
          <FormGrid>
            <TextField control={form.control} name="amount" type="number" label={t('common.amount')} required dir="ltr" />
            <SelectField control={form.control} name="method" label={t('common.paymentMethod')} options={[{ value: 'cash', label: t('sales.methods.cash') }, { value: 'card', label: t('sales.methods.card') }, { value: 'bank_transfer', label: t('sales.methods.bank_transfer') }]} />
          </FormGrid>
          {canAll ? <SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.activeBranches} required /> : null}
          <TextField control={form.control} name="reference" label={t('common.reference')} dir="ltr" />
          <TextAreaField control={form.control} name="notes" label={t('common.notes')} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={form.formState.isSubmitting}>{t('common.confirm')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
