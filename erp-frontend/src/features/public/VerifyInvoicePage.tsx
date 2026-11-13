import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, FileSearch, ShieldX } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { salesService } from '@/services';
import { useT } from '@/i18n';
import { formatDateTime, formatMoney } from '@/lib/utils';

/** Public, unauthenticated invoice verification page reached from the invoice QR code. */
export default function VerifyInvoicePage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const q = useQuery({ queryKey: ['verify', id], queryFn: () => salesService.verify(id), retry: false });
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="p-6 text-center">
          {q.isLoading ? (
            <FileSearch className="mx-auto size-10 animate-pulse text-muted-foreground" />
          ) : q.isError || !q.data ? (
            <>
              <ShieldX className="mx-auto size-12 text-destructive" />
              <h1 className="mt-3 text-lg font-semibold">{t('upgrade.verifyNotFound')}</h1>
            </>
          ) : (
            <>
              <BadgeCheck className="mx-auto size-12 text-success" />
              <h1 className="mt-3 text-lg font-semibold">{t('upgrade.verifyValid')}</h1>
              <div className="mt-4 space-y-2 text-start text-sm">
                <Row label={t('upgrade.seller')} value={tx(q.data.sellerName)} />
                <Row label={t('upgrade.taxNumber')} value={q.data.taxNumber} mono />
                <Row label={t('common.invoiceNumber')} value={q.data.invoiceNumber} mono />
                <Row label={t('common.date')} value={formatDateTime(q.data.date, locale)} mono />
                <Row label={t('common.total')} value={formatMoney(q.data.total, locale)} mono strong />
                <Row label={t('common.tax')} value={formatMoney(q.data.tax, locale)} mono />
                <Row label={t('common.status')} value={t(`sales.status.${q.data.status}`)} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b pb-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? 'num' : ''} ${strong ? 'text-base font-semibold' : ''}`}>{value}</span>
    </div>
  );
}
