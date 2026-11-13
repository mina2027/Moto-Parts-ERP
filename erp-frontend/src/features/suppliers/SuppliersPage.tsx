import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Truck, Wallet, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { FormGrid, TextField } from '@/components/shared/form';
import { supplierService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { columnsToExport } from '@/lib/tableExport';
import type { Supplier } from '@/types';

export function SupplierFormDialog({ open, onOpenChange, supplier, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; supplier?: Supplier | null; onSaved?: () => void }) {
  const { t } = useT();
  const qc = useQueryClient();
  const schema = z.object({ nameAr: z.string().min(2, t('validation.required')), nameEn: z.string().optional(), contactAr: z.string().optional(), contactEn: z.string().optional(), phone: z.string().min(7, t('validation.phone')).or(z.literal('')), email: z.string().email(t('validation.email')).or(z.literal('')), addressAr: z.string().optional(), addressEn: z.string().optional(), paymentTermsDays: z.coerce.number().int().min(0) });
  type F = z.infer<typeof schema>;
  const form = useForm<F>({ resolver: zodResolver(schema), defaultValues: { nameAr: '', nameEn: '', contactAr: '', contactEn: '', phone: '', email: '', addressAr: '', addressEn: '', paymentTermsDays: 30 } });
  React.useEffect(() => { if (open) form.reset(supplier ? { nameAr: supplier.name.ar, nameEn: supplier.name.en, contactAr: supplier.contactPerson.ar, contactEn: supplier.contactPerson.en, phone: supplier.phone, email: supplier.email, addressAr: supplier.address.ar, addressEn: supplier.address.en, paymentTermsDays: supplier.paymentTermsDays } : { nameAr: '', nameEn: '', contactAr: '', contactEn: '', phone: '', email: '', addressAr: '', addressEn: '', paymentTermsDays: 30 }); }, [open, supplier, form]);
  const submit = form.handleSubmit(async (v) => { await supplierService.save({ id: supplier?.id, name: { ar: v.nameAr, en: v.nameEn }, contactPerson: { ar: v.contactAr ?? '', en: v.contactEn ?? '' }, phone: v.phone, email: v.email, address: { ar: v.addressAr ?? '', en: v.addressEn ?? '' }, paymentTermsDays: v.paymentTermsDays, isActive: supplier?.isActive ?? true }); toast.success(t('common.saved')); qc.invalidateQueries({ queryKey: ['suppliers'] }); qc.invalidateQueries({ queryKey: ['supplier'] }); onSaved?.(); onOpenChange(false); });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>{supplier ? t('common.edit') : t('suppliers.addSupplier')}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <FormGrid><TextField control={form.control} name="nameAr" label={t('common.nameAr')} required /><TextField control={form.control} name="nameEn" label={t('common.nameEn')} dir="ltr" /><TextField control={form.control} name="contactAr" label={`${t('suppliers.contactPerson')} (AR)`} /><TextField control={form.control} name="contactEn" label={`${t('suppliers.contactPerson')} (EN)`} dir="ltr" /><TextField control={form.control} name="phone" label={t('common.phone')} dir="ltr" /><TextField control={form.control} name="email" label={t('common.email')} dir="ltr" /><TextField control={form.control} name="addressAr" label={`${t('common.address')} (AR)`} /><TextField control={form.control} name="addressEn" label={`${t('common.address')} (EN)`} dir="ltr" /><TextField control={form.control} name="paymentTermsDays" type="number" label={`${t('suppliers.paymentTerms')} (${t('common.days')})`} dir="ltr" /></FormGrid>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button><Button type="submit" loading={form.formState.isSubmitting}>{t('common.save')}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function SuppliersPage() {
  const { t, tx } = useT();
  const navigate = useNavigate();
  const ls = useListState();
  const canEdit = useAuthStore((s) => s.hasPermission('suppliers.edit'));
  const [formOpen, setFormOpen] = React.useState(false);
  const suppliersQuery = { ...ls.query, hasBalance: ls.filters.hasBalance === 'yes' };
  const q = useQuery({ queryKey: ['suppliers', ls.query], queryFn: () => supplierService.list(suppliersQuery) });
  const debt = useQuery({ queryKey: ['suppliers', 'debt'], queryFn: supplierService.debtOverview });

  const columns = React.useMemo<ColumnDef<Supplier, unknown>[]>(() => [
    { accessorKey: 'code', header: t('common.code'), cell: ({ row }) => <span className="num text-xs text-muted-foreground">{row.original.code}</span>, size: 80 },
    { id: 'name', header: t('common.name'), cell: ({ row }) => <div><div className="font-medium">{tx(row.original.name)}</div><div className="text-xs text-muted-foreground">{tx(row.original.contactPerson)}</div></div> },
    { accessorKey: 'phone', header: t('common.phone'), cell: ({ row }) => <span className="num text-xs">{row.original.phone}</span> },
    { accessorKey: 'email', header: t('common.email'), cell: ({ row }) => <span className="text-xs" dir="ltr">{row.original.email || '—'}</span> },
    { accessorKey: 'paymentTermsDays', header: t('suppliers.paymentTerms'), cell: ({ row }) => <span className="num text-xs">{row.original.paymentTermsDays} {t('suppliers.daysTerm')}</span>, meta: { align: 'center' } },
    { accessorKey: 'balance', header: t('suppliers.balance'), cell: ({ row }) => <Money value={row.original.balance} className={`font-medium ${row.original.balance > 0 ? 'text-destructive' : ''}`} />, meta: { align: 'end' } },
    { accessorKey: 'isActive', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'active' : 'inactive'} label={row.original.isActive ? t('common.active') : t('common.inactive')} /> },
  ], [t, tx]);

  const exportPayload = async () => {
    const full = await supplierService.list({ ...suppliersQuery, page: 1, pageSize: 500 });
    return {
      filename: 'suppliers',
      title: t('suppliers.title'),
      columns: columnsToExport(columns),
      rows: full.data,
      meta: [
        { label: t('common.branch'), value: t('common.allBranches') },
        ...(ls.search ? [{ label: t('common.search'), value: ls.search }] : []),
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('suppliers.title')} subtitle={t('suppliers.subtitle')} actions={<><ExportMenu payload={exportPayload} />{canEdit ? <Button onClick={() => setFormOpen(true)}><Plus /> {t('suppliers.addSupplier')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <StatCard title={t('suppliers.totalPayable')} value={debt.data?.totalPayable ?? 0} icon={<Wallet />} variant="destructive" />
        <StatCard title={t('suppliers.suppliersCount')} value={q.data?.total ?? 0} format="number" icon={<Truck />} hint={`${debt.data?.count ?? 0} ${t('suppliers.weOwe')}`} />
        <StatCard title={t('suppliers.topSupplier')} value={debt.data?.top[0] ? tx(debt.data.top[0].name) : '—'} icon={<Crown />} variant="warning" hint={debt.data?.top[0] ? <Money value={debt.data.top[0].balance} /> : undefined} />
      </div>
      <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} sorting={ls.sorting} onSortingChange={ls.setSorting} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(s) => navigate(`/suppliers/${s.id}`)} getRowId={(s) => s.id} enableColumnVisibility
        toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterSelect value={ls.filters.hasBalance} onChange={(v) => ls.setFilter('hasBalance', v)} options={[{ value: 'yes', label: t('suppliers.weOwe') }]} allLabel={t('common.all')} width="w-36" /></>} />
      <SupplierFormDialog open={formOpen} onOpenChange={setFormOpen} onSaved={() => q.refetch()} />
    </div>
  );
}
