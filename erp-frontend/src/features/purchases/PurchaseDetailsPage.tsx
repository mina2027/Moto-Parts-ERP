import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, HandCoins, PackageCheck, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, Progress } from '@/components/ui/misc';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { SupplierPaymentDialog } from './SupplierPaymentDialog';
import { inventoryService, purchaseService } from '@/services';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDate, formatDateTime } from '@/lib/utils';

export default function PurchaseDetailsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { supplierName, branchName, warehouseName, userName, productName, product } = useLookups();
  const [recvOpen, setRecvOpen] = React.useState(false);
  const [retOpen, setRetOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelMethod, setCancelMethod] = React.useState<'cash' | 'card' | 'bank_transfer' | ''>('');
  const [recvQty, setRecvQty] = React.useState<Record<string, number>>({});
  const [retQty, setRetQty] = React.useState<Record<string, number>>({});
  const [retReason, setRetReason] = React.useState('');
  const [retMethod, setRetMethod] = React.useState<'cash' | 'card' | 'bank_transfer' | ''>('');
  const [returnBusy, setReturnBusy] = React.useState(false);
  const returnKey = React.useRef(crypto.randomUUID());
  const [receiptReferences, setReceiptReferences] = React.useState<Record<string, string>>({});
  const [receiptBusy, setReceiptBusy] = React.useState(false);

  const q = useQuery({ queryKey: ['purchase', id], queryFn: () => purchaseService.get(id) });
  const reimbursements = useQuery({ queryKey: ['purchase-reimbursements', id], queryFn: () => purchaseService.reimbursements(id), enabled: hasPermission('purchases.view') });
  const whId = q.data?.warehouseId;
  const levels = useQuery({ queryKey: ['inventory', 'levels', { warehouseId: whId }], queryFn: () => inventoryService.levels({ warehouseId: whId }), enabled: !!whId });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const p = q.data;
  const received = p.items.reduce((a, i) => a + i.receivedQty, 0);
  const ordered = p.items.reduce((a, i) => a + i.quantity, 0);
  const canReceive = hasPermission('purchases.receive') && (p.status === 'ordered' || p.status === 'partially_received');
  const refresh = () => { q.refetch(); reimbursements.refetch(); qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['suppliers'] }); };
  const currentStock = (pid: string) => levels.data?.find((s) => s.productId === pid && s.warehouseId === p.warehouseId)?.quantity ?? 0;

  return (
    <div>
      <PageHeader backTo="/purchases" title={<span className="num">{p.invoiceNumber}</span>} badge={<StatusBadge status={p.status} labelKey="purchases.status" />} subtitle={`${supplierName(p.supplierId)} · ${formatDateTime(p.date, locale)}`}
        actions={<>
          {hasPermission('purchases.pay') && p.remaining > 0 && p.status !== 'cancelled' && p.status !== 'draft' ? <Button variant="outline" onClick={() => setPayOpen(true)}><HandCoins /> {t('purchases.recordPayment')}</Button> : null}
          {hasPermission('purchases.receive') && received > 0 ? <Button variant="outline" onClick={() => { setRetQty({}); setRetMethod(''); returnKey.current = crypto.randomUUID(); setRetOpen(true); }}><Undo2 /> {t('purchases.newReturn')}</Button> : null}
          {canReceive ? <Button variant="success" onClick={() => { setRecvQty(Object.fromEntries(p.items.map((i) => [i.id, i.quantity - i.receivedQty]))); setRecvOpen(true); }}><PackageCheck /> {t('purchases.receiving')}</Button> : null}
          {hasPermission('purchases.create') && (p.status === 'draft' || p.status === 'ordered') ? <Button variant="destructive" onClick={() => setCancelOpen(true)}><Ban /> {t('common.cancel')}</Button> : null}
        </>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('common.total')} value={p.total} icon={<HandCoins />} />
        <StatCard title={t('common.paid')} value={p.paid} icon={<HandCoins />} variant="success" />
        <StatCard title={t('common.remaining')} value={p.remaining} icon={<HandCoins />} variant={p.remaining > 0 ? 'destructive' : 'success'} />
        <div className="rounded-lg border bg-card p-3.5"><div className="text-xs text-muted-foreground">{t('purchases.received')}</div><div className="mt-1 text-xl font-semibold num">{received} / {ordered}</div><Progress value={(received / ordered) * 100} className="mt-2" color="bg-success" /></div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Section title={t('common.items')}>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-center font-medium">{t('common.quantity')}</th><th className="pb-2 text-center font-medium">{t('purchases.received')}</th><th className="pb-2 text-end font-medium">{t('purchases.unitCost')}</th><th className="pb-2 text-end font-medium">{t('common.subtotal')}</th></tr></thead>
              <tbody>{p.items.map((it) => <tr key={it.id} className="border-t"><td className="py-1.5"><Link to={`/products/${it.productId}`} className="hover:underline">{productName(it.productId)}</Link><div className="text-[10px] text-muted-foreground num">{product(it.productId)?.sku}</div></td><td className="py-1.5 text-center num">{it.quantity}</td><td className="py-1.5 text-center"><span className={cn('num', it.receivedQty >= it.quantity ? 'text-success' : it.receivedQty > 0 ? 'text-amber-600' : 'text-muted-foreground')}>{it.receivedQty}</span></td><td className="py-1.5 text-end"><Money value={it.unitCost} /></td><td className="py-1.5 text-end font-medium"><Money value={it.subtotal} /></td></tr>)}</tbody>
              <tfoot className="border-t"><tr><td colSpan={4} className="pt-2 text-end text-muted-foreground">{t('common.subtotal')}</td><td className="pt-2 text-end"><Money value={p.subtotal} /></td></tr>{p.discount ? <tr><td colSpan={4} className="text-end text-muted-foreground">{t('common.discount')}</td><td className="text-end text-destructive"><Money value={-p.discount} /></td></tr> : null}<tr className="font-semibold"><td colSpan={4} className="text-end">{t('common.total')}</td><td className="text-end"><Money value={p.total} /></td></tr></tfoot>
            </table>
          </Section>
        </div>
        <Section title={t('purchases.purchaseDetails')}>
          <KeyValue cols={1} items={[{ label: t('common.supplier'), value: <Link to={`/suppliers/${p.supplierId}`} className="text-primary hover:underline">{supplierName(p.supplierId)}</Link> }, { label: t('purchases.supplierInvoice'), value: <span className="num">{p.supplierInvoiceNumber || '—'}</span> }, { label: t('common.branch'), value: branchName(p.branchId) }, { label: t('common.warehouse'), value: warehouseName(p.warehouseId) }, { label: t('common.date'), value: formatDate(p.date, locale) }, { label: t('purchases.expectedDate'), value: formatDate(p.expectedDate, locale) }, { label: t('common.user'), value: userName(p.userId) }, { label: t('common.notes'), value: p.notes || '—' }]} />
        </Section>
      </div>

      {reimbursements.data?.data.length ? <Section title={locale === 'ar' ? 'استرداد المدفوع من المورد' : 'Supplier reimbursements'}>
        {reimbursements.data.data.map(r => <div key={r.id} className="my-2 flex flex-wrap items-center gap-2 rounded border p-2 text-sm">
          <Money value={r.amount} /><span>{t(`sales.methods.${r.method}`)}</span><span>{r.status === 'received' ? (locale === 'ar' ? 'تم القبض' : 'Received') : (locale === 'ar' ? 'بانتظار القبض' : 'Awaiting receipt')}</span>
          {r.status === 'received' ? <span>{r.reference}</span> : hasPermission('purchases.pay') ? <><Input className="w-52" aria-label={locale === 'ar' ? 'مرجع القبض' : 'Receipt reference'} value={receiptReferences[r.id] ?? ''} onChange={e => setReceiptReferences(current => ({ ...current, [r.id]: e.target.value }))} /><Button disabled={receiptBusy || !receiptReferences[r.id]?.trim()} onClick={async () => {
            setReceiptBusy(true);
            try {
              const drawer = r.method === 'cash' ? await api.cash.currentSession(p.branchId) : null;
              await purchaseService.receiveReimbursement(r.id, { reference: receiptReferences[r.id].trim(), ...(drawer ? { registerSessionId: drawer.id } : {}) }, `supplier-receipt-${r.id}`);
              toast.success(locale === 'ar' ? 'تم إثبات القبض' : 'Receipt recorded'); refresh();
            } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); } finally { setReceiptBusy(false); }
          }}>{locale === 'ar' ? 'تأكيد القبض الفعلي' : 'Confirm funds received'}</Button></> : null}
        </div>)}
      </Section> : null}
      <Dialog open={recvOpen} onOpenChange={setRecvOpen}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{t('purchases.receiving')}</DialogTitle><DialogDescription>{t('purchases.receiveDesc')}</DialogDescription></DialogHeader>
          <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-center font-medium">{t('common.remaining')}</th><th className="pb-2 text-center font-medium">{t('purchases.receiveQty')}</th><th className="pb-2 text-center font-medium">{t('purchases.currentStock')}</th><th className="pb-2 text-center font-medium">{t('purchases.expectedStock')}</th></tr></thead>
            <tbody>{p.items.filter((i) => i.receivedQty < i.quantity).map((it) => { const rem = it.quantity - it.receivedQty; const rq = recvQty[it.id] ?? 0; const cur = currentStock(it.productId); return <tr key={it.id} className="border-t"><td className="py-1.5">{productName(it.productId)}</td><td className="py-1.5 text-center num">{rem}</td><td className="py-1.5 text-center"><Input type="number" min={0} max={rem} value={rq} onChange={(e) => setRecvQty((x) => ({ ...x, [it.id]: Math.min(rem, Math.max(0, Number(e.target.value))) }))} className="mx-auto h-8 w-20 text-center" dir="ltr" /></td><td className="py-1.5 text-center num text-muted-foreground">{cur}</td><td className="py-1.5 text-center num font-medium text-success">{cur + rq}</td></tr>; })}</tbody></table>
          <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setRecvQty(Object.fromEntries(p.items.map((i) => [i.id, i.quantity - i.receivedQty])))}>{t('purchases.receiveAll')}</Button></div>
          <DialogFooter><Button variant="outline" onClick={() => setRecvOpen(false)}>{t('common.cancel')}</Button><Button variant="success" disabled={!Object.values(recvQty).some((v) => v > 0)} onClick={async () => { await purchaseService.receive(p.id, recvQty, user.id); toast.success(t('purchases.receivedDone')); setRecvOpen(false); refresh(); }}><PackageCheck /> {t('purchases.confirmReceive')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={retOpen} onOpenChange={setRetOpen}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{t('purchases.newReturn')}</DialogTitle></DialogHeader>
          <Alert variant="warning">{t('sales.returnWarningDesc')}</Alert>
          <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-center font-medium">{t('purchases.received')}</th><th className="pb-2 text-center font-medium">{t('sales.returnQty')}</th><th className="pb-2 text-end font-medium">{t('common.amount')}</th></tr></thead>
            <tbody>{p.items.filter((i) => i.receivedQty > 0).map((it) => <tr key={it.id} className="border-t"><td className="py-1.5">{productName(it.productId)}</td><td className="py-1.5 text-center num">{it.receivedQty}</td><td className="py-1.5 text-center"><Input type="number" min={0} max={it.receivedQty} value={retQty[it.id] ?? 0} onChange={(e) => setRetQty((x) => ({ ...x, [it.id]: Math.min(it.receivedQty, Math.max(0, Number(e.target.value))) }))} className="mx-auto h-8 w-20 text-center" dir="ltr" /></td><td className="py-1.5 text-end"><Money value={p.subtotal > 0 ? (retQty[it.id] ?? 0) * it.unitCost * p.total / p.subtotal : 0} /></td></tr>)}</tbody></table>
          <Input value={retReason} onChange={(e) => setRetReason(e.target.value)} placeholder={t('common.reason')} />
          <label className="flex items-center gap-2 text-sm">{locale === 'ar' ? 'طريقة استرداد المدفوع من المورد (بعد إلغاء الدين)' : 'Supplier reimbursement method (after reducing debt)'}<select value={retMethod} onChange={e => setRetMethod(e.target.value as typeof retMethod)} className="rounded border bg-background p-2"><option value="">{locale === 'ar' ? 'اختر عند وجود مبلغ مسترد' : 'Choose for a paid-value refund'}</option>{(['cash', 'card', 'bank_transfer'] as const).map(method => <option key={method} value={method}>{t(`sales.methods.${method}`)}</option>)}</select></label>
          <DialogFooter><Button variant="outline" onClick={() => setRetOpen(false)}>{t('common.cancel')}</Button><Button variant="warning" disabled={returnBusy || !Object.values(retQty).some((v) => v > 0) || !retReason} onClick={async () => { setReturnBusy(true); try { await purchaseService.createReturn({ purchaseId: p.id, items: p.items.filter((i) => (retQty[i.id] ?? 0) > 0).map((i) => ({ productId: i.productId, purchaseItemId: i.id, quantity: retQty[i.id], unitCost: i.unitCost })), reason: retReason, refundMethod: retMethod || undefined, userId: user.id }, returnKey.current); toast.success(t('purchases.returnCreated')); setRetOpen(false); refresh(); } catch (error) { toast.error(error instanceof Error ? error.message : String(error)); } finally { setReturnBusy(false); } }}><Undo2 /> {t('common.confirm')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <SupplierPaymentDialog open={payOpen} onOpenChange={setPayOpen} supplierId={p.supplierId} purchaseId={p.id} onDone={refresh} />
      <ConfirmDialog open={cancelOpen} onOpenChange={setCancelOpen} title={t('common.cancel')} description={t('common.irreversible')} variant="destructive" onConfirm={async () => { if (p.paid > 0 && !cancelMethod) { toast.error(locale === 'ar' ? 'اختر طريقة استرداد المدفوع' : 'Choose a reimbursement method'); throw new Error('REFUND_METHOD_REQUIRED'); } await purchaseService.cancel(p.id, { refundMethod: cancelMethod || undefined }); toast.success(t('common.cancelled')); refresh(); }}>
        {p.paid > 0 ? <label className="text-sm">{locale === 'ar' ? 'طريقة استرداد المدفوع من المورد' : 'Supplier reimbursement method'}<select aria-label={locale === 'ar' ? 'طريقة استرداد المدفوع من المورد' : 'Supplier reimbursement method'} value={cancelMethod} onChange={e => setCancelMethod(e.target.value as typeof cancelMethod)} className="ml-2 rounded border bg-background p-2"><option value="">{locale === 'ar' ? 'اختر الطريقة' : 'Choose method'}</option>{(['cash', 'card', 'bank_transfer'] as const).map(method => <option key={method} value={method}>{t(`sales.methods.${method}`)}</option>)}</select></label> : null}
      </ConfirmDialog>
    </div>
  );
}
