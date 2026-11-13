import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, CircleAlert, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { reportService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { cn, timeAgo } from '@/lib/utils';

/** Collapsible top bar under the header showing the latest unresolved alerts; hidden when none. */
export function NotificationBar() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const enabled = useAuthStore((s) => s.status === 'authenticated');
  const [collapsed, setCollapsed] = React.useState(() => localStorage.getItem('moto-alertbar-collapsed') === '1');
  const summary = useQuery({ queryKey: ['alerts', 'summary'], queryFn: reportService.alertSummary, enabled, refetchInterval: 60_000 });
  const resolve = useMutation({ mutationFn: (id: string) => reportService.resolveAlert(id), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }) });
  const latest = summary.data?.latest ?? [];
  if (!latest.length) return null;
  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('moto-alertbar-collapsed', next ? '1' : '0');
  };
  const critical = summary.data?.critical ?? 0;
  return (
    <div className={cn('border-b text-sm', critical ? 'bg-destructive/5' : 'bg-warning/5')}>
      <div className="flex items-center gap-2 px-3 py-1.5">
        <CircleAlert className={cn('size-4 shrink-0', critical ? 'text-destructive' : 'text-amber-600')} />
        <span className="font-medium">{t('upgrade.alerts')}</span>
        {critical ? <Badge variant="destructive" className="num">{critical} {t('upgrade.critical')}</Badge> : null}
        {summary.data?.unread ? <Badge variant="outline" className="num">{summary.data.unread} {t('upgrade.unread')}</Badge> : null}
        {collapsed ? <span className="truncate text-muted-foreground">· {tx(latest[0]!.title)}</span> : null}
        <span className="ms-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" asChild><Link to="/alerts">{t('upgrade.viewAll')}</Link></Button>
          <Button size="icon-xs" variant="ghost" onClick={toggle} aria-label={collapsed ? t('common.view') : t('common.close')}>{collapsed ? <ChevronDown /> : <ChevronUp />}</Button>
        </span>
      </div>
      {!collapsed ? (
        <ul className="divide-y border-t">
          {latest.map((a) => (
            <li key={a.id} className="flex items-center gap-2 px-3 py-1.5">
              <span className={cn('size-2 shrink-0 rounded-full', a.severity === 'critical' ? 'bg-destructive' : a.severity === 'warning' ? 'bg-amber-500' : 'bg-sky-500')} />
              <button type="button" className="min-w-0 flex-1 truncate text-start hover:underline" onClick={() => a.link && navigate(a.link)}>
                <span className="font-medium">{tx(a.title)}</span> <span className="text-muted-foreground">— {tx(a.body)}</span>
              </button>
              <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(a.createdAt, locale)}</span>
              <Button size="icon-xs" variant="ghost" onClick={() => resolve.mutate(a.id)} aria-label={t('upgrade.resolve')}><X className="size-3.5" /></Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
