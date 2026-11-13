import * as React from 'react';
import { toast } from 'sonner';
import { Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@moto/ui';
import { usePosT } from '@moto/pos-core';
import { tx } from '@moto/shared';
import type { PairingInfo } from '../../../shared/ipc';
import { FIXED_SERVER_URL } from '../../../shared/server';

type BranchOpt = Awaited<ReturnType<Window['pos']['app']['branchesFor']>>[number];

export function PairingScreen({ onPaired }: { onPaired: (info: PairingInfo) => void }) {
  const { p, locale } = usePosT();
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [terminalName, setTerminalName] = React.useState('POS 1');
  const [branches, setBranches] = React.useState<BranchOpt[] | null>(null);
  const [branchId, setBranchId] = React.useState('');
  const [registerId, setRegisterId] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const list = await window.pos.app.branchesFor({ serverUrl: FIXED_SERVER_URL, username, password });
      setBranches(list);
      setBranchId(list[0]?.id ?? '');
      setRegisterId(list[0]?.registers[0]?.id ?? '');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : p.pairing.connectFailed);
    } finally {
      setBusy(false);
    }
  };
  const pair = async () => {
    setBusy(true);
    try {
      const info = await window.pos.app.pair({ serverUrl: FIXED_SERVER_URL, username, password, terminalName, branchId, registerId: registerId || null });
      onPaired(info);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : p.pairing.pairFailed);
    } finally {
      setBusy(false);
    }
  };
  const branch = branches?.find((b) => b.id === branchId);

  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-md space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">{p.pairing.title}</h1>
          <p className="text-sm text-muted-foreground">{p.pairing.subtitle}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2"><Label>{p.pairing.adminUser}</Label><Input dir="ltr" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="manager" disabled={Boolean(branches)} /></div>
          <div className="space-y-2"><Label>{p.auth.password}</Label><Input dir="ltr" type="password" value={password} onChange={(e) => setPassword(e.target.value)} disabled={Boolean(branches)} onKeyDown={(e) => e.key === 'Enter' && !branches && void connect()} /></div>
        </div>
        {!branches ? (
          <Button className="w-full" onClick={connect} loading={busy} disabled={!username || !password}>{p.pairing.connect}</Button>
        ) : (
          <>
            <div className="space-y-2"><Label>{p.pairing.terminalName}</Label><Input value={terminalName} onChange={(e) => setTerminalName(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label>{p.pairing.branch}</Label>
                <Select value={branchId} onValueChange={(v) => { setBranchId(v); setRegisterId(branches.find((b) => b.id === v)?.registers[0]?.id ?? ''); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{branches.map((b) => <SelectItem key={b.id} value={b.id}>{tx(b.name, locale)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{p.shell.register}</Label>
                <Select value={registerId} onValueChange={setRegisterId}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>{(branch?.registers ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{tx(r.name, locale)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setBranches(null)} disabled={busy}>{p.pairing.back}</Button>
              <Button className="flex-1" onClick={pair} loading={busy} disabled={!branchId || !terminalName}>{p.pairing.pair}</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
