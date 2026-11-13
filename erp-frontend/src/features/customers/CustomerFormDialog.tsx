import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getCountries, getCountryCallingCode, parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormGrid, SelectField, TextAreaField, TextField } from '@/components/shared/form';
import { customerService } from '@/services';
import { useLookups } from '@/hooks/useLookups';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import type { Customer } from '@/types';

const countryOptions = getCountries().map((country) => ({
  value: country,
  label: `${new Intl.DisplayNames(['ar'], { type: 'region' }).of(country) ?? country} (+${getCountryCallingCode(country)})`,
}));

function normalizedPhone(value: string, country: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), country);
  return parsed?.isValid() ? parsed.number.replace('+', '') : null;
}

export function CustomerFormDialog({ open, onOpenChange, customer, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer | null; onSaved?: (c: Customer) => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const { options } = useLookups();
  const branchId = useAuthStore((s) => s.session!.user.branchId);
  const [country, setCountry] = React.useState<CountryCode>('SD');
  const schema = z.object({
    nameAr: z.string().min(2, t('validation.minLength', { n: 2 })),
    nameEn: z.string().optional(),
    phone: z.string(),
    whatsapp: z.string().optional(),
    type: z.enum(['retail', 'wholesale', 'workshop']),
    creditLimit: z.coerce.number().min(0, t('validation.nonNegative')),
    branchId: z.string().min(1, t('validation.required')),
    addressAr: z.string().optional(),
    addressEn: z.string().optional(),
    notes: z.string().optional(),
  });
  type F = z.infer<typeof schema>;
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { nameAr: '', nameEn: '', phone: '', whatsapp: '', type: 'retail', creditLimit: 0, branchId, addressAr: '', addressEn: '', notes: '' } });

  React.useEffect(() => {
    if (!open) return;
    const existing = customer?.whatsapp || customer?.phone;
    const parsed = existing ? parsePhoneNumberFromString(existing.startsWith('+') ? existing : `+${existing}`) : null;
    setCountry(parsed?.country ?? 'SD');
    form.reset(customer ? { nameAr: customer.name.ar, nameEn: customer.name.en, phone: customer.phone, whatsapp: customer.whatsapp, type: customer.type, creditLimit: customer.creditLimit, branchId: customer.branchId, addressAr: customer.address.ar, addressEn: customer.address.en, notes: customer.notes ?? '' } : { nameAr: '', nameEn: '', phone: '', whatsapp: '', type: 'retail', creditLimit: 0, branchId, addressAr: '', addressEn: '', notes: '' });
  }, [open, customer, branchId, form]);

  const submit = form.handleSubmit(async (v) => {
    const phone = v.phone ? normalizedPhone(v.phone, country) : '';
    const whatsapp = v.whatsapp ? normalizedPhone(v.whatsapp, country) : phone;
    if (v.phone && !phone) { form.setError('phone', { message: t('validation.phone') }); return; }
    if (v.whatsapp && !whatsapp) { form.setError('whatsapp', { message: t('validation.phone') }); return; }
    const saved = await customerService.save({ id: customer?.id, name: { ar: v.nameAr, en: v.nameEn }, phone: phone ?? '', whatsapp: whatsapp ?? '', type: v.type, creditLimit: v.creditLimit, branchId: v.branchId, address: { ar: v.addressAr ?? '', en: v.addressEn ?? '' }, notes: v.notes, isActive: customer?.isActive ?? true });
    toast.success(customer ? t('common.updated') : t('common.created'));
    qc.invalidateQueries({ queryKey: ['customers'] });
    onSaved?.(saved);
    onOpenChange(false);
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{customer ? t('common.edit') : t('customers.addCustomer')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid>
            <TextField control={form.control} name="nameAr" label={t('common.nameAr')} required />
            <TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" />
            <div className="space-y-1.5"><label className="text-sm font-medium">{t('common.country')}</label><select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)} dir="ltr">{countryOptions.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></div>
            <TextField control={form.control} name="phone" label={t('common.phone')} dir="ltr" placeholder="0912345678" />
            <TextField control={form.control} name="whatsapp" label={t('customers.whatsapp')} dir="ltr" hint={t('common.optional')} placeholder="+249912345678" />
            <SelectField control={form.control} name="type" label={t('common.type')} options={(['retail', 'wholesale', 'workshop'] as const).map((k) => ({ value: k, label: t(`customers.types.${k}`) }))} />
            <TextField control={form.control} name="creditLimit" type="number" label={t('customers.creditLimit')} dir="ltr" />
            <SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.activeBranches} required />
            <TextField control={form.control} name="addressAr" label={`${t('common.address')} (AR)`} />
            <TextField control={form.control} name="addressEn" label={`${t('common.address')} (EN)`} dir="ltr" />
          </FormGrid>
          <TextAreaField control={form.control} name="notes" label={t('common.notes')} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
