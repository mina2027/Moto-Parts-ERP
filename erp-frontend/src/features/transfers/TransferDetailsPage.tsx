import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeftRight, Check, CheckCircle2, Circle, PackageCheck, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { KeyValue, PageHeader, Section } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime } from '@/lib/utils';
import type { TransferStatus } from '@/types';

const FLOW: TransferStatus[] = ['draft', 'requested', 'approved', 'sent', 'received', 'completed'];

export default function TransferDetailsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName, warehouseName, userName, productName, product } = useLookups();
  const [action, setAction] = React.useState<{ next: TransferStatus; title: string; desc: string; variant: 'default' | 'destructive' | 'warning' | 'success' } | null>(null);
  const [qty, setQty] = React.useState<Record<string, number>>({});
  const q = useQuery({ queryKey: ['transfer', id], queryFn: () => inventoryService.getTransfer(id) });
  const srcWh = q.data?.sourceWarehouseId;
  const levels = useQuery({ queryKey: ['inventory', 'levels', { warehouseId: srcWh }], queryFn: () => inventoryService.levels({ warehouseId: srcWh }), enabled: !!srcWh });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const tr = q.data;
  const idx = FLOW.indexOf(tr.status);
  const canSource = hasPermission('branches.all') || user.branchId === tr.sourceBranchId;
  const canDestination = hasPermission('branches.all') || user.branchId === tr.destinationBranchId;
  const canApprove = canSource && hasPermission('inventory.transfer_approve');
  const run = async () => {
    if (!action) return;
    await inventoryService.advanceTransfer(tr.id, action.next, user.id, undefined, action.next === 'sent' || action.next === 'received' ? qty : undefined);
    toast.success(t('transfers.statusUpdated'));
    q.refetch(); qc.invalidateQueries({ queryKey: ['transfers'] }); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['products'] });
  };
  const open = (next: TransferStatus, title: string, desc: string, variant: 'default' | 'destructive' | 'warning' | 'success' = 'default') => { setQty(Object.fromEntries(tr.items.map((i) => [i.productId, next === 'sent' ? i.requestedQty : i.sentQty]))); setAction({ next, title, desc, variant }); };
  const srcStock = (pid: string) => levels.data?.find((s) => s.productId === pid && s.warehouseId === tr.sourceWarehouseId)?.quantity ?? 0;

  return (
    <div>
      <PageHeader backTo="/transfers" title={<span className="num">{tr.code}</span>} badge={<StatusBadge status={tr.status} labelKey="transfers.status" />} subtitle={<span className="flex items-center gap-1.5">{branchName(tr.sourceBranchId)} <ArrowLeftRight className="size-3.5" /> {branchName(tr.destinationBranchId)}</span>}
        actions={<>
          {tr.status === 'draft' ? <Button onClick={() => open('requested', t('transfers.actions.submit'), '')}><Send /> {t('transfers.actions.submit')}</Button> : null}
          {tr.status === 'requested' && canApprove ? <><Button variant="destructive" onClick={() => open('rejected', t('transfers.confirmReject'), '', 'destructive')}><X /> {t('transfers.actions.reject')}</Button><Button variant="success" onClick={() => open('approved', t('transfers.confirmApprove'), t('transfers.confirmApproveDesc'), 'success')}><Check /> {t('transfers.actions.approve')}</Button></> : null}
          {tr.status === 'approved' && canSource ? <Button onClick={() => open('sent', t('transfers.confirmSend'), t('transfers.confirmSendDesc'), 'warning')}><Send /> {t('transfers.actions.send')}</Button> : null}
          {tr.status === 'sent' && canDestination ? <Button variant="success" onClick={() => open('received', t('transfers.confirmReceive'), t('transfers.confirmReceiveDesc'), 'success')}><PackageCheck /> {t('transfers.actions.receive')}</Button> : null}
          {tr.status === 'received' && canDestination ? <Button onClick={() => open('completed', t('transfers.actions.complete'), '')}><CheckCircle2 /> {t('transfers.actions.complete')}</Button> : null}
        </>} />

      <Section title={t('transfers.workflow')} className="mb-3">
        <ol className="flex items-center gap-0 overflow-x-auto">
          {FLOW.map((s, i) => { const done = tr.status === 'rejected' ? i <= 1 : i <= idx; const current = i === idx && tr.status !== 'completed'; return (
            <li key={s} className="flex flex-1 items-center min-w-24">
              <div className="flex flex-col items-center gap-1 text-center">
                <div className={cn('flex size-8 items-center justify-center rounded-full border-2 text-xs', done ? 'border-primary bg-primary text-white' : 'border-border text-muted-foreground', current && 'ring-4 ring-primary/20')}>{done && !current ? <Check className="size-4" /> : i + 1}</div>
                <span className={cn('text-[11px] whitespace-nowrap', done ? 'font-medium' : 'text-muted-foreground')}>{t(`transfers.status.${s}`)}</span>
              </div>
              {i < FLOW.length - 1 ? <div className={cn('mx-1 h-0.5 flex-1', i < idx ? 'bg-primary' : 'bg-border')} /> : null}
            </li>
          ); })}
          {tr.status === 'rejected' ? <li className="ms-2 flex items-center gap-1 text-destructive"><Circle className="size-3 fill-current" /> <span className="text-xs font-medium">{t('transfers.status.rejected')}</span></li> : null}
        </ol>
      </Section>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Section title={t('common.items')}>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-center font-medium">{t('inventory.available')} ({t('transfers.source')})</th><th className="pb-2 text-center font-medium">{t('transfers.requestedQty')}</th><th className="pb-2 text-center font-medium">{t('transfers.sentQty')}</th><th className="pb-2 text-center font-medium">{t('transfers.receivedQty')}</th></tr></thead>
              <tbody>{tr.items.map((i) => { const p = product(i.productId); const diff = i.receivedQty && i.sentQty && i.receivedQty !== i.sentQty; return <tr key={i.productId} className={cn('border-t', diff && 'bg-warning/5')}><td className="py-1.5"><Link to={`/products/${i.productId}`} className="hover:underline">{productName(i.productId)}</Link><div className="text-[10px] text-muted-foreground num">{p?.sku}</div></td><td className={cn('py-1.5 text-center num', srcStock(i.productId) < i.requestedQty && idx < 3 ? 'text-destructive font-medium' : 'text-muted-foreground')}>{srcStock(i.productId)}</td><td className="py-1.5 text-center num font-medium">{i.requestedQty}</td><td className="py-1.5 text-center num">{idx >= 3 ? i.sentQty : '—'}</td><td className={cn('py-1.5 text-center num', diff && 'text-amber-600 font-medium')}>{idx >= 4 ? i.receivedQty : '—'}</td></tr>; })}</tbody>
            </table>
          </Section>
          <Section title={t('common.timeline')}>
            <ol className="relative ms-3 border-s">
              {tr.timeline.map((e, i) => <li key={i} className="mb-4 ms-5"><span className="absolute -start-1.5 mt-1 flex size-3 items-center justify-center rounded-full border bg-primary" /><div className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge status={e.status} labelKey="transfers.status" /><span className="text-xs text-muted-foreground">{formatDateTime(e.at, locale)} · {userName(e.by)}</span></div>{e.note ? <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p> : null}</li>)}
            </ol>
          </Section>
        </div>
        <Section title={t('transfers.transferDetails')}>
          <KeyValue cols={1} items={[
            { label: t('transfers.source'), value: `${branchName(tr.sourceBranchId)} — ${warehouseName(tr.sourceWarehouseId)}` }, { label: t('transfers.destination'), value: `${branchName(tr.destinationBranchId)} — ${warehouseName(tr.destinationWarehouseId)}` },
            { label: t('transfers.requestDate'), value: formatDateTime(tr.requestedAt, locale) }, { label: t('transfers.requestedBy'), value: userName(tr.requestedBy) },
            { label: t('transfers.approvedBy'), value: tr.approvedBy ? `${userName(tr.approvedBy)} · ${formatDateTime(tr.approvedAt, locale)}` : '—' }, { label: t('transfers.sentDate'), value: tr.sentAt ? `${formatDateTime(tr.sentAt, locale)} · ${userName(tr.sentBy)}` : '—' },
            { label: t('transfers.receivedDate'), value: tr.receivedAt ? `${formatDateTime(tr.receivedAt, locale)} · ${userName(tr.receivedBy)}` : '—' }, { label: t('common.notes'), value: tr.notes || '—' },
          ]} />
        </Section>
      </div>

      <ConfirmDialog open={!!action} onOpenChange={(o) => !o && setAction(null)} title={action?.title ?? ''} description={action?.desc} variant={action?.variant} onConfirm={run}>
        {action && (action.next === 'sent' || action.next === 'received') ? (
          <div className="max-h-60 overflow-auto rounded-md border"><table className="w-full text-xs"><thead className="bg-muted"><tr><th className="px-2 py-1.5 text-start font-medium">{t('common.product')}</th><th className="px-2 py-1.5 text-center font-medium">{action.next === 'sent' ? t('transfers.requestedQty') : t('transfers.sentQty')}</th><th className="px-2 py-1.5 text-center font-medium">{action.next === 'sent' ? t('transfers.sentQty') : t('transfers.receivedQty')}</th></tr></thead>
            <tbody>{tr.items.map((i) => <tr key={i.productId} className="border-t"><td className="px-2 py-1">{productName(i.productId)}</td><td className="px-2 py-1 text-center num">{action.next === 'sent' ? i.requestedQty : i.sentQty}</td><td className="px-2 py-1 text-center"><Input type="number" min={0} max={action.next === 'sent' ? i.requestedQty : i.sentQty} value={qty[i.productId] ?? 0} onChange={(e) => setQty((x) => ({ ...x, [i.productId]: Number(e.target.value) }))} className="mx-auto h-7 w-20 text-center" dir="ltr" /></td></tr>)}</tbody></table></div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
