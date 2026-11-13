import * as React from 'react';
import type { AppSettings, CashMovementType, RegisterSession } from '@moto/shared';
import { Alert, Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, cn } from '@moto/ui';
import { ArrowDownLeft, ArrowUpRight, Receipt } from 'lucide-react';
import { formatDateTime, formatMoney, usePosT } from '../i18n';

/** Movement types a cashier may post from the terminal; sales and refunds are booked by the system. */
const POSTABLE: { type: Extract<CashMovementType, 'deposit' | 'withdrawal' | 'expense'>; icon: React.ComponentType<{ className?: string }> }[] = [
  { type: 'deposit', icon: ArrowDownLeft },
  { type: 'withdrawal', icon: ArrowUpRight },
  { type: 'expense', icon: Receipt },
];

export interface CashDrawerDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  session: RegisterSession | null;
  settings: AppSettings;
  onPost: (input: { type: CashMovementType; amount: number; notes?: string }) => Promise<unknown>;
}

/** Live drawer breakdown plus cash in / out / expense, all computed from local data so it works offline. */
export function CashDrawerDialog({ open, onOpenChange, session, settings, onPost }: CashDrawerDialogProps) {
  const { p, locale } = usePosT();
  const m = (v: number) => formatMoney(v, locale, settings.currency.symbol, settings.currency.decimals);
  const [type, setType] = React.useState<CashMovementType>('deposit');
  const [amount, setAmount] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setType('deposit');
      setAmount('');
      setNotes('');
    }
  }, [open]);

  const value = Number(amount) || 0;
  const submit = async () => {
    setBusy(true);
    try {
      await onPost({ type, amount: value, notes: notes || undefined });
      setAmount('');
      setNotes('');
    } finally {
      setBusy(false);
    }
  };

  const rows: [string, number][] = session
    ? [
        [p.drawer.opening, session.openingBalance],
        [p.drawer.cashSales, session.cashSales],
        [p.drawer.paymentsIn, session.paymentsIn],
        [p.drawer.paymentsOut, -session.paymentsOut],
        [p.drawer.expenses, -session.expenses],
        [p.drawer.refunds, -session.refunds],
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{p.drawer.title}</DialogTitle>
        </DialogHeader>
        {!session ? (
          <Alert variant="warning">{p.drawer.noSession}</Alert>
        ) : (
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

            <div className="inline-flex rounded-md border p-0.5">
              {POSTABLE.map(({ type: t, icon: Icon }) => (
                <Button key={t} type="button" size="sm" variant={type === t ? 'default' : 'ghost'} onClick={() => setType(t)}>
                  <Icon className="size-4" /> {p.drawer.types[t]}
                </Button>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_2fr]">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{p.drawer.amount}</label>
                <Input type="number" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg" autoFocus />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">{p.drawer.notes}</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-11" />
              </div>
            </div>

            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{p.drawer.movements}</div>
              <div className="max-h-44 space-y-1 overflow-y-auto">
                {(session.movements ?? []).length === 0 ? (
                  <div className="py-4 text-center text-xs text-muted-foreground">{p.drawer.noMovements}</div>
                ) : (
                  [...(session.movements ?? [])].reverse().map((mv) => (
                    <div key={mv.id} className="flex items-center justify-between rounded border px-2 py-1 text-xs">
                      <span className="flex items-center gap-2">
                        <Badge variant="outline">{mv.reference}</Badge>
                        <span className="text-muted-foreground">{formatDateTime(mv.date)}</span>
                      </span>
                      <span className={cn('num font-medium', mv.type === 'withdrawal' || mv.type === 'expense' || mv.type === 'refund' ? 'text-destructive' : 'text-foreground')}>{m(mv.amount)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {p.close}
          </Button>
          <Button type="button" disabled={!session || value <= 0 || busy} loading={busy} onClick={() => void submit()}>
            {p.drawer.post}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
