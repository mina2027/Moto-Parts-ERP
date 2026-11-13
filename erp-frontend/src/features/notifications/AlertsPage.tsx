import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { BellRing, Check, CheckCheck, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataTable, useListState } from '@/components/shared/data-table';
import { FilterBar, FilterSelect, PageHeader, StatCard } from '@/components/shared/page';
import { reportService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime } from '@/lib/utils';
import { ALERT_TYPES } from '@moto/shared';
import type { Alert } from '@/types';

export const severityIcon = { critical: CircleAlert, warning: TriangleAlert, info: Info } as const;
export const severityVariant = { critical: 'destructive', warning: 'warning', info: 'info' } as const;

export default function AlertsPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ls = useListState({ pageSize: 25 });
  const userId = useAuthStore((s) => s.session!.user.id);
  const { branchName } = useLookups();
  const resolved = ls.filters.status === 'resolved';
  const q = useQuery({ queryKey: ['alerts', ls.query, ls.filters], queryFn: () => reportService.alerts({ ...ls.query, severity: ls.filters.severity, type: ls.filters.type, resolved, unread: ls.filters.status === 'unread' ? true : undefined }) });
  const summary = useQuery({ queryKey: ['alerts', 'summary'], queryFn: reportService.alertSummary });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['alerts'] });
  const read = useMutation({ mutationFn: (id: string) => reportService.readAlert(id), onSuccess: invalidate });
  const resolve = useMutation({ mutationFn: (id: string) => reportService.resolveAlert(id), onSuccess: invalidate });
  const readAll = useMutation({ mutationFn: () => reportService.readAllAlerts(), onSuccess: invalidate });

  const columns = React.useMemo<ColumnDef<Alert, unknown>[]>(() => [
    { id: 'severity', header: '', size: 40, cell: ({ row }) => { const Icon = severityIcon[row.original.severity]; return <Icon className={cn('size-4', row.original.severity === 'critical' ? 'text-destructive' : row.original.severity === 'warning' ? 'text-amber-600' : 'text-sky-600')} />; } },
    { id: 'title', header: t('common.description'), cell: ({ row }) => <div className={cn(!row.original.readBy.includes(userId) && 'font-semibold')}><div>{tx(row.original.title)}</div><div className="text-xs text-muted-foreground">{tx(row.original.body)}</div></div> },
    { accessorKey: 'type', header: t('common.type'), cell: ({ row }) => <Badge variant={severityVariant[row.original.severity]}>{t(`upgrade.alertType.${row.original.type}`)}</Badge> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{row.original.branchId ? branchName(row.original.branchId) : t('common.allBranches')}</span> },
    { accessorKey: 'createdAt', header: t('common.date'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{formatDateTime(row.original.createdAt, locale)}</span> },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          {row.original.link ? <Button size="xs" variant="ghost" onClick={() => navigate(row.original.link!)}>{t('common.view')}</Button> : null}
          {!row.original.readBy.includes(userId) ? <Button size="xs" variant="ghost" title={t('upgrade.markRead')} onClick={() => read.mutate(row.original.id)}><Check /></Button> : null}
          {!row.original.resolvedAt ? <Button size="xs" variant="outline" onClick={() => resolve.mutate(row.original.id)}><CheckCheck /> {t('upgrade.resolve')}</Button> : <Badge variant="outline">{t('upgrade.resolved')}</Badge>}
        </div>
      ),
    },
  ], [t, tx, locale, userId, branchName, navigate, read, resolve]);

  return (
    <div>
      <PageHeader title={t('upgrade.alertsCenter')} actions={<Button variant="outline" onClick={() => readAll.mutate()} loading={readAll.isPending}><CheckCheck /> {t('upgrade.markAllRead')}</Button>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard title={t('upgrade.unread')} value={summary.data?.unread ?? 0} format="number" icon={<BellRing />} />
        <StatCard title={t('upgrade.critical')} value={summary.data?.critical ?? 0} format="number" icon={<CircleAlert />} variant="destructive" />
        <StatCard title={t('common.total')} value={q.data?.total ?? 0} format="number" icon={<Info />} variant="info" />
      </div>
      <DataTable
        columns={columns}
        data={q.data?.data ?? []}
        total={q.data?.total}
        page={ls.page}
        pageSize={ls.pageSize}
        onPageChange={ls.setPage}
        onPageSizeChange={ls.setPageSize}
        isLoading={q.isLoading}
        isError={q.isError}
        onRetry={q.refetch}
        getRowId={(a) => a.id}
        dense
        toolbar={
          <FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}>
            <FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={[{ value: 'unread', label: t('upgrade.unread') }, { value: 'resolved', label: t('upgrade.resolved') }]} allLabel={t('common.status')} width="w-36" />
            <FilterSelect value={ls.filters.severity} onChange={(v) => ls.setFilter('severity', v)} options={[{ value: 'critical', label: t('upgrade.critical') }, { value: 'warning', label: t('upgrade.warning') }, { value: 'info', label: t('upgrade.info') }]} allLabel={t('upgrade.critical')} width="w-32" />
            <FilterSelect value={ls.filters.type} onChange={(v) => ls.setFilter('type', v)} options={ALERT_TYPES.map((ty) => ({ value: ty, label: t(`upgrade.alertType.${ty}`) }))} allLabel={t('common.type')} width="w-48" />
          </FilterBar>
        }
      />
    </div>
  );
}
