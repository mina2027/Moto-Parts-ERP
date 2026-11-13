import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/shared/form';
import { authService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useT();
  const user = useAuthStore((s) => s.session?.user);
  const schema = z
    .object({ current: z.string().min(1, t('validation.required')), next: z.string().min(6, t('validation.minLength', { n: 6 })), confirm: z.string() })
    .refine((d) => d.next === d.confirm, { message: t('auth.passwordMismatch'), path: ['confirm'] });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { current: '', next: '', confirm: '' } });

  const submit = form.handleSubmit(async (v) => {
    try {
      await authService.changePassword(user!.id, v.current, v.next);
      toast.success(t('auth.passwordChanged'));
      form.reset();
      onOpenChange(false);
    } catch {
      form.setError('current', { message: t('auth.invalid') });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('common.changePassword')}</DialogTitle>
          <DialogDescription>{t('auth.newPassword')}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <TextField control={form.control} name="current" type="password" label={t('auth.currentPassword')} required />
          <TextField control={form.control} name="next" type="password" label={t('auth.newPassword')} required />
          <TextField control={form.control} name="confirm" type="password" label={t('auth.confirmPassword')} required />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
