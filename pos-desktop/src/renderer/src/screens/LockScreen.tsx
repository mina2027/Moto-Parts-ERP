import type { RendererSession } from '../../../shared/ipc';
import * as React from 'react';
import { Button, Input, Label } from '@moto/ui';
import { usePosT } from '@moto/pos-core';
import { Lock } from 'lucide-react';


/**
 * Covers the terminal after an idle timeout. Nothing is torn down: the cart, held invoices and the
 * outbox stay exactly where they were, so unlocking resumes mid-sale.
 */
export function LockScreen({ session, onUnlock }: { session: RendererSession; onUnlock: () => void }) {
  const { p, tx } = usePosT();
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(false);
    try {
      await window.pos.auth.login({ username: session.user.username, password });
      setPassword('');
      onUnlock();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-lg">
        <div className="flex items-center gap-2">
          <Lock className="size-5 text-muted-foreground" />
          <div>
            <h1 className="text-lg font-semibold">{p.idle.locked}</h1>
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
    </div>
  );
}
