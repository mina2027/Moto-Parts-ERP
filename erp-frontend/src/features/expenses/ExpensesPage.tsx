import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Check, Clock, Plus, ReceiptText, TrendingUp, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, useListState } from '@/components/shared/data-table';
import { DateRangeInputs, ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { FormGrid, SelectField, TextField } from '@/components/shared/form';
import { ChartCard, DonutChart, NamedBarChart } from '@/components/shared/charts';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import { formatDateTime } from '@/lib/utils';
import type { Expense } from '@/types';

export default function ExpensesPage() {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const ls = useListState();
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const currentBranch = user.branchId;
  const { branchName, userName, expenseCategoryName, registerName, options } = useLookups();
  const [addOpen, setAddOpen] = React.useState(false);
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();
  const branchId = canAll ? ls.filters.branchId : currentBranch;
  const expensesQuery = { ...ls.query, branchId, categoryId: ls.filters.categoryId, status: ls.filters.status as Expense['status'] | undefined, from, to };
  const q = useQuery({ queryKey: ['expenses', ls.query, branchId, from, to], queryFn: () => branchService.expenses(expensesQuery) });
  const stats = useQuery({ queryKey: ['expenses', 'stats', branchId], queryFn: () => branchService.expenseStats(branchId) });

  const schema = z.object({ categoryId: z.string().min(1, t('validation.required')), amount: z.coerce.number().positive(t('validation.positive')), branchId: z.string().min(1), registerId: z.string().optional(), descAr: z.string().optional(), descEn: z.string().optional(), receiptRef: z.string().optional() });
  type F = z.infer<typeof schema>;
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { categoryId: '', amount: 0, branchId: currentBranch, registerId: 'none', descAr: '', descEn: '', receiptRef: '' } });
  const formBranch = form.watch('branchId');
  const regs = useQuery({ queryKey: ['registers', formBranch], queryFn: () => branchService.registers(formBranch) });
  React.useEffect(() => { form.setValue('registerId', 'none'); }, [formBranch, form]);
  const submit = form.handleSubmit(async (v) => {
    await branchService.createExpense({ categoryId: v.categoryId, amount: v.amount, branchId: v.branchId, registerId: v.registerId && v.registerId !== 'none' ? v.registerId : null, description: { ar: v.descAr ?? '', en: v.descEn || v.descAr }, userId: user.id, receiptRef: v.receiptRef });
    toast.success(t('expenses.expenseAdded'));
    qc.invalidateQueries({ queryKey: ['expenses'] }); qc.invalidateQueries({ queryKey: ['sessions'] }); qc.invalidateQueries({ queryKey: ['pos', 'session'] });
    setAddOpen(false); form.reset();
  });
  const setStatus = async (id: string, status: Expense['status']) => { await branchService.setExpenseStatus(id, status); toast.success(t('common.updated')); q.refetch(); stats.refetch(); qc.invalidateQueries({ queryKey: ['sessions'] }); qc.invalidateQueries({ queryKey: ['pos', 'session'] }); };

  const columns = React.useMemo<ColumnDef<Expense, unknown>[]>(() => [
    { accessorKey: 'code', header: t('common.code'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.code}</span> },
    { accessorKey: 'date', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.date, locale)}</span> },
    { id: 'category', header: t('expenses.category'), cell: ({ row }) => <StatusBadge status="open" label={expenseCategoryName(row.original.categoryId)} /> },
    { id: 'desc', header: t('common.description'), cell: ({ row }) => <div><div>{tx(row.original.description)}</div>{row.original.receiptRef ? <div className="text-[10px] text-muted-foreground num">{t('expenses.receiptRef')}: {row.original.receiptRef}</div> : null}</div> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'register', header: t('expenses.register'), cell: ({ row }) => <span className="text-xs">{row.original.registerId ? registerName(row.original.registerId) : '—'}</span> },
    { id: 'user', header: t('common.user'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { accessorKey: 'amount', header: t('common.amount'), cell: ({ row }) => <Money value={row.original.amount} className="font-semibold" />, meta: { align: 'end' } },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <div className="flex items-center gap-1"><StatusBadge status={row.original.status} labelKey="expenses.status" />{row.original.status === 'pending' && hasPermission('expenses.approve') ? <><Button size="icon-xs" variant="ghost" className="text-success" onClick={() => setStatus(row.original.id, 'approved')}><Check /></Button><Button size="icon-xs" variant="ghost" className="text-destructive" onClick={() => setStatus(row.original.id, 'rejected')}><X /></Button></> : null}</div> },
  ], [t, tx, locale, expenseCategoryName, branchName, registerName, userName, hasPermission]);  

  const exportPayload = async () => {
    const full = await branchService.expenses({ ...expensesQuery, page: 1, pageSize: 500 });
    return {
      filename: 'expenses',
      title: t('expenses.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.date'), value: from || to ? `${from ? formatDateTime(from, locale) : '…'} – ${to ? formatDateTime(to, locale) : '…'}` : t('common.all') },
        { label: t('common.branch'), value: branchId ? branchName(branchId) : t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('expenses.title')} subtitle={t('expenses.subtitle')} actions={<><ExportMenu payload={exportPayload} />{hasPermission('expenses.create') ? <Button onClick={() => setAddOpen(true)}><Plus /> {t('expenses.addExpense')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard title={t('expenses.totalExpenses')} value={stats.data?.total ?? 0} icon={<ReceiptText />} variant="destructive" />
        <StatCard title={t('common.thisMonth')} value={stats.data?.thisMonth ?? 0} icon={<TrendingUp />} variant="warning" />
        <StatCard title={t('expenses.pendingApproval')} value={stats.data?.pending ?? 0} format="number" icon={<Clock />} variant="info" onClick={() => ls.setFilter('status', 'pending')} />
      </div>
      <Tabs defaultValue="list">
        <TabsList><TabsTrigger value="list">{t('expenses.title')}</TabsTrigger><TabsTrigger value="report">{t('expenses.report')}</TabsTrigger></TabsList>
        <TabsContent value="list">
          <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} getRowId={(e) => e.id} dense enableColumnVisibility
            toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount + (from || to ? 1 : 0)} onClear={() => { ls.clearFilters(); setFrom(undefined); setTo(undefined); }}><DateRangeInputs from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt); }} /><FilterSelect value={ls.filters.categoryId} onChange={(v) => ls.setFilter('categoryId', v)} options={options.expenseCategories} allLabel={t('expenses.category')} />{canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}<FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['pending', 'approved', 'rejected'] as const).map((s) => ({ value: s, label: t(`expenses.status.${s}`) }))} allLabel={t('common.status')} width="w-32" /></FilterBar></>} />
        </TabsContent>
        <TabsContent value="report">
          <div className="grid gap-3 lg:grid-cols-2">
            <ChartCard title={t('expenses.byCategory')}><DonutChart data={stats.data?.byCategory ?? []} height={220} /></ChartCard>
            <ChartCard title={t('expenses.byBranch')}><NamedBarChart data={stats.data?.byBranch ?? []} height={240} /></ChartCard>
          </div>
        </TabsContent>
      </Tabs>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent size="md">
          <DialogHeader><DialogTitle>{t('expenses.addExpense')}</DialogTitle></DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <FormGrid><SelectField control={form.control} name="categoryId" label={t('expenses.category')} options={options.expenseCategories} required /><TextField control={form.control} name="amount" type="number" label={t('common.amount')} required dir="ltr" />{canAll ? <SelectField control={form.control} name="branchId" label={t('common.branch')} options={options.activeBranches} /> : null}<SelectField control={form.control} name="registerId" label={t('expenses.register')} options={[{ value: 'none', label: t('common.none') }, ...(regs.data ?? []).filter((r) => r.currentSessionId).map((r) => ({ value: r.id, label: tx(r.name) }))]} hint={t('common.optional')} /></FormGrid>
            <TextField control={form.control} name="descAr" label={`${t('common.description')} (AR)`} />
            <TextField control={form.control} name="descEn" label={`${t('common.description')} (EN)`} dir="ltr" />
            <TextField control={form.control} name="receiptRef" label={t('expenses.receiptRef')} dir="ltr" />
            <DialogFooter><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
