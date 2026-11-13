import * as React from 'react';
import type { AppSettings, Customer, ID, PaymentMethod } from '@moto/shared';
import { Alert, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, cn } from '@moto/ui';
import { Banknote, CreditCard, Landmark } from 'lucide-react';
import { formatMoney, usePosT } from '../i18n';

const METHODS: { key: Exclude<PaymentMethod, 'credit'>; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'cash', icon: Banknote },
  { key: 'card', icon: CreditCard },
  { key: 'bank_transfer', icon: Landmark },
];

export interface CollectDebtDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customers: Customer[];
  /** Customer selected in the cart, if any. */
  preselected: Customer | null;
  settings: AppSettings;
  onCollect: (input: { customerId: ID; amount: number; method: PaymentMethod; notes?: string }) => Promise<unknown>;
}

/** Takes money against a customer's outstanding balance; queued offline like every other POS write. */
export function CollectDebtDialog({ open, onOpenChange, customers, preselected, settings, onCollect }: CollectDebtDialogProps) {
  const { p, tx, locale } = usePosT();
  const m = (v: number) => formatMoney(v, locale, settings.currency.symbol, settings.currency.decimals);
  const [customerId, setCustomerId] = React.useState<ID | ''>('');
  const [search, setSearch] = React.useState('');
  const [amount, setAmount] = React.useState('');
  const [method, setMethod] = React.useState<PaymentMethod>('cash');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setCustomerId(preselected && preselected.balance > 0 ? preselected.id : '');
    setSearch('');
    setAmount('');
    setMethod('cash');
    setNotes('');
  }, [open, preselected]);

  const debtors = React.useMemo(() => {
    const t = search.trim().toLowerCase();
    return customers
      .filter((c) => c.balance > 0)
      .filter((c) => !t || `${c.name.ar} ${c.name.en ?? ''} ${c.phone} ${c.code}`.toLowerCase().includes(t))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 40);
  }, [customers, search]);

  const customer = customers.find((c) => c.id === customerId) ?? null;
  const value = Number(amount) || 0;
  const exceeds = Boolean(customer) && value > customer!.balance;
  const canSubmit = Boolean(customer) && value > 0 && !exceeds && !busy;

  const submit = async () => {
    if (!customer) return;
    setBusy(true);
    try {
      await onCollect({ customerId: customer.id, amount: value, method, notes: notes || undefined });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{p.collect.title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{p.collect.customer}</label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={p.collect.pickCustomer} className="h-10" autoFocus />
            <div className="mt-1 max-h-48 overflow-y-auto rounded-md border">
              {debtors.length === 0 ? (
                <div className="py-6 text-center text-xs text-muted-foreground">{p.collect.noDebt}</div>
              ) : (
                debtors.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setCustomerId(c.id);
                      setAmount(String(c.balance));
                    }}
                    className={cn('flex w-full items-center justify-between border-b px-3 py-2 text-start text-sm last:border-0', customerId === c.id ? 'bg-primary/10' : 'hover:bg-accent')}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{tx(c.name)}</span>
                      <span className="num text-[11px] text-muted-foreground">{c.code} · {c.phone}</span>
                    </span>
                    <span className="num font-semibold text-destructive">{m(c.balance)}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {customer ? (
            <div className="flex justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{p.collect.balance}</span>
              <span className="num font-semibold">{m(customer.balance)}</span>
            </div>
          ) : null}

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{p.collect.amount}</label>
              <Input type="number" inputMode="decimal" dir="ltr" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 text-lg" />
            </div>
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">{p.collect.method}</label>
              <div className="inline-flex rounded-md border p-0.5">
                {METHODS.map(({ key, icon: Icon }) => (
                  <Button key={key} type="button" size="sm" variant={method === key ? 'default' : 'ghost'} onClick={() => setMethod(key)}>
                    <Icon className="size-4" /> {p[key]}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">{p.collect.notes}</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {exceeds ? <Alert variant="destructive">{p.collect.exceedsBalance}</Alert> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {p.cancel}
          </Button>
          <Button type="button" disabled={!canSubmit} loading={busy} onClick={() => void submit()}>
            {p.collect.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
