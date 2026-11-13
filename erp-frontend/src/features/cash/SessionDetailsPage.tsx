import * as React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { CloseRegisterDialog } from './CloseRegisterDialog';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

export default function SessionDetailsPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const canClose = useAuthStore((s) => s.hasPermission('cash.close'));
  const { registerName, branchName, userName } = useLookups();
  const [closeOpen, setCloseOpen] = React.useState(false);
  const q = useQuery({ queryKey: ['session', id], queryFn: () => branchService.getSession(id) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const s = q.data;
  const d = s.difference;
  const rows: [string, number, boolean?][] = [['cash.openingBalance', s.openingBalance], ['cash.cashSales', s.cashSales], ['cash.paymentsIn', s.paymentsIn], ['cash.paymentsOut', -s.paymentsOut, true], ['cash.expenses', -s.expenses, true], ['cash.refunds', -s.refunds, true]];

  return (
    <div>
      <PageHeader backTo="/cash-registers" title={`${registerName(s.registerId)} — ${t('cash.sessionDetails')}`} badge={<StatusBadge status={s.status} labelKey="cash.status" />} subtitle={`${branchName(s.branchId)} · ${userName(s.userId)} · ${formatDateTime(s.openedAt, locale)}`}
        actions={<><Button variant="outline" onClick={() => window.print()}><Printer /> {t('cash.closingReport')}</Button>{s.status === 'open' && canClose ? <Button variant="destructive" onClick={() => setCloseOpen(true)}><Lock /> {t('cash.closeRegister')}</Button> : null}</>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('cash.expectedCash')} value={s.expectedCash} />
        <StatCard title={t('cash.actualCash')} value={s.actualCash ?? '—'} variant="info" />
        <div className={cn('rounded-lg border bg-card p-3.5', d != null && d !== 0 && (d < 0 ? 'border-destructive/50' : 'border-warning/50'))}><div className="text-xs text-muted-foreground">{t('cash.difference')}</div><div className={cn('mt-1 text-xl font-semibold num', d == null ? '' : d === 0 ? 'text-success' : d < 0 ? 'text-destructive' : 'text-amber-600')}>{d == null ? '—' : d === 0 ? t('cash.balanced') : formatMoney(d, locale)}</div>{d != null && d !== 0 ? <Badge variant={d < 0 ? 'destructive' : 'warning'} className="mt-1">{d < 0 ? t('cash.shortage') : t('cash.overage')}</Badge> : null}</div>
        <StatCard title={t('cash.cardSales')} value={s.cardSales + s.transferSales} variant="warning" hint={`${t('cash.cardSales')}: ${formatMoney(s.cardSales, locale)} · ${t('cash.transferSales')}: ${formatMoney(s.transferSales, locale)}`} />
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Section title={t('cash.closingReport')} className="print-area">
          <div className="space-y-1.5 text-sm">{rows.map(([k, v, neg]) => <div key={k} className="flex justify-between"><span className="text-muted-foreground">{t(k)}</span><Money value={v} className={neg && v !== 0 ? 'text-destructive' : ''} /></div>)}<div className="flex justify-between border-t pt-2 font-semibold"><span>{t('cash.expectedCash')}</span><Money value={s.expectedCash} /></div>{s.actualCash != null ? <><div className="flex justify-between"><span className="text-muted-foreground">{t('cash.actualCash')}</span><Money value={s.actualCash} /></div><div className={cn('flex justify-between font-semibold', d === 0 ? 'text-success' : d! < 0 ? 'text-destructive' : 'text-amber-600')}><span>{t('cash.difference')}</span><Money value={d!} /></div></> : null}</div>
          <div className="mt-4 border-t pt-3"><KeyValue cols={1} items={[{ label: t('cash.openedBy'), value: userName(s.userId) }, { label: t('cash.openedAt'), value: formatDateTime(s.openedAt, locale) }, { label: t('cash.closedAt'), value: s.closedAt ? formatDateTime(s.closedAt, locale) : '—' }, { label: t('common.notes'), value: s.notes || '—' }]} /></div>
        </Section>
        <Section title={t('cash.movements')} className="lg:col-span-2">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.time')}</th><th className="pb-2 text-start font-medium">{t('common.type')}</th><th className="pb-2 text-start font-medium">{t('common.reference')}</th><th className="pb-2 text-start font-medium">{t('common.paymentMethod')}</th><th className="pb-2 text-start font-medium">{t('common.notes')}</th><th className="pb-2 text-end font-medium">{t('common.amount')}</th></tr></thead>
            <tbody>{[...s.movements].sort((a, b) => (a.date < b.date ? 1 : -1)).map((m) => { const neg = ['expense', 'withdrawal', 'payment_out', 'refund'].includes(m.type); return <tr key={m.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(m.date, locale)}</td><td className="py-1.5"><StatusBadge status={neg ? 'decrease' : 'increase'} label={t(`cash.types.${m.type}`)} /></td><td className="py-1.5 num text-xs">{m.reference}</td><td className="py-1.5 text-xs">{t(`sales.methods.${m.method}`)}</td><td className="py-1.5 text-xs text-muted-foreground">{m.notes ?? '—'}</td><td className={cn('py-1.5 text-end font-medium', neg ? 'text-destructive' : 'text-success')}><Money value={neg ? -m.amount : m.amount} /></td></tr>; })}</tbody>
          </table>
        </Section>
      </div>
      {closeOpen ? <CloseRegisterDialog session={s} open onOpenChange={setCloseOpen} onClosed={() => { q.refetch(); qc.invalidateQueries({ queryKey: ['sessions'] }); qc.invalidateQueries({ queryKey: ['registers'] }); }} /> : null}
    </div>
  );
}
