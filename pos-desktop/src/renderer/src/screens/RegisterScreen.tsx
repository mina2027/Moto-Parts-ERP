import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Alert, Button, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, cn } from '@moto/ui';
import { formatMoney, usePosT } from '@moto/pos-core';
import { round2, tx } from '@moto/shared';
import type { AppSettings, RegisterSession } from '@moto/shared';

export function OpenRegisterScreen({ defaultRegisterId, onOpened, onSkip }: { defaultRegisterId: string | null; onOpened: (s: RegisterSession) => void; onSkip: () => void }) {
  const { p, locale } = usePosT();
  const regs = useQuery({ queryKey: ['registers'], queryFn: () => window.pos.data.registers() });
  const [registerId, setRegisterId] = React.useState(defaultRegisterId ?? '');
  const [opening, setOpening] = React.useState('0');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!registerId && regs.data?.[0]) setRegisterId(regs.data[0].id);
  }, [regs.data, registerId]);
  const submit = async () => {
    setBusy(true);
    try {
      onOpened(await window.pos.data.openSession({ registerId, openingBalance: Number(opening) || 0 }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : p.shell.openShiftFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold">{p.shell.openShift}</h1>
        <div className="space-y-2">
          <Label>{p.shell.register}</Label>
          <Select value={registerId} onValueChange={setRegisterId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{(regs.data ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{tx(r.name, locale)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label>{p.drawer.opening}</Label><Input dir="ltr" type="number" value={opening} onChange={(e) => setOpening(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && void submit()} /></div>
        <Button className="w-full" onClick={submit} loading={busy} disabled={!registerId}>{p.shell.openShift}</Button>
        <Alert variant="warning" className="text-xs">{p.shell.skipShiftWarning}</Alert>
        <button type="button" className="w-full text-center text-xs text-muted-foreground hover:underline" onClick={onSkip}>{p.shell.skipShift}</button>
      </div>
    </div>
  );
}

/**
 * Counting blind is how drawers go missing: the expected figure, its breakdown and the live
 * over/short are all shown before the cashier commits. Every number comes from local data.
 */
export function CloseRegisterDialogBody({ session, settings, onClosed }: { session: RegisterSession; settings: AppSettings; onClosed: () => void }) {
  const { p, locale } = usePosT();
  const m = (v: number) => formatMoney(v, locale, settings.currency.symbol, settings.currency.decimals);
  const [actual, setActual] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<RegisterSession | null>(null);

  const counted = Number(actual) || 0;
  const difference = round2(counted - session.expectedCash);
  const rows: [string, number][] = [
    [p.drawer.opening, session.openingBalance],
    [p.drawer.cashSales, session.cashSales],
    [p.drawer.paymentsIn, session.paymentsIn],
    [p.drawer.paymentsOut, -session.paymentsOut],
    [p.drawer.expenses, -session.expenses],
    [p.drawer.refunds, -session.refunds],
  ];

  const submit = async () => {
    setBusy(true);
    try {
      setResult(await window.pos.data.closeSession({ sessionId: session.id, actualCash: counted, notes: notes || undefined }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : p.shell.closeShiftFailed);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const diff = result.difference ?? 0;
    return (
      <div className="space-y-3">
        <div className="rounded-md border bg-muted/30 p-3 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">{p.drawer.expected}</span><span className="num">{m(result.expectedCash)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">{p.drawer.counted}</span><span className="num">{m(result.actualCash ?? 0)}</span></div>
          <div className="mt-1 flex items-baseline justify-between border-t pt-2">
            <span className="font-semibold">{diff === 0 ? p.drawer.balanced : diff > 0 ? p.drawer.over : p.drawer.short}</span>
            <span className={cn('num text-lg font-bold', diff === 0 ? 'text-success' : 'text-destructive')}>{m(Math.abs(diff))}</span>
          </div>
        </div>
        <Button className="w-full" onClick={onClosed}>{p.close}</Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/30 p-3 text-sm">
        {rows.map(([label, v]) => (
          <div key={label} className="flex justify-between text-muted-foreground">
            <span>{label}</span>
            <span className="num">{v < 0 ? `-${m(Math.abs(v))}` : m(v)}</span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between border-t pt-2">
          <span className="font-semibold">{p.drawer.expected}</span>
          <span className="num text-xl font-bold">{m(session.expectedCash)}</span>
        </div>
      </div>
      <div className="space-y-1"><Label>{p.drawer.counted}</Label><Input dir="ltr" type="number" value={actual} onChange={(e) => setActual(e.target.value)} className="h-11 text-lg" autoFocus /></div>
      {actual !== '' ? (
        <div className="flex items-baseline justify-between rounded-md border px-3 py-2">
          <span className="text-sm">{difference === 0 ? p.drawer.balanced : difference > 0 ? p.drawer.over : p.drawer.short}</span>
          <span className={cn('num text-lg font-bold', difference === 0 ? 'text-success' : 'text-destructive')}>{m(Math.abs(difference))}</span>
        </div>
      ) : null}
      <div className="space-y-1"><Label>{p.drawer.notes}</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      <Button className="w-full" variant="destructive" onClick={submit} loading={busy} disabled={actual === ''}>{p.shell.closeShift}</Button>
    </div>
  );
}
