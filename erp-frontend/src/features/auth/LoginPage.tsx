import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { BarChart3, Bike, Boxes, Globe, Lock, Store, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/misc';
import { DeveloperCredit } from '@/components/shared/developer-credit';
import { HomeRedirect } from './HomeRedirect';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useT } from '@/i18n';

export default function LoginPage() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { login, status } = useAuthStore();
  const setLocale = useUiStore((s) => s.setLocale);
  const [error, setError] = React.useState<string | null>(null);

  const schema = z.object({ username: z.string().min(1, t('validation.required')), password: z.string().min(1, t('validation.required')) });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { username: '', password: '' } });
  const isSubmitting = form.formState.isSubmitting;
  const modules = [
    { Icon: Store, title: t('nav.sales'), sub: t('nav.cashRegisters') },
    { Icon: Boxes, title: t('nav.inventory'), sub: t('nav.transfers') },
    { Icon: BarChart3, title: t('nav.reports'), sub: t('nav.accounting') },
  ];

  if (status === 'authenticated') return <HomeRedirect />;

  const submit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      await login(v.username, v.password);
      const from = (location.state as { from?: string } | null)?.from ?? '/';
      navigate(from, { replace: true });
    } catch {
      setError(t('auth.invalid'));
    }
  });

  return (
    <div className="flex min-h-screen bg-background">
      <div className="hidden w-1/2 flex-col justify-between bg-sidebar p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-lg bg-primary"><Bike className="size-6" /></div>
          <div>
            <div className="text-lg font-semibold">{t('app.name')}</div>
            <div className="text-xs text-white/60">{t('app.tagline')}</div>
          </div>
        </div>
        {/* Modules, not counts: the login screen is unauthenticated and must not expose business figures. */}
        <div className="space-y-3">
          {modules.map(({ Icon, title, sub }) => (
            <div key={title} className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 p-3">
              <div className="flex size-9 items-center justify-center rounded-md bg-white/10"><Icon className="size-4" /></div>
              <div>
                <div className="text-sm font-medium">{title}</div>
                <div className="text-xs text-white/50">{sub}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="text-xs text-white/40">© 2026 MotoParts ERP · v{__APP_VERSION__}</div>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 lg:hidden">
              <div className="flex size-9 items-center justify-center rounded-md bg-primary text-white"><Bike className="size-5" /></div>
              <span className="font-semibold">{t('app.name')}</span>
            </div>
            <Button variant="ghost" size="sm" className="ms-auto" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
              <Globe /> {locale === 'ar' ? 'English' : 'العربية'}
            </Button>
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t('auth.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
          </div>
          <form onSubmit={submit} className="space-y-4" noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="username" required>{t('auth.username')}</Label>
              <Input id="username" autoComplete="username" startIcon={<User />} {...form.register('username')} autoFocus dir="ltr" />
              {form.formState.errors.username ? <p className="text-xs text-destructive">{form.formState.errors.username.message}</p> : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" required>{t('auth.password')}</Label>
              <Input id="password" type="password" autoComplete="current-password" startIcon={<Lock />} {...form.register('password')} dir="ltr" />
              {form.formState.errors.password ? <p className="text-xs text-destructive">{form.formState.errors.password.message}</p> : null}
            </div>
            {error ? <Alert variant="destructive">{error}</Alert> : null}
            <Button type="submit" className="w-full" loading={isSubmitting}>{isSubmitting ? t('auth.loggingIn') : t('auth.login')}</Button>
          </form>
          <DeveloperCredit />
        </div>
      </div>
    </div>
  );
}
