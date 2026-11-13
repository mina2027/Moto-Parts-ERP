import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormGrid, SelectField, TextField } from '@/components/shared/form';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import type { RoleKey, User } from '@/types';

const ROLES: RoleKey[] = ['admin', 'branch_manager', 'accountant', 'cashier', 'sales', 'warehouse'];

export function UserFormDialog({ open, onOpenChange, user, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; user?: User | null; onSaved?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const actor = useAuthStore((s) => s.session!.user);
  const { options } = useLookups();
  const schema = z.object({ username: z.string().min(3, t('validation.minLength', { n: 3 })).regex(/^[a-z0-9._-]+$/i, t('validation.required')), nameAr: z.string().min(2, t('validation.required')), nameEn: z.string().optional(), email: z.string().email(t('validation.email')).or(z.literal('')), phone: z.string().regex(/^01[0125]\d{8}$/, t('validation.phone')).or(z.literal('')), role: z.enum(['admin', 'branch_manager', 'accountant', 'cashier', 'sales', 'warehouse']), branchId: z.string().min(1, t('validation.required')), password: user ? z.string().optional() : z.string().min(6, t('validation.minLength', { n: 6 })) });
  type F = z.infer<typeof schema>;
  const defaults = React.useCallback((u?: User | null): F => ({ username: u?.username ?? '', nameAr: u?.fullName.ar ?? '', nameEn: u?.fullName.en ?? '', email: u?.email ?? '', phone: u?.phone ?? '', role: u?.role ?? 'cashier', branchId: u?.branchId ?? actor.branchId, password: '' }), [actor.branchId]);
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: defaults(user) });
  React.useEffect(() => { if (open) form.reset(defaults(user)); }, [open, user, defaults, form]);
  const submit = form.handleSubmit(async (v) => {
    try {
      await branchService.saveUser({ id: user?.id, username: v.username, fullName: { ar: v.nameAr, en: v.nameEn }, email: v.email, phone: v.phone, role: v.role, branchId: v.branchId, status: user?.status ?? 'active', extraPermissions: user?.extraPermissions, ...(v.password ? { password: v.password } : {}) }, actor.id);
      toast.success(t('common.saved'));
      qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['user'] });
      onSaved?.(); onOpenChange(false);
    } catch (e) { form.setError('username', { message: t('validation.unique') }); void e; }
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{user ? t('common.edit') : t('users.addUser')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid><TextField control={form.control} name="username" label={t('common.username')} required dir="ltr" disabled={!!user} /><SelectField control={form.control} name="role" label={t('users.role')} options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} required /><TextField control={form.control} name="nameAr" label={t('common.nameAr')} required /><TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" /><TextField control={form.control} name="email" type="email" label={t('common.email')} dir="ltr" /><TextField control={form.control} name="phone" label={t('common.phone')} dir="ltr" /><SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.branches} required />{!user ? <TextField control={form.control} name="password" type="password" label={t('common.password')} required dir="ltr" /> : null}</FormGrid>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
