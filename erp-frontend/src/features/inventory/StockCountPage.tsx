import * as React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/misc';
import { KeyValue, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime } from '@/lib/utils';

export default function StockCountPage() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const canCount = useAuthStore((s) => s.hasPermission('inventory.count'));
  const { branchName, warehouseName, userName, productName, product } = useLookups();
  const [confirm, setConfirm] = React.useState(false);
  const q = useQuery({ queryKey: ['inventory', 'count', id], queryFn: () => inventoryService.getCount(id) });
  if (q.isLoading) return <PageLoading />;
  if (q.isError || !q.data) return <ErrorState onRetry={() => q.refetch()} />;
  const c = q.data;
  const done = c.items.filter((i) => i.counted != null).length;
  const variances = c.items.filter((i) => i.counted != null && i.counted !== i.expected);
  const editable = c.status !== 'completed' && canCount;

  return (
    <div>
      <PageHeader backTo="/inventory?tab=counts" title={<span className="num">{c.code}</span>} badge={<StatusBadge status={c.status} label={c.status === 'draft' ? t('common.draft') : c.status === 'in_progress' ? t('common.pending') : t('common.completed')} />} subtitle={`${branchName(c.branchId)} · ${warehouseName(c.warehouseId)} · ${formatDateTime(c.date, locale)}`}
        actions={editable ? <Button onClick={() => setConfirm(true)} disabled={done !== c.items.length}><ClipboardCheck /> {t('inventory.finishCount')}</Button> : null} />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title={t('common.items')} value={`${done} / ${c.items.length}`} icon={<ClipboardCheck />} />
        <StatCard title={t('inventory.variance')} value={variances.length} format="number" icon={<ClipboardCheck />} variant={variances.length ? 'warning' : 'success'} />
        <div className="rounded-lg border bg-card p-3.5"><div className="text-xs text-muted-foreground">{t('inventory.countSheet')}</div><Progress value={(done / c.items.length) * 100} className="mt-3" /><div className="mt-1 text-[11px] text-muted-foreground num">{Math.round((done / c.items.length) * 100)}%</div></div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <Section title={t('inventory.countSheet')} className="lg:col-span-3">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">#</th><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-start font-medium">{t('common.sku')}</th><th className="pb-2 text-end font-medium">{t('inventory.expectedQty')}</th><th className="pb-2 text-center font-medium">{t('inventory.countedQty')}</th><th className="pb-2 text-end font-medium">{t('inventory.variance')}</th></tr></thead>
            <tbody>
              {c.items.map((it, i) => { const v = it.counted != null ? it.counted - it.expected : null; return (
                <tr key={it.productId} className={cn('border-t', v != null && v !== 0 && 'bg-warning/5')}>
                  <td className="py-1.5 text-xs text-muted-foreground">{i + 1}</td>
                  <td className="py-1.5">{productName(it.productId)}</td>
                  <td className="py-1.5 num text-xs text-muted-foreground">{product(it.productId)?.sku}</td>
                  <td className="py-1.5 text-end num">{c.status === 'completed' || !editable ? it.expected : <span className="text-muted-foreground">•••</span>}</td>
                  <td className="py-1.5 text-center">{editable ? <Input type="number" min={0} value={it.counted ?? ''} placeholder="—" onChange={async (e) => { const val = e.target.value === '' ? null : Number(e.target.value); await inventoryService.updateCountItem(c.id, it.productId, val); q.refetch(); }} className="mx-auto h-8 w-24 text-center" dir="ltr" /> : <span className="num">{it.counted ?? '—'}</span>}</td>
                  <td className={cn('py-1.5 text-end num font-medium', v == null ? 'text-muted-foreground' : v === 0 ? 'text-success' : 'text-destructive')}>{v == null ? '—' : v === 0 ? <CheckCircle2 className="ms-auto size-4" /> : v > 0 ? `+${v}` : v}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </Section>
        <Section title={t('common.details')}>
          <KeyValue cols={1} items={[{ label: t('common.branch'), value: branchName(c.branchId) }, { label: t('common.warehouse'), value: warehouseName(c.warehouseId) }, { label: t('common.user'), value: userName(c.userId) }, { label: t('common.date'), value: formatDateTime(c.date, locale) }]} />
        </Section>
      </div>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t('inventory.finishCount')} description={t('inventory.adjustmentWarning')} variant="warning" onConfirm={async () => { await inventoryService.finishCount(c.id, user.id); toast.success(t('inventory.countCompleted')); q.refetch(); qc.invalidateQueries({ queryKey: ['inventory'] }); qc.invalidateQueries({ queryKey: ['products'] }); }}>
        <div className="text-sm">{t('inventory.variance')}: <b className="num">{variances.length}</b> · {t('common.items')}: <b className="num">{done}</b></div>
      </ConfirmDialog>
    </div>
  );
}
