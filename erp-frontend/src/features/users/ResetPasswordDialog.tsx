import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/shared/form';
import { useT } from '@/i18n';

export function ResetPasswordDialog({ open, onOpenChange, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (password: string) => Promise<void> }) {
  const { t } = useT();
  const schema = z
    .object({ next: z.string().min(6, t('validation.minLength', { n: 6 })), confirm: z.string() })
    .refine((d) => d.next === d.confirm, { message: t('auth.passwordMismatch'), path: ['confirm'] });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { next: '', confirm: '' } });
  const submit = form.handleSubmit(async (v) => {
    await onSubmit(v.next);
    form.reset();
    onOpenChange(false);
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>{t('users.resetPassword')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <TextField control={form.control} name="next" type="password" label={t('auth.newPassword')} required dir="ltr" />
          <TextField control={form.control} name="confirm" type="password" label={t('auth.confirmPassword')} required dir="ltr" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
            <Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
