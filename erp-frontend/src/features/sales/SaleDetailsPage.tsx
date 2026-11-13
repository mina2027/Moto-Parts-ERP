import * as React from 'react';
import { flushSync } from 'react-dom';
import { checkoutProfileForSize, PrintDialog, PosLocaleContext, type InvoiceSize } from '@moto/pos-core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, MessageCircle, Printer, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { KeyValue, Money, PageHeader, Section } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { Receipt } from '@/features/sales/receipt';
import { SendWhatsAppDialog } from '@/features/whatsapp/SendWhatsAppDialog';
import { branchService, salesService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { formatDateTime, formatDate } from '@/lib/utils';
import { printBrowserInvoice } from '@/lib/invoicePrint';

export default function SaleDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName, userName, customerName, customers, product } = useLookups();
  const { settings } = useSettings();
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelMethod, setCancelMethod] = React.useState<'cash' | 'card' | 'bank_transfer' | 'credit' | ''>('');
  const [drawerId, setDrawerId] = React.useState('');
  const [waOpen, setWaOpen] = React.useState(false);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [printSize, setPrintSize] = React.useState<InvoiceSize>('small');
  const printRef = React.useRef<HTMLDivElement>(null);

  const q = useQuery({ queryKey: ['sale', id], queryFn: () => salesService.get(id) });
  const drawersQ = useQuery({ queryKey: ['sessions', 'cancel-drawers', q.data?.branchId], queryFn: () => branchService.sessions({ branchId: q.data!.branchId, status: 'open', pageSize: 500 }).then(r => r.data), enabled: cancelOpen && !!q.data });
  const drawers = drawersQ.data ?? [];
  const refundDrawer = drawerId || (drawers.length === 1 ? drawers[0]!.id : '');
  const invoiceNumber = q.data?.invoiceNumber;
  const returnsQ = useQuery({ queryKey: ['sales', 'returns', { saleId: id }], queryFn: () => salesService.returns({ search: invoiceNumber, pageSize: 100 }).then((r) => r.data.filter((x) => x.saleId === id)), enabled: !!invoiceNumber });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const sale = q.data;
  const returns = returnsQ.data ?? [];
  const customer = sale.customerId ? customers.find((c) => c.id === sale.customerId) : null;
  const canReturn = hasPermission('returns.create') && sale.status !== 'cancelled' && sale.status !== 'returned';
  const canCancel = hasPermission('sales.cancel') && sale.status === 'completed';

  return (
    <div>
      <PageHeader
        backTo="/sales"
        title={<span className="num">{sale.invoiceNumber}</span>}
        badge={<><StatusBadge status={sale.status} labelKey="sales.status" /><StatusBadge status={sale.type} labelKey="sales.types" />{sale.syncStatus === 'pending' ? <StatusBadge status="pending" label={t('sync.pending')} /> : null}</>}
        subtitle={`${formatDateTime(sale.date, locale)} · ${branchName(sale.branchId)} · ${userName(sale.cashierId)}`}
        actions={
          <>
            {hasPermission('sales.print') ? <Button variant="outline" onClick={() => setPrintOpen(true)}><Printer /> {t('common.reprint')}</Button> : null}
            {customer && hasPermission('whatsapp.send') ? <Button variant="outline" onClick={() => setWaOpen(true)}><MessageCircle /> {t('whatsapp.sendInvoice')}</Button> : null}
            {canReturn ? <Button variant="warning" onClick={() => navigate(`/sales/returns?invoice=${sale.invoiceNumber}`)}><Undo2 /> {t('sales.returnInvoice')}</Button> : null}
            {canCancel ? <Button variant="destructive" onClick={() => setCancelOpen(true)}><Ban /> {t('sales.cancelInvoice')}</Button> : null}
          </>
        }
      />
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Section title={t('common.generalInfo')}>
            <KeyValue cols={4} items={[
              { label: t('common.invoiceNumber'), value: <span className="num">{sale.invoiceNumber}</span> }, { label: t('common.date'), value: <span className="num">{formatDateTime(sale.date, locale)}</span> },
              { label: t('common.branch'), value: branchName(sale.branchId) }, { label: t('common.cashier'), value: userName(sale.cashierId) },
              { label: t('common.customer'), value: customer ? <Link to={`/customers/${customer.id}`} className="text-primary hover:underline">{customerName(customer.id)}</Link> : t('common.walkIn') }, { label: t('common.phone'), value: <span className="num">{customer?.phone ?? '—'}</span> },
              { label: t('common.paymentMethod'), value: <div className="flex flex-wrap gap-1">{sale.payments.length ? sale.payments.map((p, i) => <StatusBadge key={i} status={p.method} label={`${t(`sales.methods.${p.method}`)} ${p.reference ? `(${p.reference})` : ''}`} />) : <StatusBadge status="credit" labelKey="sales.methods" />}</div> },
              { label: t('common.dueDate'), value: sale.dueDate ? <span className="num">{formatDate(sale.dueDate, locale)}</span> : '—' },
            ]} />
          </Section>
          <Section title={t('common.items')}>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">#</th><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-start font-medium">{t('common.barcode')}</th><th className="pb-2 text-center font-medium">{t('common.quantity')}</th><th className="pb-2 text-end font-medium">{t('sales.unitPrice')}</th><th className="pb-2 text-end font-medium">{t('common.discount')}</th><th className="pb-2 text-end font-medium">{t('common.subtotal')}</th></tr></thead>
                <tbody>
                  {sale.items.map((it, i) => (
                    <tr key={it.id} className="border-t">
                      <td className="py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5"><Link to={`/products/${it.productId}`} className="hover:underline">{tx(it.name)}</Link><div className="text-[10px] text-muted-foreground">{it.sku}{it.returnedQty ? <span className="ms-2 text-destructive">{t('nav.returns')}: {it.returnedQty}</span> : null}</div></td>
                      <td className="py-1.5 num text-xs">{it.barcode}</td>
                      <td className="py-1.5 text-center num">{it.quantity}</td>
                      <td className="py-1.5 text-end"><Money value={it.unitPrice} /></td>
                      <td className="py-1.5 text-end">{it.discount ? <span className="text-destructive"><Money value={-it.discount} /></span> : '—'}</td>
                      <td className="py-1.5 text-end font-medium"><Money value={it.subtotal} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t text-sm">
                  <tr><td colSpan={6} className="pt-2 text-end text-muted-foreground">{t('common.subtotal')}</td><td className="pt-2 text-end"><Money value={sale.subtotal} /></td></tr>
                  {sale.itemDiscounts ? <tr><td colSpan={6} className="text-end text-muted-foreground">{t('pos.itemDiscount')}</td><td className="text-end text-destructive"><Money value={-sale.itemDiscounts} /></td></tr> : null}
                  {sale.invoiceDiscount ? <tr><td colSpan={6} className="text-end text-muted-foreground">{t('pos.invoiceDiscount')}</td><td className="text-end text-destructive"><Money value={-sale.invoiceDiscount} /></td></tr> : null}
                  {settings.invoice.showTax ? <tr><td colSpan={6} className="text-end text-muted-foreground">{t('common.tax')}</td><td className="text-end"><Money value={sale.tax} /></td></tr> : null}
                  <tr className="text-base font-semibold"><td colSpan={6} className="pt-1 text-end">{t('common.total')}</td><td className="pt-1 text-end"><Money value={sale.total} /></td></tr>
                  <tr><td colSpan={6} className="text-end text-muted-foreground">{t('common.paid')}</td><td className="text-end text-success"><Money value={sale.paid - sale.change} /></td></tr>
                  {sale.change ? <tr><td colSpan={6} className="text-end text-muted-foreground">{t('common.change')}</td><td className="text-end"><Money value={sale.change} /></td></tr> : null}
                  {sale.remaining ? <tr className="font-semibold"><td colSpan={6} className="text-end text-destructive">{t('common.remaining')}</td><td className="text-end text-destructive"><Money value={sale.remaining} /></td></tr> : null}
                </tfoot>
              </table>
            </div>
          </Section>
          {returns.length ? (
            <Section title={t('sales.returns')}>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('sales.returnNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-start font-medium">{t('common.items')}</th><th className="pb-2 text-end font-medium">{t('sales.refundAmount')}</th></tr></thead>
                <tbody>{returns.map((r) => <tr key={r.id} className="border-t"><td className="py-1.5 num">{r.returnNumber}</td><td className="py-1.5 num text-xs">{formatDateTime(r.date, locale)}</td><td className="py-1.5 text-xs">{userName(r.userId)}</td><td className="py-1.5 text-xs">{r.items.map((i) => `${tx(product(i.productId)?.name)} ×${i.quantity} (${t(`sales.reasons.${i.reason}`)})`).join('، ')}</td><td className="py-1.5 text-end font-medium"><Money value={r.refundAmount} /></td></tr>)}</tbody>
              </table>
            </Section>
          ) : null}
        </div>
        <div>
          <Section title={t('sales.receipt')} actions={hasPermission('sales.print') ? <Button size="xs" variant="ghost" aria-label={t('common.print')} onClick={() => setPrintOpen(true)}><Printer /></Button> : undefined}>
            <div className="overflow-auto rounded border bg-white"><Receipt sale={sale} /></div>
          </Section>
        </div>
      </div>
      <div className="fixed -left-[10000px] top-0" aria-hidden><Receipt ref={printRef} sale={sale} size={printSize} /></div>
      <PosLocaleContext.Provider value={locale}>
        <PrintDialog open={printOpen} onOpenChange={setPrintOpen} initialSize={printSize} title={t('common.reprint')} onPrint={async (size) => {
          flushSync(() => setPrintSize(size));
          await printBrowserInvoice(printRef.current, checkoutProfileForSize(size));
        }} />
      </PosLocaleContext.Provider>

      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t('sales.cancelConfirm')} description={t('sales.cancelDesc')} variant="destructive" confirmText={t('sales.cancelInvoice')} onConfirm={async () => { if (!cancelMethod) { toast.error(locale === 'ar' ? 'اختر طريقة ردّ المدفوع أو إلغاء الدين' : 'Choose a refund or debt method'); return; } if (cancelMethod === 'cash' && sale.paid > 0 && !refundDrawer) { toast.error(t('expenses.register')); return; } await salesService.cancel(sale.id, user.id, cancelMethod, refundDrawer || undefined); toast.success(t('sales.cancelled')); q.refetch(); qc.invalidateQueries({ queryKey: ['sales'] }); qc.invalidateQueries({ queryKey: ['pos', 'session'] }); qc.invalidateQueries({ queryKey: ['sessions'] }); }}>
        <label className="my-3 flex items-center gap-2 text-sm">{locale === 'ar' ? 'طريقة ردّ المدفوع بعد إلغاء الدين' : 'Refund method after debt reduction'}<select className="rounded border bg-background p-2" value={cancelMethod} onChange={e => setCancelMethod(e.target.value as typeof cancelMethod)}><option value="">{locale === 'ar' ? 'اختر الطريقة' : 'Choose a method'}</option>{(['cash', 'card', 'bank_transfer', 'credit'] as const).map(method => <option key={method} value={method}>{t(`sales.methods.${method}`)}</option>)}</select></label>
        {cancelMethod === 'cash' && sale.paid > 0 ? <label className="my-3 flex items-center gap-2 text-sm">{t('expenses.register')}<select className="rounded border bg-background p-2" value={refundDrawer} onChange={e => setDrawerId(e.target.value)}><option value="">{t('expenses.register')}</option>{drawers.map(drawer => <option key={drawer.id} value={drawer.id}>{drawer.registerId} / {userName(drawer.userId)}</option>)}</select></label> : null}
      </ConfirmDialog>
      {customer ? <SendWhatsAppDialog open={waOpen} onOpenChange={setWaOpen} customer={customer} sale={sale} defaultTemplate="invoice" /> : null}
    </div>
  );
}
