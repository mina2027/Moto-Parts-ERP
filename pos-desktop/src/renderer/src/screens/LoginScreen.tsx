import type { RendererSession } from '../../../shared/ipc';
import * as React from 'react';
import { toast } from 'sonner';
import { Button, Input, Label } from '@moto/ui';
import { usePosT } from '@moto/pos-core';

import type { PairingInfo } from '../../../shared/ipc';

export function LoginScreen({ pairing, online, onLogin, onUnpair }: { pairing: PairingInfo; online: boolean; onLogin: (s: RendererSession) => void; onUnpair: () => Promise<void> }) {
  const { p } = usePosT();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);
  const unpair = async () => {
    if (busy) return;
    if (!username.trim() || !password) {
      toast.error(p.auth.unpairCredentialsRequired);
      (!username.trim() ? usernameRef : passwordRef).current?.focus();
      return;
    }
    setBusy(true);
    let authenticated = false;
    try {
      await window.pos.auth.login({ username: username.trim().toLowerCase(), password });
      authenticated = true;
      await onUnpair();
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reasons = [
        ['PERMISSION_DENIED', p.auth.unpairPermissionDenied],
        ['AUTH_REQUIRED', p.auth.unpairCredentialsRequired],
        ['UNSYNCED_OPERATIONS', p.auth.unpairUnsynced],
        ['RECONCILIATION_REQUIRED', p.auth.unpairOpenShift],
        ['SETTLEMENT_ARCHIVE_REQUIRED', p.auth.unpairSettlement],
        ['OFFLINE_LOGIN_FAILED', p.auth.offlineLoginFailed],
      ];
      const reason = reasons.find(([code]) => message.includes(code));
      toast.error(reason?.[1] ?? (authenticated ? p.auth.unpairFailed : p.auth.badCredentials));
    } finally { setBusy(false); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      onLogin(await window.pos.auth.login({ username: username.trim().toLowerCase(), password }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast.error(msg === 'OFFLINE_LOGIN_FAILED' ? p.auth.offlineLoginFailed : p.auth.badCredentials);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{p.auth.signIn}</h1>
          <p className="text-xs text-muted-foreground num">{pairing.terminal?.code} · {pairing.terminal?.name} · {online ? p.online : p.offline}</p>
        </div>
        <div className="space-y-2"><Label>{p.auth.username}</Label><Input ref={usernameRef} dir="ltr" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} /></div>
        <div className="space-y-2"><Label>{p.auth.password}</Label><Input ref={passwordRef} dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <Button type="submit" className="w-full" loading={busy} disabled={!username || !password}>{p.auth.signInAction}</Button>
        <div className="space-y-2 border-t pt-3">
          <p className="text-center text-xs text-muted-foreground">{p.auth.unpairHint}</p>
          <button type="button" className="w-full text-center text-xs text-muted-foreground hover:underline disabled:opacity-50" disabled={busy} onClick={unpair}>{p.auth.unpair}</button>
        </div>
      </form>
    </div>
  );
}
