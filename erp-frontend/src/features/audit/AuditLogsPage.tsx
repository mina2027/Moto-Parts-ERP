import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { DataTable, useListState } from '@/components/shared/data-table';
import { DateRangeInputs, ExportMenu, FilterBar, FilterSelect, KeyValue, PageHeader, SearchInput } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { reportService } from '@/services';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDateTime } from '@/lib/utils';
import type { AuditAction, AuditLog } from '@/types';

const ACTIONS: AuditAction[] = ['login', 'logout', 'price_change', 'invoice_cancel', 'sale_create', 'sale_return', 'stock_adjustment', 'purchase_create', 'payment', 'user_create', 'user_update', 'permission_change', 'transfer_create', 'transfer_approve', 'register_close', 'settings_change', 'barcode_regenerate', 'terminal_register', 'product_create', 'product_update', 'product_delete', 'category_change', 'customer_update', 'supplier_update', 'whatsapp_send'];
const actionVariant = (a: AuditAction) => (['login', 'logout'].includes(a) ? 'closed' : ['invoice_cancel', 'sale_return'].includes(a) ? 'overdue' : ['price_change', 'permission_change', 'settings_change', 'user_update'].includes(a) ? 'partial' : 'open');

function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const { t } = useT();
  const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
  if (!keys.length) return <div className="text-xs text-muted-foreground">{t('audit.noChanges')}</div>;
  return (
    <table className="w-full text-xs"><thead className="text-muted-foreground"><tr><th className="pb-1 text-start font-medium">{t('pricing.field')}</th><th className="pb-1 text-start font-medium">{t('common.before')}</th><th className="pb-1 text-start font-medium">{t('common.after')}</th></tr></thead>
      <tbody>{keys.map((k) => { const b = before?.[k]; const a = after?.[k]; const changed = JSON.stringify(b) !== JSON.stringify(a); return <tr key={k} className="border-t"><td className="py-1 font-mono">{k}</td><td className={`py-1 font-mono ${changed && b !== undefined ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'}`}>{b === undefined ? '—' : JSON.stringify(b)}</td><td className={`py-1 font-mono ${changed && a !== undefined ? 'bg-success/10 text-success' : ''}`}>{a === undefined ? '—' : JSON.stringify(a)}</td></tr>; })}</tbody></table>
  );
}

export default function AuditLogsPage() {
  const { t, tx, locale } = useT();
  const ls = useListState({ pageSize: 30 });
  const { users, userName, branchName, options } = useLookups();
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();
  const [sel, setSel] = React.useState<AuditLog | null>(null);
  const auditQuery = { ...ls.query, userId: ls.filters.userId, action: ls.filters.action as AuditAction | undefined, entity: ls.filters.entity, branchId: ls.filters.branchId, from, to };
  const q = useQuery({ queryKey: ['audit', ls.query, from, to], queryFn: () => reportService.auditLogs(auditQuery) });
  const entities = Array.from(new Set((q.data?.data ?? []).map((l) => l.entity)));

  const columns = React.useMemo<ColumnDef<AuditLog, unknown>[]>(() => [
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'user', header: t('common.user'), cell: ({ row }) => { const u = users.find((x) => x.id === row.original.userId); return <div className="flex items-center gap-2">{u ? <Avatar name={tx(u.fullName)} color={u.avatarColor} size="xs" /> : null}<span className="text-xs">{userName(row.original.userId)}</span></div>; } },
    { accessorKey: 'action', header: t('audit.action'), cell: ({ row }) => <StatusBadge status={actionVariant(row.original.action)} label={t(`audit.actions.${row.original.action}`)} /> },
    { accessorKey: 'entity', header: t('audit.entity'), cell: ({ row }) => <span className="font-mono text-xs">{row.original.entity}</span> },
    { accessorKey: 'entityId', header: t('audit.entityId'), cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.entityId}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'before', header: t('audit.beforeValue'), cell: ({ row }) => <span className="line-clamp-1 max-w-48 font-mono text-[10px] text-muted-foreground">{row.original.before ? JSON.stringify(row.original.before) : '—'}</span> },
    { id: 'after', header: t('audit.afterValue'), cell: ({ row }) => <span className="line-clamp-1 max-w-48 font-mono text-[10px]">{row.original.after ? JSON.stringify(row.original.after) : '—'}</span> },
    { accessorKey: 'ip', header: t('audit.ip'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.ip}</span> },
  ], [t, tx, locale, users, userName, branchName]);

  const exportPayload = async () => {
    const full = await reportService.auditLogs({ ...auditQuery, page: 1, pageSize: 500 });
    return {
      filename: 'audit-log',
      title: t('audit.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.date'), value: from || to ? `${from ? formatDateTime(from, locale) : '…'} – ${to ? formatDateTime(to, locale) : '…'}` : t('common.all') },
        { label: t('common.branch'), value: ls.filters.branchId ? branchName(ls.filters.branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('audit.title')} subtitle={t('audit.subtitle')} actions={<ExportMenu payload={exportPayload} />} />
      <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={setSel} getRowId={(l) => l.id} dense enableColumnVisibility
        toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount + (from || to ? 1 : 0)} onClear={() => { ls.clearFilters(); setFrom(undefined); setTo(undefined); }}><DateRangeInputs from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /><FilterSelect value={ls.filters.userId} onChange={(v) => ls.setFilter('userId', v)} options={options.users} allLabel={t('common.user')} /><FilterSelect value={ls.filters.action} onChange={(v) => ls.setFilter('action', v)} options={ACTIONS.map((a) => ({ value: a, label: t(`audit.actions.${a}`) }))} allLabel={t('audit.action')} /><FilterSelect value={ls.filters.entity} onChange={(v) => ls.setFilter('entity', v)} options={entities.map((e) => ({ value: e, label: e }))} allLabel={t('audit.entity')} width="w-36" /><FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /></FilterBar></>} />
      <Sheet open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <SheetContent>
          {sel ? (<>
            <SheetHeader><SheetTitle>{t('audit.logDetails')}</SheetTitle><SheetDescription>{formatDateTime(sel.date, locale)}</SheetDescription></SheetHeader>
            <div className="mt-4 space-y-4">
              <KeyValue cols={2} items={[{ label: t('common.user'), value: userName(sel.userId) }, { label: t('audit.action'), value: <StatusBadge status={actionVariant(sel.action)} label={t(`audit.actions.${sel.action}`)} /> }, { label: t('audit.entity'), value: <span className="font-mono">{sel.entity}</span> }, { label: t('audit.entityId'), value: <span className="font-mono">{sel.entityId}</span> }, { label: t('common.branch'), value: branchName(sel.branchId) }, { label: t('audit.ip'), value: <span className="num">{sel.ip}</span> }]} />
              <div><div className="mb-2 text-xs font-semibold text-muted-foreground">{t('audit.changes')}</div><div className="rounded-md border p-2"><Diff before={sel.before} after={sel.after} /></div></div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setSel(null)}>{t('common.close')}</Button>
            </div>
          </>) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
