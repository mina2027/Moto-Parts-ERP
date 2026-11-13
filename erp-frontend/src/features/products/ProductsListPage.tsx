import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Barcode as BarcodeIcon, Package, Plus, Power, PowerOff, AlertTriangle, PackageX, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable, useListState } from '@/components/shared/data-table';
import { ExportMenu, FilterBar, FilterSelect, Money, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge, StockBadge } from '@/components/shared/status-badge';
import { ProductFormDialog } from './ProductFormDialog';
import { productService } from '@/services';
import type { ProductWithStock, ProductQuery } from '@/services/productService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { productCategoryIds, stockStatusOf } from '@moto/shared';
import { exportXlsx, type ExportPayload } from '@/lib/export';

export default function ProductsListPage() {
  const { t, tx } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ls = useListState({ pageSize: 25 });
  const { brandName, categoryName, options } = useLookups();
  const { settings } = useSettings();
  const tierLabels = settings.pricing.tierLabels;
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCost = hasPermission('prices.view_cost');
  const canEdit = hasPermission('inventory.adjust') || hasPermission('prices.edit') || hasPermission('settings.edit');
  const canAll = hasPermission('branches.all');
  const userBranchId = useAuthStore((s) => s.session!.user.branchId);
  const branchId = canAll ? ls.filters.branchId : userBranchId;
  const [formOpen, setFormOpen] = React.useState(false);
  const [selection, setSelection] = React.useState<Record<string, boolean>>({});

  const query: ProductQuery = { ...ls.query, categoryId: ls.filters.categoryId, brandId: ls.filters.brandId, supplierId: ls.filters.supplierId, stockStatus: ls.filters.stockStatus as ProductQuery['stockStatus'], isActive: ls.filters.isActive === undefined ? undefined : ls.filters.isActive === 'true', branchId };
  const q = useQuery({ queryKey: ['products', query], queryFn: () => productService.list(query) });
  const all = useQuery({ queryKey: ['products', 'all'], queryFn: () => productService.all() });

  const kpis = React.useMemo(() => {
    const a = all.data ?? [];
    const scoped = query.branchId ? a.map((p) => { const q = p.branchStock[query.branchId!] ?? 0; return { ...p, totalStock: q, stockStatus: stockStatusOf(q, p.minStock) }; }) : a;
    return { total: scoped.length, low: scoped.filter((p) => p.stockStatus === 'low').length, out: scoped.filter((p) => p.stockStatus === 'out').length, value: scoped.reduce((s, p) => s + p.totalStock * p.lastPurchaseCost, 0) };
  }, [all.data, query.branchId]);

  const columns = React.useMemo<ColumnDef<ProductWithStock, unknown>[]>(() => [
    { id: 'name', header: t('common.product'), cell: ({ row }) => <div className="flex items-center gap-2"><div className="flex size-8 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground"><Package className="size-4" /></div><div className="min-w-0"><Link to={`/products/${row.original.id}`} className="block truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{tx(row.original.name)}</Link><div className="text-[11px] text-muted-foreground">{brandName(row.original.brandId)} · {productCategoryIds(row.original).map(categoryName).join('، ')}{row.original.size ? <span className="num"> · {row.original.size}</span> : null}</div></div></div> },
    { accessorKey: 'sku', header: t('common.sku'), cell: ({ row }) => <span className="num text-xs">{row.original.sku}</span> },
    { accessorKey: 'internalBarcode', header: t('common.barcode'), cell: ({ row }) => <div className="num text-xs"><div>{row.original.internalBarcode}</div>{row.original.legacyBarcode ? <div className="text-[10px] text-muted-foreground" title={t('upgrade.legacyBarcode')}>{row.original.legacyBarcode}</div> : null}</div> },
    { accessorKey: 'partNumber', header: t('common.partNumber'), cell: ({ row }) => <span className="num text-xs">{row.original.partNumber}</span> },
    ...(canCost ? [{ accessorKey: 'lastPurchaseCost', header: t('common.cost'), cell: ({ row }: { row: { original: ProductWithStock } }) => <Money value={row.original.lastPurchaseCost} />, meta: { align: 'end' as const } }] : []),
    { id: 'retail1', accessorFn: (p) => p.prices.retail1, header: tx(tierLabels.retail1), cell: ({ row }) => <Money value={row.original.prices.retail1} className="font-medium" />, meta: { align: 'end' } },
    { id: 'retail2', accessorFn: (p) => p.prices.retail2, header: tx(tierLabels.retail2), cell: ({ row }) => <Money value={row.original.prices.retail2} />, meta: { align: 'end' } },
    { id: 'wholesale', accessorFn: (p) => p.prices.wholesale, header: tx(tierLabels.wholesale), cell: ({ row }) => <Money value={row.original.prices.wholesale} />, meta: { align: 'end' } },
    { accessorKey: 'totalStock', header: t('products.currentStock'), cell: ({ row }) => <div className="flex items-center justify-end gap-2"><span className="num font-medium">{row.original.totalStock}</span><StockBadge qty={row.original.totalStock} min={row.original.minStock} /></div>, meta: { align: 'end' } },
    { accessorKey: 'minStock', header: t('products.minStock'), cell: ({ row }) => <span className="num text-muted-foreground">{row.original.minStock}</span>, meta: { align: 'end' } },
    { accessorKey: 'isActive', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.isActive ? 'active' : 'inactive'} label={row.original.isActive ? t('common.active') : t('common.inactive')} />, size: 90 },
  ], [t, tx, brandName, categoryName, canCost, tierLabels]);

  const bulk = async (ids: string[], patch: { isActive?: boolean; categoryId?: string }) => {
    await productService.bulkUpdate(ids, patch);
    toast.success(t('common.updated'));
    setSelection({});
    qc.invalidateQueries({ queryKey: ['products'] });
  };

  const exportColumns = React.useMemo<ExportPayload<ProductWithStock>['columns']>(() => [
    { header: t('common.product'), value: (p) => tx(p.name) },
    { header: t('common.sku'), value: (p) => p.sku },
    { header: t('common.barcode'), value: (p) => p.internalBarcode },
    { header: t('common.partNumber'), value: (p) => p.partNumber },
    { header: t('common.brand'), value: (p) => brandName(p.brandId) },
    { header: t('products.categories'), value: (p) => productCategoryIds(p).map(categoryName).join('، ') },
    ...(canCost ? [{ header: t('common.cost'), value: (p: ProductWithStock) => p.lastPurchaseCost, numeric: true }] : []),
    { header: tx(tierLabels.retail1), value: (p) => p.prices.retail1, numeric: true },
    { header: tx(tierLabels.retail2), value: (p) => p.prices.retail2, numeric: true },
    { header: tx(tierLabels.wholesale), value: (p) => p.prices.wholesale, numeric: true },
    { header: t('products.currentStock'), value: (p) => p.totalStock, numeric: true },
    { header: t('products.minStock'), value: (p) => p.minStock, numeric: true },
    { header: t('common.status'), value: (p) => (p.isActive ? t('common.active') : t('common.inactive')) },
  ], [t, tx, brandName, categoryName, canCost, tierLabels]);

  // Re-fetches with the active filters and no page cap so the file holds every matching row, not just the visible page.
  const exportPayload = async (): Promise<ExportPayload<ProductWithStock>> => {
    const full = await productService.list({ ...query, page: 1, pageSize: 500 });
    return {
      filename: 'products',
      title: t('products.title'),
      columns: exportColumns,
      rows: full.data,
      meta: [
        { label: t('common.filters'), value: [ls.search, ls.filters.categoryId && categoryName(ls.filters.categoryId), ls.filters.brandId && brandName(ls.filters.brandId), ls.filters.stockStatus].filter(Boolean).join(' · ') || '—' },
        { label: t('common.branch'), value: branchId ? (options.branches.find((b) => b.value === branchId)?.label ?? branchId) : t('common.allBranches') },
      ],
    };
  };

  return (
    <div>
      <PageHeader title={t('products.title')} subtitle={t('products.subtitle')} actions={<><ExportMenu payload={exportPayload} /><Button variant="outline" asChild><Link to="/products/barcodes"><BarcodeIcon /> {t('nav.barcodes')}</Link></Button>{canEdit ? <Button onClick={() => setFormOpen(true)}><Plus /> {t('products.addProduct')}</Button> : null}</>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('inventory.totalItems')} value={kpis.total} format="number" icon={<Package />} />
        <StatCard title={t('inventory.lowStock')} value={kpis.low} format="number" icon={<AlertTriangle />} variant="warning" onClick={() => ls.setFilter('stockStatus', 'low')} />
        <StatCard title={t('inventory.outOfStock')} value={kpis.out} format="number" icon={<PackageX />} variant="destructive" onClick={() => ls.setFilter('stockStatus', 'out')} />
        {canCost ? <StatCard title={t('inventory.totalValue')} value={kpis.value} icon={<Tag />} variant="success" /> : null}
      </div>
      <DataTable
        columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize}
        sorting={ls.sorting} onSortingChange={ls.setSorting} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(p) => navigate(`/products/${p.id}`)} getRowId={(p) => p.id}
        enableSelection={canEdit} rowSelection={selection} onRowSelectionChange={setSelection} enableColumnVisibility dense
        emptyAction={canEdit ? <Button size="sm" onClick={() => setFormOpen(true)}><Plus /> {t('products.addProduct')}</Button> : undefined}
        bulkActions={(rows) => (
          <>
            <Button size="xs" variant="outline" onClick={() => bulk(rows.map((r) => r.id), { isActive: true })}><Power /> {t('products.bulkActivate')}</Button>
            <Button size="xs" variant="outline" onClick={() => bulk(rows.map((r) => r.id), { isActive: false })}><PowerOff /> {t('products.bulkDeactivate')}</Button>
            <Button size="xs" variant="outline" onClick={() => navigate('/products/barcodes', { state: { ids: rows.map((r) => r.id) } })}><BarcodeIcon /> {t('products.bulkPrintLabels')}</Button>
            <FilterSelect value={undefined} onChange={(v) => v !== 'all' && bulk(rows.map((r) => r.id), { categoryId: v })} options={options.categories} allLabel={t('products.bulkChangeCategory')} width="w-44" className="h-7" />
            <Button size="xs" variant="outline" onClick={() => exportXlsx({ filename: 'products-selection', title: t('products.title'), columns: exportColumns, rows })}>{t('products.bulkExport')}</Button>
          </>
        )}
        toolbar={
          <>
            <SearchInput value={ls.search} onChange={ls.setSearch} placeholder={`${t('common.name')} / ${t('common.barcode')} / ${t('common.sku')} / ${t('common.partNumber')}`} className="sm:w-80" />
            <FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}>
              <FilterSelect value={ls.filters.categoryId} onChange={(v) => ls.setFilter('categoryId', v)} options={options.categories} allLabel={t('common.category')} />
              <FilterSelect value={ls.filters.brandId} onChange={(v) => ls.setFilter('brandId', v)} options={options.brands} allLabel={t('common.brand')} width="w-32" />
              <FilterSelect value={ls.filters.supplierId} onChange={(v) => ls.setFilter('supplierId', v)} options={options.suppliers} allLabel={t('common.supplier')} />
              <FilterSelect value={ls.filters.stockStatus} onChange={(v) => ls.setFilter('stockStatus', v)} options={[{ value: 'in', label: t('products.inStock') }, { value: 'low', label: t('products.lowStock') }, { value: 'out', label: t('products.outOfStock') }]} allLabel={t('products.stockStatus')} width="w-36" />
              <FilterSelect value={ls.filters.isActive} onChange={(v) => ls.setFilter('isActive', v)} options={[{ value: 'true', label: t('common.active') }, { value: 'false', label: t('common.inactive') }]} allLabel={t('common.status')} width="w-28" />
              {canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} width="w-44" /> : null}
            </FilterBar>
          </>
        }
      />
      <ProductFormDialog open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
