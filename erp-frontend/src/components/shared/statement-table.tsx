import { Money } from './page';
import { StatusBadge } from './status-badge';
import { EmptyState } from './states';
import { useT } from '@/i18n';
import { formatDate } from '@/lib/utils';
import type { StatementLine } from '@/types';

export function StatementTable({ lines, debitLabel, creditLabel }: { lines: StatementLine[]; debitLabel?: string; creditLabel?: string }) {
  const { t, locale } = useT();
  if (!lines.length) return <EmptyState />;
  const typeLabel: Record<StatementLine['type'], string> = { invoice: t('common.invoice'), payment: t('debts.paid'), return: t('nav.returns'), opening: t('customers.openingBalance') };
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/60 text-xs text-muted-foreground">
          <tr><th className="px-3 py-2 text-start font-medium">{t('common.date')}</th><th className="px-3 py-2 text-start font-medium">{t('common.type')}</th><th className="px-3 py-2 text-start font-medium">{t('common.reference')}</th><th className="px-3 py-2 text-end font-medium">{debitLabel ?? t('suppliers.debit')}</th><th className="px-3 py-2 text-end font-medium">{creditLabel ?? t('suppliers.creditCol')}</th><th className="px-3 py-2 text-end font-medium">{t('common.balance')}</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5 num text-xs">{formatDate(l.date, locale)}</td>
              <td className="px-3 py-1.5"><StatusBadge status={l.type === 'invoice' ? 'open' : l.type === 'payment' ? 'paid' : 'returned'} label={typeLabel[l.type]} /></td>
              <td className="px-3 py-1.5 num text-xs">{l.reference}</td>
              <td className="px-3 py-1.5 text-end">{l.debit ? <Money value={l.debit} /> : '—'}</td>
              <td className="px-3 py-1.5 text-end">{l.credit ? <Money value={l.credit} /> : '—'}</td>
              <td className="px-3 py-1.5 text-end font-medium"><Money value={l.balance} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
