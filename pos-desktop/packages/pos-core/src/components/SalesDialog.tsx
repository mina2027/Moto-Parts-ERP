import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AppSettings, Customer, Sale } from '@moto/shared';
import { Alert, Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@moto/ui';
import { ReceiptText, RefreshCw, Search } from 'lucide-react';
import type { PosAdapter } from '../adapter';
import { formatDateTime, formatMoney, usePosT } from '../i18n';

interface SalesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adapter: PosAdapter;
  settings: AppSettings;
  customers: Customer[];
}

export function SalesDialog({ open, onOpenChange, adapter, settings, customers }: SalesDialogProps) {
  const { p, tx, locale } = usePosT();
  const [term, setTerm] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const m = (value: number) => formatMoney(value, locale, settings.currency.symbol, settings.currency.decimals);
  const customerName = (sale: Sale) => {
    const customer = customers.find((c) => c.id === sale.customerId);
    return customer ? tx(customer.name) : p.walkIn;
  };
  const search = term.trim();
  const salesQ = useQuery({
    queryKey: ['pos', 'recentSales', adapter.branchId, Boolean(adapter.salesHistory), locale, adapter.salesHistory ? page : 1, adapter.salesHistory ? search : ''],
    queryFn: async () => {
      if (adapter.salesHistory) return adapter.salesHistory({ page, pageSize: 100, search });
      const data = await adapter.recentSales!(100);
      return { data, total: data.length, page: 1, pageSize: 100 };
    },
    enabled: open && Boolean(adapter.salesHistory || adapter.recentSales),
    staleTime: 0,
  });
  const list = (salesQ.data?.data ?? []).filter((sale) => adapter.salesHistory || [sale.invoiceNumber, customerName(sale), ...sale.items.map((item) => tx(item.name))].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const selected = list.find((sale) => sale.id === selectedId);
  const pages = Math.max(1, Math.ceil((salesQ.data?.total ?? 0) / 100));

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) { setTerm(''); setPage(1); setSelectedId(null); } onOpenChange(value); }}>
      <DialogContent size="xl" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
        <DialogHeader><DialogTitle className="flex items-center gap-2"><ReceiptText className="size-5" />{p.salesHistory.title}</DialogTitle><DialogDescription>{adapter.terminalCode ? p.salesHistory.desktopHint : p.salesHistory.hint}</DialogDescription></DialogHeader>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1"><Input value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); setSelectedId(null); }} maxLength={256} placeholder={p.salesHistory.search} aria-label={p.salesHistory.search} startIcon={<Search />} /></div>
          <Button variant="outline" size="icon" disabled={salesQ.isFetching} onClick={() => void salesQ.refetch()} aria-label={p.salesHistory.refresh}><RefreshCw className={salesQ.isFetching ? 'animate-spin' : undefined} /></Button>
        </div>
        {salesQ.isError ? <Alert variant="destructive">{p.salesHistory.error}</Alert> : salesQ.isPending ? <div role="status">{p.loading}</div> : (
          <div className="max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-xs text-muted-foreground"><tr><th className="p-2 text-start">{p.receipt.invoice}</th><th className="p-2 text-start">{p.receipt.date}</th><th className="p-2 text-start">{p.receipt.customer}</th><th className="p-2 text-start">{p.salesHistory.status}</th><th className="p-2 text-end">{p.total}</th></tr></thead>
              <tbody>{list.map((sale) => <tr key={sale.id} className={selected?.id === sale.id ? 'border-t bg-primary/10' : 'border-t hover:bg-accent'}>
                <td className="p-2"><button type="button" onClick={() => setSelectedId(sale.id)} className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><bdi className="num">{sale.invoiceNumber}</bdi></button></td>
                <td className="p-2 whitespace-nowrap num">{formatDateTime(sale.date)}</td><td className="p-2">{customerName(sale)}</td><td className="p-2">{p.salesHistory.statuses[sale.status]}</td><td className="p-2 text-end whitespace-nowrap num">{m(sale.total)}</td>
              </tr>)}</tbody>
            </table>
            {list.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground">{p.salesHistory.empty}</div> : null}
          </div>
        )}
        {adapter.salesHistory && salesQ.data && !salesQ.isError ? <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>{p.salesHistory.count}: <bdi className="num">{salesQ.data.total}</bdi> · {p.salesHistory.page} <bdi className="num">{page} / {pages}</bdi></span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={salesQ.isFetching || page <= 1} onClick={() => { setPage(page - 1); setSelectedId(null); }}>{p.salesHistory.previous}</Button>
            <Button variant="outline" size="sm" disabled={salesQ.isFetching || page >= pages} onClick={() => { setPage(page + 1); setSelectedId(null); }}>{p.salesHistory.next}</Button>
          </div>
        </div> : null}
        {selected ? <div className="rounded-md border p-3" aria-label={p.salesHistory.details}>
          <div className="mb-2 flex flex-wrap justify-between gap-2 text-sm font-medium"><bdi className="num">{selected.invoiceNumber}</bdi><span>{selected.type === 'credit' ? p.creditSale : p.cashSale}</span></div>
          <div className="max-h-40 overflow-auto"><table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-start">{p.product}</th><th className="py-1 text-center">{p.quantity}</th><th className="py-1 text-end">{p.price}</th><th className="py-1 text-end">{p.lineValue}</th></tr></thead><tbody>{selected.items.map((item, i) => <tr key={item.id ?? i} className="border-t"><td className="py-2">{tx(item.name)}</td><td className="py-2 text-center num">{item.quantity}</td><td className="py-2 text-end num">{m(item.unitPrice)}</td><td className="py-2 text-end num">{m(item.unitPrice * item.quantity - item.discount)}</td></tr>)}</tbody></table></div>
          <div className="mt-2 flex flex-wrap justify-between gap-2 border-t pt-2 text-sm"><span>{p.paid}: <bdi className="num">{m(selected.paid)}</bdi></span><span>{p.remaining}: <bdi className="num">{m(selected.remaining)}</bdi></span><span className="font-semibold">{p.netTotal}: <bdi className="num">{m(selected.total)}</bdi></span></div>
        </div> : null}
      </DialogContent>
    </Dialog>
  );
}
