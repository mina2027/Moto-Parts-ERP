import { Badge, type BadgeProps } from '@/components/ui/badge';
import { useT } from '@/i18n';

type Variant = NonNullable<BadgeProps['variant']>;

const map: Record<string, Variant> = {
  // generic
  active: 'success', inactive: 'muted', suspended: 'destructive', pending: 'warning', approved: 'success', rejected: 'destructive', completed: 'success', cancelled: 'destructive', draft: 'muted', open: 'info', closed: 'muted',
  // sales
  held: 'warning', returned: 'destructive', partially_returned: 'warning',
  // purchases
  ordered: 'info', partially_received: 'warning', received: 'success',
  // transfers
  requested: 'info', sent: 'purple',
  // debts
  partial: 'warning', paid: 'success', overdue: 'destructive',
  // stock
  in: 'success', low: 'warning', out: 'destructive',
  // whatsapp
  queued: 'muted', delivered: 'info', read: 'success', failed: 'destructive',
  // misc
  in_progress: 'info', cash: 'success', credit: 'warning', card: 'info', bank_transfer: 'purple', mixed: 'secondary',
  retail: 'secondary', wholesale: 'info', workshop: 'purple', synced: 'success',
  increase: 'success', decrease: 'destructive',
};

export function StatusBadge({ status, labelKey, label, className }: { status: string; labelKey?: string; label?: string; className?: string }) {
  const { t } = useT();
  const text = label ?? (labelKey ? t(`${labelKey}.${status}`) : status);
  return (
    <Badge variant={map[status] ?? 'secondary'} dot className={className}>
      {text}
    </Badge>
  );
}

export function StockBadge({ qty, min }: { qty: number; min: number }) {
  const { t } = useT();
  const status = qty === 0 ? 'out' : qty < min ? 'low' : 'in';
  const label = status === 'out' ? t('products.outOfStock') : status === 'low' ? t('products.lowStock') : t('products.inStock');
  return <StatusBadge status={status} label={label} />;
}
