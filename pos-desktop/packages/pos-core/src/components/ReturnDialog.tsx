import * as React from 'react';
import type { AppSettings, PaymentMethod, ReturnReason, Sale, SaleReturn } from '@moto/shared';
import { maxRefundFor, round2 } from '@moto/shared';
import { Alert, Badge, Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, cn } from '@moto/ui';
import { Banknote, CreditCard, Landmark, Search, Undo2, Wallet } from 'lucide-react';
import { formatDateTime, formatMoney, usePosT } from '../i18n';

const REASONS: ReturnReason[] = ['defective', 'wrong_item', 'customer_changed_mind', 'duplicate', 'other'];

export interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: AppSettings;
  /** Invoice lookup, local-first so a return works with the network down. */
  findInvoice: (invoiceNumber: string) => Promise<Sale | null>;
  recentSales: () => Promise<Sale[]>;
  onSubmit: (input: { saleId: string; items: { saleItemId: string; productId: string; quantity: number; unitPrice: number; refund: number; reason: ReturnReason }[]; refundMethod: PaymentMethod; settlement?: 'debt_first'; notes?: string }) => Promise<SaleReturn>;
  onDone: (ret: SaleReturn, sale: Sale) => void;
}

interface Row {
  quantity: number;
  reason: ReturnReason;
}

/** Pick an invoice, choose quantities (capped at what is still unreturned), refund to cash/card/debt. */
export function ReturnDialog({ open, onOpenChange, settings, findInvoice, recentSales, onSubmit, onDone }: ReturnDialogProps) {
  const { p, tx, locale } = usePosT();
  const m = (v: number) => formatMoney(v, locale, settings.currency.symbol, settings.currency.decimals);
  const [term, setTerm] = React.useState('');
  const [sale, setSale] = React.useState<Sale | null>(null);
  const [recent, setRecent] = React.useState<Sale[]>([]);
  const [rows, setRows] = React.useState<Record<string, Row>>({});
  const [method, setMethod] = React.useState<PaymentMethod | null>(null);
  const [notes, setNotes] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setTerm('');
    setSale(null);
    setRows({});
    setNotes('');
    setError(null);
    setMethod(null);
    void recentSales().then((list) => setRecent(list.filter((s) => s.status === 'completed' || s.status === 'partially_returned').slice(0, 12)));
  }, [open, recentSales]);

  const pick = (s: Sale) => {
    if (s.status === 'cancelled' || s.status === 'held') {
      setError(p.returns.notReturnable);
      return;
    }
    if (s.items.every((i) => i.returnedQty >= i.quantity)) {
      setError(p.returns.allReturned);
      return;
    }
    setError(null);
    setSale(s);
    setRows({});
    // A credit sale with money still owed defaults to writing the refund off the debt.
    setMethod(null);
  };

  const search = async () => {
    const found = await findInvoice(term.trim());
    if (!found) {
      setError(p.returns.notFound);
      setSale(null);
      return;
    }
    pick(found);
  };

  const setRow = (saleItemId: string, patch: Partial<Row>) =>
    setRows((r) => {
      const current: Row = r[saleItemId] ?? { quantity: 0, reason: 'defective' };
      return { ...r, [saleItemId]: { ...current, ...patch } };
    });

  const selected = sale
    ? sale.items
        .map((si) => ({ si, row: rows[si.id] }))
        .filter((x): x is { si: (typeof sale.items)[number]; row: Row } => Boolean(x.row && x.row.quantity > 0))
    : [];
  const refundTotal = sale ? round2(selected.reduce((a, { si, row }) => a + maxRefundFor(sale, si, row.quantity), 0)) : 0;
  const payout = sale ? round2(Math.max(0, refundTotal - sale.remaining)) : 0;
  const explicitMethodRequired = payout > 0 && (!method || method === 'credit');

  const methods: { key: PaymentMethod; icon: React.ComponentType<{ className?: string }>; label: string }[] = [
    { key: 'cash', icon: Banknote, label: p.cash },
    { key: 'card', icon: CreditCard, label: p.card },
    { key: 'bank_transfer', icon: Landmark, label: p.bank_transfer },
    ...(sale?.type === 'credit' ? [{ key: 'credit' as PaymentMethod, icon: Wallet, label: p.returns.toDebt }] : []),
  ];

  const submit = async () => {
    if (!sale || selected.length === 0 || explicitMethodRequired) {
      setError(p.returns.nothingSelected);
      return;
    }
    setBusy(true);
    try {
      const ret = await onSubmit({
        saleId: sale.id,
        items: selected.map(({ si, row }) => ({ saleItemId: si.id, productId: si.productId, quantity: row.quantity, unitPrice: si.unitPrice, refund: maxRefundFor(sale, si, row.quantity), reason: row.reason })),
        refundMethod: method ?? 'credit',
        settlement: 'debt_first',
        notes: notes || undefined,
      });
      onDone(ret, sale);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" className="max-h-[88vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="size-5" /> {p.returns.title}
          </DialogTitle>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder={p.returns.findHint}
            aria-label={p.returns.findInvoice}
            className="h-10"
            autoFocus
          />
          <Button type="button" variant="outline" className="h-10" onClick={() => void search()} disabled={!term.trim()}>
            <Search /> {p.search}
          </Button>
        </div>
        {error ? <Alert variant="destructive">{error}</Alert> : null}

        <div className="max-h-[52vh] overflow-y-auto">
          {!sale ? (
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{p.returns.recent}</div>
              <div className="rounded-md border">
                {recent.map((s) => (
                  <button key={s.id} type="button" onClick={() => pick(s)} className="flex w-full items-center justify-between border-b px-3 py-2 text-start text-sm last:border-0 hover:bg-accent">
                    <span>
                      <span className="num block font-medium">{s.invoiceNumber}</span>
                      <span className="text-[11px] text-muted-foreground">{formatDateTime(s.date)}</span>
                    </span>
                    <span className="num font-semibold">{m(s.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="num font-semibold">{sale.invoiceNumber}</span>
                <span className="text-muted-foreground">{formatDateTime(sale.date)}</span>
                <Badge variant={sale.type === 'credit' ? 'warning' : 'outline'}>{sale.type === 'credit' ? p.creditSale : p.cashSale}</Badge>
                <span className="ms-auto num font-semibold">{m(sale.total)}</span>
              </div>

              <table className="w-full">
                <thead className="bg-muted/60 text-[11px] text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-start font-medium">{p.returns.item}</th>
                    <th className="px-2 py-1.5 text-center font-medium">{p.returns.sold}</th>
                    <th className="px-2 py-1.5 text-center font-medium">{p.returns.alreadyReturned}</th>
                    <th className="px-2 py-1.5 text-center font-medium">{p.returns.returnQty}</th>
                    <th className="px-2 py-1.5 text-center font-medium">{p.returns.reason}</th>
                    <th className="px-2 py-1.5 text-end font-medium">{p.returns.refund}</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((si) => {
                    const remaining = round2(si.quantity - si.returnedQty);
                    const row = rows[si.id];
                    const qty = row?.quantity ?? 0;
                    return (
                      <tr key={si.id} className={cn('border-b text-sm last:border-0', remaining <= 0 && 'opacity-50')}>
                        <td className="px-2 py-1.5">
                          <div className="font-medium leading-tight">{tx(si.name)}</div>
                          <div className="num text-[10px] text-muted-foreground">{si.barcode} · {si.sku}</div>
                        </td>
                        <td className="num px-2 py-1.5 text-center">{si.quantity}</td>
                        <td className="num px-2 py-1.5 text-center">{si.returnedQty}</td>
                        <td className="px-2 py-1.5 text-center">
                          <div className="inline-flex items-center gap-1" dir="ltr">
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              value={qty || ''}
                              disabled={remaining <= 0}
                              onChange={(e) => setRow(si.id, { quantity: Math.max(0, Math.min(remaining, Number(e.target.value) || 0)) })}
                              className="w-16 rounded border bg-transparent px-1 py-0.5 text-center text-sm tabular focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                            />
                            <Button type="button" size="xs" variant="ghost" disabled={remaining <= 0} onClick={() => setRow(si.id, { quantity: remaining })}>
                              {remaining}
                            </Button>
                          </div>
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <select
                            value={row?.reason ?? 'defective'}
                            disabled={qty <= 0}
                            onChange={(e) => setRow(si.id, { reason: e.target.value as ReturnReason })}
                            className="rounded border bg-transparent px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                          >
                            {REASONS.map((r) => (
                              <option key={r} value={r}>
                                {p.returns.reasons[r]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="num px-2 py-1.5 text-end font-medium">{qty > 0 ? m(maxRefundFor(sale, si, qty)) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">{locale === 'ar' ? `إلغاء الدين: ${m(Math.min(refundTotal, sale.remaining))} · المبلغ المسترد: ${m(Math.max(0, refundTotal - sale.remaining))}` : `Debt reduction: ${m(Math.min(refundTotal, sale.remaining))} · Payout: ${m(Math.max(0, refundTotal - sale.remaining))}`}</span>
                <span className="text-xs text-muted-foreground">{p.returns.refundMethod}:</span>
                <div className="inline-flex rounded-md border p-0.5">
                  {methods.map(({ key, icon: Icon, label }) => (
                    <Button key={key} type="button" size="sm" variant={method === key ? 'default' : 'ghost'} onClick={() => setMethod(key)}>
                      <Icon className="size-4" /> {label}
                    </Button>
                  ))}
                </div>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={p.drawer.notes} className="h-9 w-48" />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="flex items-baseline gap-2">
            <span className="text-sm text-muted-foreground">{p.returns.total}</span>
            <span className="num text-xl font-bold">{m(refundTotal)}</span>
          </span>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {p.cancel}
            </Button>
            <Button type="button" variant="destructive" disabled={!sale || selected.length === 0 || busy || explicitMethodRequired} loading={busy} onClick={() => void submit()}>
              <Undo2 /> {p.returns.submit}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
