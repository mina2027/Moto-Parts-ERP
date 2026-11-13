import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { AlertTriangle, Search, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Checkbox } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, useListState } from '@/components/shared/data-table';
import { Money, PageHeader, Section, SearchInput } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { NumberStepper } from '@/components/shared/pickers';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { branchService, salesService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDateTime, round2 } from '@/lib/utils';
import { maxRefundFor } from '@moto/shared';
import type { PaymentMethod, ReturnReason, Sale, SaleReturn } from '@/types';

const REASONS: ReturnReason[] = ['defective', 'wrong_item', 'customer_changed_mind', 'duplicate', 'other'];

export default function ReturnsPage() {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const user = useAuthStore((s) => s.session!.user);
  const { userName, branchName, customerName } = useLookups();
  const [term, setTerm] = React.useState(params.get('invoice') ?? '');
  const [sale, setSale] = React.useState<Sale | null>(null);
  const [notFound, setNotFound] = React.useState(false);
  const [sel, setSel] = React.useState<Record<string, { qty: number; reason: ReturnReason }>>({});
  const [refundMethod, setRefundMethod] = React.useState<PaymentMethod | ''>('');
  const [drawerId, setDrawerId] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const ls = useListState();
  const list = useQuery({ queryKey: ['returns', ls.query], queryFn: () => salesService.returns(ls.query) });

  const drawersQ = useQuery({ queryKey: ['sessions', 'refund', sale?.branchId], queryFn: () => branchService.sessions({ branchId: sale!.branchId, status: 'open', pageSize: 500 }), enabled: !!sale });
  const drawers = drawersQ.data?.data ?? [];
  const refundDrawer = drawerId || (drawers.length === 1 ? drawers[0]!.id : '');

  const find = React.useCallback(async (num: string) => {
    if (!num.trim()) return;
    setBusy(true);
    const s = await salesService.findByInvoiceNumber(num);
    setBusy(false);
    setSale(s); setDrawerId(''); setSel({}); setRefundMethod(''); setNotFound(!s);
  }, []);
  React.useEffect(() => { const inv = params.get('invoice'); if (inv) find(inv); }, [params, find]);

  const refund = round2(Object.entries(sel).reduce((a, [itemId, v]) => { const it = sale?.items.find((x) => x.id === itemId); return a + (it && sale ? maxRefundFor(sale, it, v.qty) : 0); }, 0));
  const selectedCount = Object.values(sel).filter((v) => v.qty > 0).length;

  const submit = async () => {
    if (!sale) return;
    const items = Object.entries(sel).filter(([, v]) => v.qty > 0).map(([saleItemId, v]) => { const it = sale.items.find((x) => x.id === saleItemId)!; return { saleItemId, productId: it.productId, quantity: v.qty, unitPrice: it.unitPrice, refund: maxRefundFor(sale, it, v.qty), reason: v.reason }; });
    await salesService.createReturn({ saleId: sale.id, registerSessionId: refundDrawer || undefined, userId: user.id, items, refundMethod: refundMethod || 'credit', settlement: 'debt_first' });
    toast.success(t('sales.returnDone'));
    qc.invalidateQueries({ queryKey: ['returns'] }); qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['pos', 'session'] }); qc.invalidateQueries({ queryKey: ['sessions'] });
    setSale(null); setSel({}); setTerm('');
  };

  const columns = React.useMemo<ColumnDef<SaleReturn, unknown>[]>(() => [
    { accessorKey: 'returnNumber', header: t('sales.returnNumber'), cell: ({ row }) => <span className="num font-medium">{row.original.returnNumber}</span> },
    { accessorKey: 'invoiceNumber', header: t('sales.originalInvoice'), cell: ({ row }) => <Link to={`/sales/${row.original.saleId}`} className="num text-primary hover:underline">{row.original.invoiceNumber}</Link> },
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => branchName(row.original.branchId) },
    { id: 'customer', header: t('common.customer'), cell: ({ row }) => customerName(row.original.customerId) ?? t('common.walkIn') },
    { id: 'user', header: t('common.user'), cell: ({ row }) => userName(row.original.userId) },
    { id: 'items', header: t('common.items'), cell: ({ row }) => <span className="num">{row.original.items.reduce((a, i) => a + i.quantity, 0)}</span>, meta: { align: 'center' } },
    { accessorKey: 'refundAmount', header: t('sales.refundAmount'), cell: ({ row }) => <Money value={row.original.refundAmount} className="font-medium" />, meta: { align: 'end' } },
    { accessorKey: 'refundMethod', header: t('sales.refundMethod'), cell: ({ row }) => <StatusBadge status={row.original.refundMethod} labelKey="sales.methods" /> },
  ], [t, locale, branchName, customerName, userName]);

  return (
    <div>
      <PageHeader title={t('sales.returns')} subtitle={t('sales.subtitle')} backTo="/sales" />
      <Tabs defaultValue="new">
        <TabsList><TabsTrigger value="new"><Undo2 /> {t('sales.returnInvoice')}</TabsTrigger><TabsTrigger value="list">{t('common.history')}</TabsTrigger></TabsList>
        <TabsContent value="new">
          <Section title={t('sales.findInvoice')}>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(term); }}>
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t('sales.searchInvoice')} className="max-w-sm" dir="ltr" startIcon={<Search />} autoFocus />
              <Button type="submit" loading={busy}>{t('common.search')}</Button>
            </form>
            {notFound ? <Alert variant="destructive" className="mt-3">{t('sales.invoiceNotFound')}</Alert> : null}
          </Section>

          {sale ? (
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <Section title={<span>{t('sales.originalInvoice')}: <span className="num">{sale.invoiceNumber}</span></span>} className="lg:col-span-2" description={`${formatDateTime(sale.date, locale)} · ${branchName(sale.branchId)} · ${customerName(sale.customerId) ?? t('common.walkIn')}`}>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground"><tr><th className="w-8 pb-2" /><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-center font-medium">{t('common.quantity')}</th><th className="pb-2 text-center font-medium">{t('sales.maxReturnable')}</th><th className="pb-2 text-center font-medium">{t('sales.returnQty')}</th><th className="pb-2 text-start font-medium">{t('sales.returnReason')}</th><th className="pb-2 text-end font-medium">{t('sales.refundAmount')}</th></tr></thead>
                  <tbody>
                    {sale.items.map((it) => {
                      const max = it.quantity - it.returnedQty;
                      const s = sel[it.id];
                      const checked = !!s && s.qty > 0;
                      return (
                        <tr key={it.id} className={`border-t ${max === 0 ? 'opacity-50' : ''}`}>
                          <td className="py-2"><Checkbox checked={checked} disabled={max === 0} onCheckedChange={(v) => setSel((p) => ({ ...p, [it.id]: v ? { qty: max, reason: p[it.id]?.reason ?? 'defective' } : { qty: 0, reason: 'defective' } }))} /></td>
                          <td className="py-2"><div>{tx(it.name)}</div><div className="text-[10px] text-muted-foreground">{it.sku} · <Money value={it.unitPrice} /></div></td>
                          <td className="py-2 text-center num">{it.quantity}</td>
                          <td className="py-2 text-center num">{max === 0 ? <StatusBadge status="returned" label={t('sales.alreadyReturned')} /> : max}</td>
                          <td className="py-2 text-center">{checked ? <NumberStepper value={s.qty} onChange={(v) => setSel((p) => ({ ...p, [it.id]: { ...p[it.id], qty: v } }))} min={0} max={max} size="sm" /> : '—'}</td>
                          <td className="py-2">{checked ? <Select value={s.reason} onValueChange={(v) => setSel((p) => ({ ...p, [it.id]: { ...p[it.id], reason: v as ReturnReason } }))}><SelectTrigger size="sm" className="w-40"><SelectValue /></SelectTrigger><SelectContent>{REASONS.map((r) => <SelectItem key={r} value={r}>{t(`sales.reasons.${r}`)}</SelectItem>)}</SelectContent></Select> : '—'}</td>
                          <td className="py-2 text-end font-medium">{checked ? <Money value={round2((it.subtotal / it.quantity) * s.qty)} /> : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Section>
              <Section title={t('common.summary')}>
                <Alert variant="warning" icon={<AlertTriangle />} title={t('sales.returnWarning')}>{t('sales.returnWarningDesc')}</Alert>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">{t('common.items')}</span><span className="num">{selectedCount}</span></div>
                  <div className="flex justify-between text-lg font-semibold"><span>{t('sales.refundAmount')}</span><Money value={refund} /></div>
                  <div>
                    <label className="text-xs text-muted-foreground">{t('sales.refundMethod')}</label>
                    <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as PaymentMethod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['cash', 'card', 'bank_transfer', 'credit'] as const).map((m) => <SelectItem key={m} value={m}>{t(`sales.methods.${m}`)}</SelectItem>)}</SelectContent></Select>
                  </div>
                    {refundMethod === 'cash' && refund > sale.remaining ? <Select value={refundDrawer} onValueChange={setDrawerId}><SelectTrigger><SelectValue placeholder={t('expenses.register')} /></SelectTrigger><SelectContent>{drawers.map(drawer => <SelectItem key={drawer.id} value={drawer.id}>{drawer.registerId} / {userName(drawer.userId)}</SelectItem>)}</SelectContent></Select> : null}
                    <Button className="w-full" variant="warning" disabled={selectedCount === 0 || (refundMethod === 'cash' && refund > sale.remaining && !refundDrawer) || (refund > sale.remaining && (!refundMethod || refundMethod === 'credit'))} onClick={() => setConfirmOpen(true)}><Undo2 /> {t('sales.completeReturn')}</Button>
                  {selectedCount === 0 ? <p className="text-center text-xs text-muted-foreground">{t('sales.selectAtLeastOne')}</p> : null}
                </div>
              </Section>
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="list">
          <DataTable columns={columns} data={list.data?.data ?? []} total={list.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={list.isLoading} isError={list.isError} onRetry={list.refetch} toolbar={<SearchInput value={ls.search} onChange={ls.setSearch} />} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={t('sales.completeReturn')} description={t('sales.returnWarningDesc')} variant="warning" confirmText={t('sales.completeReturn')} onConfirm={submit}>
        <div className="rounded-md border bg-muted/30 p-3 text-sm"><div className="flex justify-between"><span>{t('sales.refundAmount')}</span><Money value={refund} className="font-semibold" /></div><div className="flex justify-between"><span>{t('sales.refundMethod')}</span><span>{t(`sales.methods.${refundMethod}`)}</span></div></div>
      </ConfirmDialog>
    </div>
  );
}
