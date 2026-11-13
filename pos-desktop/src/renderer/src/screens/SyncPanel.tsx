import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge, Button, Sheet, SheetContent, SheetHeader, SheetTitle } from '@moto/ui';
import { formatDateTime, usePosT } from '@moto/pos-core';
import { LogIn, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react';
import type { ConnectivityInfo, OutboxRow, PairingInfo } from '../../../shared/ipc';

const statusVariant: Record<OutboxRow['status'], 'secondary' | 'warning' | 'success' | 'destructive'> = { pending: 'secondary', sent: 'warning', applied: 'success', rejected: 'destructive' };

/** Sync panel: pending/rejected ops with per-op retry / void actions. */
export function SyncPanel({ open, onOpenChange, status, onReregistered, onSessionCleared }: { open: boolean; onOpenChange: (o: boolean) => void; status: ConnectivityInfo; onReregistered?: (p: PairingInfo) => void; onSessionCleared?: () => void }) {
  const { p, locale } = usePosT();
  const s = p.shell;
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['outbox'], queryFn: () => window.pos.sync.outbox(), enabled: open, refetchInterval: open ? 3000 : false });
  const refresh = () => qc.invalidateQueries({ queryKey: ['outbox'] });
  const [registering, setRegistering] = React.useState(false);
  const [voidMethod, setVoidMethod] = React.useState<'cash' | 'card' | 'bank_transfer'>('cash');
  const [voidReference, setVoidReference] = React.useState('');
  const opLabel = (type: string) => (s.opTypes as Record<string, string | undefined>)[type] ?? type;
  const reregister = async () => {
    setRegistering(true);
    try {
      const info = await window.pos.app.reregister();
      onReregistered?.(info);
      toast.success(`${s.reregistered} · ${info.terminal?.code ?? ''}`);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : s.reregisterFailed);
    } finally {
      setRegistering(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle className="flex items-center justify-between">
            <span>{s.sync}</span>
            <Button size="sm" variant="outline" onClick={() => window.pos.sync.syncNow().then(refresh)} disabled={status.syncing || status.unregistered}>
              <RefreshCw className={status.syncing ? 'animate-spin' : ''} /> {status.online ? s.syncNow : s.reconnect}
            </Button>
          </SheetTitle>
        </SheetHeader>
        <Button className="mt-2" size="sm" variant="outline" onClick={() => window.pos.app.archive().then(() => toast.success(locale === 'ar' ? 'تم حفظ نسخة موثقة داخل ملفات الجهاز' : 'Verified archive saved in the terminal profile')).catch((e: Error) => toast.error(e.message))}>{locale === 'ar' ? 'حفظ نسخة بيانات الجهاز' : 'Archive terminal data'}</Button>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{s.status}</div><div className={status.online && !status.unregistered ? 'text-success' : 'text-destructive'}>{status.unregistered ? s.notRegistered : status.online ? p.online : p.offline}</div></div>
          <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{s.waiting}</div><div className="num font-semibold">{status.pending}</div></div>
          <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{s.rejected}</div><div className={`num font-semibold ${status.rejected ? 'text-destructive' : ''}`}>{status.rejected}</div></div>
        </div>
        {status.unregistered ? (
          <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <div className="text-sm font-medium text-destructive">{p.unregistered}</div>
            <p className="mt-1 text-xs text-muted-foreground">{p.unregisteredDesc}</p>
            <Button size="sm" className="mt-2" disabled={!status.online || registering} onClick={() => void reregister()}>
              <ShieldCheck className={registering ? 'animate-pulse' : ''} /> {s.reregister}
            </Button>
          </div>
        ) : status.error ? (
          <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <div>{status.error}</div>
            {status.online ? <Button size="sm" variant="outline" className="mt-2" onClick={async () => { await window.pos.auth.logout(); onSessionCleared?.(); onOpenChange(false); }}><LogIn /> {s.onlineLogin}</Button> : null}
          </div>
        ) : null}
        <div className="mt-3 max-h-[70vh] space-y-1.5 overflow-y-auto">
          {(q.data ?? []).map((op) => (
            <div key={op.opId} className="rounded-md border p-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{opLabel(op.type)} · <span className="num">{op.summary}</span></span>
                <Badge variant={statusVariant[op.status]}>{s.opStatus[op.status]}</Badge>
              </div>
              <div className="mt-0.5 num text-[11px] text-muted-foreground">{formatDateTime(op.createdAt)} · {op.attempts} {s.attempts}</div>
              {op.error ? <div className="mt-1 text-xs text-destructive">{op.error}</div> : null}
              {op.status === 'rejected' ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <Button size="xs" variant="outline" disabled={op.error?.startsWith('SYNC_RECOVERY_REQUIRED')} onClick={() => window.pos.sync.retryRejected(op.opId).then(refresh).catch((e: Error) => toast.error(e.message))}><RotateCcw /> {s.retryOp}</Button>
                  {op.type === 'sale' ? <><label className="text-xs">{locale === 'ar' ? 'طريقة ردّ المدفوع' : 'Payout method'} <select value={voidMethod} onChange={e => setVoidMethod(e.target.value as typeof voidMethod)} className="rounded border bg-background">{(['cash', 'card', 'bank_transfer'] as const).map(method => <option key={method} value={method}>{p[method]}</option>)}</select></label><input className="rounded border bg-background px-1 text-xs" aria-label={locale === 'ar' ? 'مرجع التسوية' : 'Settlement reference'} placeholder={locale === 'ar' ? 'مرجع التسوية' : 'Settlement reference'} value={voidReference} onChange={e => setVoidReference(e.target.value)} /><Button size="xs" variant="ghost" className="text-destructive" disabled={!voidReference.trim()} onClick={() => window.pos.sync.voidRejected(op.opId, { method: voidMethod, reference: voidReference }).then(refresh).catch((e: Error) => toast.error(e.message))}><Trash2 /> {s.voidOp}</Button></> : null}
                </div>
              ) : null}
            </div>
          ))}
          {q.data && !q.data.length ? <div className="py-10 text-center text-sm text-muted-foreground">{s.noOps}</div> : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
