import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/misc';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { UserFormDialog } from './UserFormDialog';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDateTime, timeAgo } from '@/lib/utils';
import type { RoleKey, User } from '@/types';

const ROLES: RoleKey[] = ['admin', 'branch_manager', 'accountant', 'cashier', 'sales', 'warehouse'];

export default function UsersPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const ls = useListState();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName, options } = useLookups();
  const [addOpen, setAddOpen] = React.useState(false);
  const usersQuery = { ...ls.query, role: ls.filters.role as RoleKey | undefined, status: ls.filters.status as User['status'] | undefined, branchId: ls.filters.branchId };
  const q = useQuery({ queryKey: ['users', ls.query], queryFn: () => branchService.users(usersQuery) });
  const all = useQuery({ queryKey: ['users', 'all'], queryFn: branchService.allUsers });

  const columns = React.useMemo<ColumnDef<User, unknown>[]>(() => [
    { id: 'name', header: t('users.fullName'), cell: ({ row }) => <div className="flex items-center gap-2"><Avatar name={tx(row.original.fullName)} color={row.original.avatarColor} size="sm" /><div><div className="font-medium">{tx(row.original.fullName)}</div><div className="text-[11px] text-muted-foreground" dir="ltr">@{row.original.username}</div></div></div> },
    { accessorKey: 'role', header: t('users.role'), cell: ({ row }) => <StatusBadge status={row.original.role === 'admin' ? 'purple' : 'open'} label={t(`roles.${row.original.role}`)} /> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { accessorKey: 'email', header: t('common.email'), cell: ({ row }) => <span className="text-xs" dir="ltr">{row.original.email}</span> },
    { accessorKey: 'phone', header: t('common.phone'), cell: ({ row }) => <span className="num text-xs">{row.original.phone}</span> },
    { accessorKey: 'lastLogin', header: t('common.lastLogin'), cell: ({ row }) => <span className="text-xs text-muted-foreground" title={row.original.lastLogin ? formatDateTime(row.original.lastLogin, locale) : ''}>{row.original.lastLogin ? timeAgo(row.original.lastLogin, locale) : t('common.never')}</span> },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="users.status" /> },
  ], [t, tx, locale, branchName]);

  const exportPayload = async () => {
    const full = await branchService.users({ ...usersQuery, page: 1, pageSize: 500 });
    return {
      filename: 'users',
      title: t('users.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.branch'), value: ls.filters.branchId ? branchName(ls.filters.branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('users.title')} subtitle={t('users.subtitle')} actions={<><ExportMenu payload={exportPayload} />{hasPermission('users.roles') ? <Button variant="outline" asChild><Link to="/roles"><ShieldCheck /> {t('users.rolesTitle')}</Link></Button> : null}{hasPermission('users.edit') ? <Button onClick={() => setAddOpen(true)}><Plus /> {t('users.addUser')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard title={t('users.title')} value={all.data?.length ?? 0} format="number" icon={<Users />} />
        <StatCard title={t('users.status.active')} value={all.data?.filter((u) => u.status === 'active').length ?? 0} format="number" icon={<UserCheck />} variant="success" />
        <StatCard title={`${t('users.status.inactive')} / ${t('users.status.suspended')}`} value={all.data?.filter((u) => u.status !== 'active').length ?? 0} format="number" icon={<UserX />} variant="warning" />
      </div>
      <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(u) => navigate(`/users/${u.id}`)} getRowId={(u) => u.id} enableColumnVisibility
        toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}><FilterSelect value={ls.filters.role} onChange={(v) => ls.setFilter('role', v)} options={ROLES.map((r) => ({ value: r, label: t(`roles.${r}`) }))} allLabel={t('users.role')} width="w-36" /><FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /><FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['active', 'inactive', 'suspended'] as const).map((s) => ({ value: s, label: t(`users.status.${s}`) }))} allLabel={t('common.status')} width="w-32" /></FilterBar></>} />
      <UserFormDialog open={addOpen} onOpenChange={setAddOpen} onSaved={() => q.refetch()} />
    </div>
  );
}
