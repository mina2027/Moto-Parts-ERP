import * as React from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Lock } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { Money } from '@/components/shared/page';
import { FormField } from '@/components/shared/form';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { cn, formatMoney, round2 } from '@/lib/utils';
import type { RegisterSession } from '@/types';

const DENOMS = [200, 100, 50, 20, 10, 5, 1];

export function CloseRegisterDialog({ session, open, onOpenChange, onClosed }: { session: RegisterSession; open: boolean; onOpenChange: (o: boolean) => void; onClosed?: (id: string) => void }) {
  const { t, locale } = useT();
  const user = useAuthStore((s) => s.session!.user);
  const [counts, setCounts] = React.useState<Record<number, string>>({});
  const [manual, setManual] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const counted = round2(DENOMS.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0));
  const actual = manual !== '' ? Number(manual) : counted;
  const diff = round2(actual - session.expectedCash);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{t('cash.closeRegister')}</DialogTitle><DialogDescription>{t('cash.confirmCloseDesc')}</DialogDescription></DialogHeader>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-md border p-3 text-sm">
            <div className="text-xs font-semibold text-muted-foreground">{t('cash.closingReport')}</div>
            {[['cash.openingBalance', session.openingBalance], ['cash.cashSales', session.cashSales], ['cash.paymentsIn', session.paymentsIn], ['cash.paymentsOut', -session.paymentsOut], ['cash.expenses', -session.expenses], ['cash.refunds', -session.refunds]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between"><span className="text-muted-foreground">{t(k as string)}</span><Money value={v as number} colored={(v as number) < 0} /></div>
            ))}
            <div className="flex justify-between border-t pt-2 font-semibold"><span>{t('cash.expectedCash')}</span><Money value={session.expectedCash} /></div>
            <div className="mt-2 border-t pt-2 text-xs text-muted-foreground"><div className="flex justify-between"><span>{t('cash.cardSales')}</span><Money value={session.cardSales} /></div><div className="flex justify-between"><span>{t('cash.transferSales')}</span><Money value={session.transferSales} /></div></div>
          </div>
          <div className="space-y-3">
            <div className="rounded-md border p-3">
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{t('cash.denominations')}</div>
              <div className="grid grid-cols-2 gap-1.5" dir="ltr">
                {DENOMS.map((d) => <div key={d} className="flex items-center gap-1"><span className="w-10 text-end text-xs num font-medium">{d}</span><span className="text-xs text-muted-foreground">×</span><Input type="number" min={0} value={counts[d] ?? ''} onChange={(e) => { setCounts((c) => ({ ...c, [d]: e.target.value })); setManual(''); }} className="h-7 w-16 text-center" placeholder="0" /></div>)}
              </div>
              <div className="mt-2 flex justify-between border-t pt-2 text-sm"><span className="text-muted-foreground">{t('cash.totalCounted')}</span><Money value={counted} className="font-semibold" /></div>
            </div>
            <FormField label={`${t('cash.actualCash')} (${t('common.optional')})`}><Input type="number" value={manual} onChange={(e) => setManual(e.target.value)} placeholder={String(counted)} dir="ltr" /></FormField>
          </div>
        </div>
        <div className={cn('flex items-center justify-between rounded-md border p-3', diff === 0 ? 'border-success/40 bg-success/5' : diff < 0 ? 'border-destructive/40 bg-destructive/5' : 'border-warning/40 bg-warning/5')}>
          <div><div className="text-xs text-muted-foreground">{t('cash.difference')}</div><div className={cn('text-xl font-bold num', diff === 0 ? 'text-success' : diff < 0 ? 'text-destructive' : 'text-amber-600')}>{diff === 0 ? t('cash.balanced') : `${diff < 0 ? t('cash.shortage') : t('cash.overage')}: ${formatMoney(Math.abs(diff), locale)}`}</div></div>
          <div className="text-end text-sm"><div className="text-xs text-muted-foreground">{t('cash.actualCash')}</div><Money value={actual} className="font-semibold" /></div>
        </div>
        {diff !== 0 ? <Alert variant={diff < 0 ? 'destructive' : 'warning'} icon={<AlertTriangle />}>{diff < 0 ? t('cash.shortage') : t('cash.overage')} — {t('common.notes')} {t('common.required')}</Alert> : null}
        <FormField label={t('common.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="destructive" loading={busy} disabled={diff !== 0 && !notes.trim()} onClick={async () => { setBusy(true); try { await branchService.closeSession(session.id, actual, user.id, notes); toast.success(t('cash.registerClosed')); onOpenChange(false); onClosed?.(session.id); } finally { setBusy(false); } }}><Lock /> {t('cash.confirmClose')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
