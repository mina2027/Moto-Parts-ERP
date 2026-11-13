import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button, Input, Label } from '@moto/ui';
import { usePosT } from '@moto/pos-core';
import { Lock } from 'lucide-react';
import type { Session } from '@moto/shared';
import { authService } from '@/services/authService';
import { useAuthStore } from '@/stores/authStore';

/**
 * Covers the terminal without unmounting the cart. The modal owns focus even when payment is open.
 */
export function LockScreen({ session, onUnlock }: { session: Session; onUnlock: () => void }) {
  const { p, tx } = usePosT();
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError(false);
    try {
      const refreshed = await authService.login(session.user.username, password);
      if (refreshed.user.id !== session.user.id) throw new Error('USER_CHANGED');
      useAuthStore.getState().setSession(refreshed);
      setPassword('');
      onUnlock();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogPrimitive.Root open>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[100] bg-background/95 backdrop-blur" />
        <DialogPrimitive.Content aria-describedby={undefined} onEscapeKeyDown={(e) => e.preventDefault()} onInteractOutside={(e) => e.preventDefault()} className="fixed left-1/2 top-1/2 z-[101] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-card p-6 shadow-lg">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="size-5 text-muted-foreground" />
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">{p.idle.locked}</DialogPrimitive.Title>
            <p className="text-xs text-muted-foreground">{tx(session.user.fullName)}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{p.idle.lockedHint}</p>
        <div className="space-y-2">
          <Label>{p.auth.password}</Label>
          <Input dir="ltr" type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error ? <p className="text-xs font-medium text-destructive">{p.idle.wrongPassword}</p> : null}
        <Button type="submit" className="w-full" loading={busy} disabled={!password}>
          {p.idle.unlock}
        </Button>
      </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
