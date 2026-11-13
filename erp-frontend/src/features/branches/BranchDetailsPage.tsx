import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Boxes, Monitor, Pencil, Receipt, ReceiptText, TrendingUp, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/misc';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ChartCard, SalesProfitChart } from '@/components/shared/charts';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { BranchFormDialog } from './BranchesPage';
import { branchService, inventoryService, reportService, salesService } from '@/services';
import { presetRange } from '@/services/reportService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/utils';

export default function BranchDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { userName, registerName, warehouses: allWarehouses, registers: allRegisters, users: allUsers } = useLookups();
  const [editOpen, setEditOpen] = React.useState(false);
  const range = React.useMemo(() => presetRange('month'), []);
  const b = useQuery({ queryKey: ['branch', id], queryFn: () => branchService.get(id) });
  const perf = useQuery({ queryKey: ['branches', 'performance'], queryFn: branchService.performance });
  const dash = useQuery({ queryKey: ['dashboard', range.from, range.to, id], queryFn: () => reportService.dashboard({ ...range, branchId: id }) });
  const sales = useQuery({ queryKey: ['sales', { branchId: id, recent: true }], queryFn: () => salesService.list({ branchId: id, pageSize: 10 }) });
  const inv = useQuery({ queryKey: ['inventory', 'overview', id], queryFn: () => inventoryService.overview(id) });
  const expenses = useQuery({ queryKey: ['expenses', { branchId: id }], queryFn: () => branchService.expenses({ branchId: id, pageSize: 10 }) });
  if (b.isLoading) return <PageLoading />;
  if (b.isError || !b.data) return <ErrorState onRetry={() => b.refetch()} />;
  const br = b.data;
  const p = perf.data?.find((x) => x.branch.id === id);
  const warehouses = allWarehouses.filter((w) => w.branchId === id);
  const registers = allRegisters.filter((r) => r.branchId === id);
  const employees = allUsers.filter((u) => u.branchId === id);
  const canFinancial = hasPermission('reports.financial');

  return (
    <div>
      <PageHeader backTo="/branches" title={tx(br.name)} badge={<StatusBadge status={br.isActive ? 'active' : 'inactive'} label={br.isActive ? t('common.active') : t('common.inactive')} />} subtitle={`${br.code} · ${tx(br.city)} · ${br.phone}`} actions={hasPermission('branches.edit') ? <Button onClick={() => setEditOpen(true)}><Pencil /> {t('common.edit')}</Button> : undefined} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('branches.salesThisMonth')} value={p?.revenue ?? 0} icon={<Receipt />} hint={`${p?.invoices ?? 0} ${t('dashboard.invoices')}`} />
        {canFinancial ? <StatCard title={t('branches.profitThisMonth')} value={p?.net ?? 0} icon={<TrendingUp />} variant="success" /> : null}
        <StatCard title={t('branches.expenses')} value={p?.expenses ?? 0} icon={<ReceiptText />} variant="warning" />
        <StatCard title={t('branches.inventory')} value={p?.inventory ?? 0} icon={<Boxes />} variant="info" hint={`${inv.data?.lowCount ?? 0} ${t('inventory.lowStock')} · ${inv.data?.outCount ?? 0} ${t('inventory.outOfStock')}`} />
      </div>
      <Tabs defaultValue="overview" className="mt-4">
        <TabsList variant="underline"><TabsTrigger variant="underline" value="overview">{t('common.overview')}</TabsTrigger><TabsTrigger variant="underline" value="performance">{t('branches.performance')}</TabsTrigger><TabsTrigger variant="underline" value="sales">{t('branches.sales')}</TabsTrigger><TabsTrigger variant="underline" value="expenses">{t('branches.expenses')}</TabsTrigger><TabsTrigger variant="underline" value="people">{t('branches.employees')}</TabsTrigger></TabsList>
        <TabsContent value="overview">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('branches.branchDetails')} className="lg:col-span-2"><KeyValue cols={2} items={[{ label: t('common.code'), value: br.code }, { label: t('branches.manager'), value: <Link to={`/users/${br.managerId}`} className="text-primary hover:underline">{userName(br.managerId)}</Link> }, { label: t('common.nameAr'), value: br.name.ar }, { label: t('common.nameEn'), value: br.name.en }, { label: t('branches.city'), value: tx(br.city) }, { label: t('common.phone'), value: <span className="num">{br.phone}</span> }, { label: t('common.address'), value: tx(br.address) }, { label: t('branches.openedAt'), value: formatDate(br.openedAt, locale) }]} /></Section>
            <div className="space-y-3">
              <Section title={t('branches.warehouses')}>{warehouses.map((w) => <Link key={w.id} to={`/warehouses/${w.id}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"><Warehouse className="size-4 text-muted-foreground" /><span className="flex-1">{tx(w.name)}</span><span className="text-xs text-muted-foreground">{w.code}</span></Link>)}</Section>
              <Section title={t('branches.posTerminals')}>{registers.map((r) => <div key={r.id} className="flex items-center gap-2 px-2 py-1.5 text-sm"><Monitor className="size-4 text-muted-foreground" /><span className="flex-1">{registerName(r.id)}</span><StatusBadge status={r.currentSessionId ? 'open' : r.isActive ? 'closed' : 'inactive'} label={r.currentSessionId ? t('cash.status.open') : r.isActive ? t('cash.status.closed') : t('common.inactive')} /></div>)}</Section>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="performance">
          <ChartCard title={`${t('dashboard.salesAndProfit')} — ${t('common.thisMonth')}`}>{dash.data ? <SalesProfitChart data={dash.data.salesSeries} keys={canFinancial ? ['sales', 'profit', 'expenses'] : ['sales']} height={300} /> : <div className="h-72" />}</ChartCard>
        </TabsContent>
        <TabsContent value="sales">
          <Section title={t('dashboard.recentSales')} actions={<Button size="sm" variant="outline" asChild><Link to="/sales">{t('dashboard.viewAll')}</Link></Button>}>{sales.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoiceNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.cashier')}</th><th className="pb-2 text-end font-medium">{t('common.total')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead><tbody>{sales.data.data.map((s) => <tr key={s.id} className="border-t"><td className="py-1.5"><Link to={`/sales/${s.id}`} className="num text-primary hover:underline">{s.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDateTime(s.date, locale)}</td><td className="py-1.5 text-xs">{userName(s.cashierId)}</td><td className="py-1.5 text-end"><Money value={s.total} /></td><td className="py-1.5"><StatusBadge status={s.status} labelKey="sales.status" /></td></tr>)}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>
        <TabsContent value="expenses">
          <Section title={t('branches.expenses')}>{expenses.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.description')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-end font-medium">{t('common.amount')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead><tbody>{expenses.data.data.map((e) => <tr key={e.id} className="border-t"><td className="py-1.5 num text-xs">{formatDate(e.date, locale)}</td><td className="py-1.5">{tx(e.description)}</td><td className="py-1.5 text-xs">{userName(e.userId)}</td><td className="py-1.5 text-end"><Money value={e.amount} /></td><td className="py-1.5"><StatusBadge status={e.status} labelKey="expenses.status" /></td></tr>)}</tbody></table> : <EmptyState />}</Section>
        </TabsContent>
        <TabsContent value="people">
          <Section title={t('branches.employees')}><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{employees.map((u) => <Link key={u.id} to={`/users/${u.id}`} className="flex items-center gap-2 rounded-md border p-2 hover:bg-accent"><Avatar name={tx(u.fullName)} color={u.avatarColor} size="sm" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{tx(u.fullName)}</div><div className="text-xs text-muted-foreground">{t(`roles.${u.role}`)}</div></div><StatusBadge status={u.status} labelKey="users.status" /></Link>)}</div></Section>
        </TabsContent>
      </Tabs>
      <BranchFormDialog open={editOpen} onOpenChange={setEditOpen} branch={br} onSaved={() => b.refetch()} />
    </div>
  );
}
