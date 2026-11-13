import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Package, Pencil, ShoppingBag, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { StatementTable } from '@/components/shared/statement-table';
import { SupplierFormDialog } from './SuppliersPage';
import { SupplierPaymentDialog } from '@/features/purchases/SupplierPaymentDialog';
import { purchaseService, supplierService, productService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { productCategoryIds } from '@moto/shared';
import { formatDate, formatDateTime } from '@/lib/utils';

export default function SupplierDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const { branchName, userName, productName, categoryName } = useLookups();
  const [editOpen, setEditOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const s = useQuery({ queryKey: ['supplier', id], queryFn: () => supplierService.get(id) });
  const summary = useQuery({ queryKey: ['supplier', id, 'summary'], queryFn: () => supplierService.summary(id) });
  const purchases = useQuery({ queryKey: ['purchases', { supplierId: id }], queryFn: () => purchaseService.list({ supplierId: id, pageSize: 50 }) });
  const payments = useQuery({ queryKey: ['purchases', 'payments', id], queryFn: () => purchaseService.payments({ supplierId: id, pageSize: 50 }) });
  const returns = useQuery({ queryKey: ['purchases', 'returns', id], queryFn: () => purchaseService.returns({ supplierId: id, pageSize: 50 }) });
  const statement = useQuery({ queryKey: ['supplier', id, 'statement'], queryFn: () => supplierService.statement(id) });
  const products = useQuery({ queryKey: ['products', { supplierId: id }], queryFn: () => productService.list({ supplierId: id, pageSize: 100 }) });
  if (s.isLoading) return <PageLoading />;
  if (s.isError || !s.data) return <ErrorState onRetry={() => s.refetch()} />;
  const sup = s.data;
  const refresh = () => { s.refetch(); summary.refetch(); purchases.refetch(); payments.refetch(); statement.refetch(); };

  return (
    <div>
      <PageHeader backTo="/suppliers" title={tx(sup.name)} badge={<StatusBadge status={sup.isActive ? 'active' : 'inactive'} label={sup.isActive ? t('common.active') : t('common.inactive')} />} subtitle={`${sup.code} · ${tx(sup.contactPerson)} · ${sup.phone}`}
        actions={<>{hasPermission('purchases.pay') && sup.balance > 0 ? <Button variant="success" onClick={() => setPayOpen(true)}><HandCoins /> {t('purchases.newPayment')}</Button> : null}{hasPermission('suppliers.edit') ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> {t('common.edit')}</Button> : null}</>} />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('suppliers.balance')} value={sup.balance} icon={<Wallet />} variant={sup.balance > 0 ? 'destructive' : 'success'} />
        <StatCard title={t('purchases.totalPurchases')} value={summary.data?.totalPurchases ?? 0} icon={<ShoppingBag />} hint={`${summary.data?.purchaseCount ?? 0} ${t('dashboard.invoices')}`} />
        <StatCard title={t('customers.totalPaid')} value={summary.data?.totalPaid ?? 0} icon={<HandCoins />} variant="success" />
        <StatCard title={t('common.products')} value={summary.data?.productsCount ?? 0} format="number" icon={<Package />} variant="info" />
      </div>
      <Tabs defaultValue="overview" className="mt-4">
        <TabsList variant="underline"><TabsTrigger variant="underline" value="overview">{t('common.overview')}</TabsTrigger><TabsTrigger variant="underline" value="purchases">{t('suppliers.purchaseHistory')}</TabsTrigger><TabsTrigger variant="underline" value="payments">{t('suppliers.payments')}</TabsTrigger><TabsTrigger variant="underline" value="returns">{t('suppliers.returns')}</TabsTrigger><TabsTrigger variant="underline" value="statement">{t('suppliers.statement')}</TabsTrigger><TabsTrigger variant="underline" value="products">{t('common.products')}</TabsTrigger></TabsList>
        <TabsContent value="overview"><Section title={t('common.generalInfo')}><KeyValue cols={3} items={[{ label: t('common.nameAr'), value: sup.name.ar }, { label: t('common.nameEn'), value: sup.name.en }, { label: t('suppliers.contactPerson'), value: tx(sup.contactPerson) }, { label: t('common.phone'), value: <span className="num">{sup.phone}</span> }, { label: t('common.email'), value: <span dir="ltr">{sup.email || '—'}</span> }, { label: t('common.address'), value: tx(sup.address) }, { label: t('suppliers.paymentTerms'), value: `${sup.paymentTermsDays} ${t('common.days')}` }, { label: t('customers.lastPurchase'), value: summary.data?.lastPurchase ? formatDate(summary.data.lastPurchase, locale) : '—' }, { label: t('common.createdAt'), value: formatDate(sup.createdAt, locale) }]} /></Section></TabsContent>
        <TabsContent value="purchases"><Section>{purchases.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoiceNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.branch')}</th><th className="pb-2 text-end font-medium">{t('common.total')}</th><th className="pb-2 text-end font-medium">{t('common.paid')}</th><th className="pb-2 text-end font-medium">{t('common.remaining')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead><tbody>{purchases.data.data.map((p) => <tr key={p.id} className="border-t"><td className="py-1.5"><Link to={`/purchases/${p.id}`} className="num font-medium text-primary hover:underline">{p.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDate(p.date, locale)}</td><td className="py-1.5 text-xs">{branchName(p.branchId)}</td><td className="py-1.5 text-end"><Money value={p.total} /></td><td className="py-1.5 text-end text-success"><Money value={p.paid} /></td><td className="py-1.5 text-end text-destructive">{p.remaining ? <Money value={p.remaining} /> : '—'}</td><td className="py-1.5"><StatusBadge status={p.status} labelKey="purchases.status" /></td></tr>)}</tbody></table> : <EmptyState />}</Section></TabsContent>
        <TabsContent value="payments"><Section>{payments.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.reference')}</th><th className="pb-2 text-start font-medium">{t('common.paymentMethod')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-end font-medium">{t('common.amount')}</th></tr></thead><tbody>{payments.data.data.map((p) => <tr key={p.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(p.date, locale)}</td><td className="py-1.5 num text-xs">{p.reference}</td><td className="py-1.5"><StatusBadge status={p.method} labelKey="sales.methods" /></td><td className="py-1.5 text-xs">{userName(p.userId)}</td><td className="py-1.5 text-end font-medium text-success"><Money value={p.amount} /></td></tr>)}</tbody></table> : <EmptyState />}</Section></TabsContent>
        <TabsContent value="returns"><Section>{returns.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('sales.returnNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.items')}</th><th className="pb-2 text-start font-medium">{t('common.reason')}</th><th className="pb-2 text-end font-medium">{t('common.total')}</th></tr></thead><tbody>{returns.data.data.map((r) => <tr key={r.id} className="border-t"><td className="py-1.5 num">{r.returnNumber}</td><td className="py-1.5 num text-xs">{formatDate(r.date, locale)}</td><td className="py-1.5 text-xs">{r.items.map((i) => `${productName(i.productId)} ×${i.quantity}`).join('، ')}</td><td className="py-1.5 text-xs text-muted-foreground">{r.reason}</td><td className="py-1.5 text-end font-medium"><Money value={r.total} /></td></tr>)}</tbody></table> : <EmptyState />}</Section></TabsContent>
        <TabsContent value="statement"><Section title={t('suppliers.statement')} actions={<Button size="sm" variant="outline" onClick={() => window.print()}>{t('common.print')}</Button>}><StatementTable lines={statement.data ?? []} debitLabel={t('suppliers.debit')} creditLabel={t('suppliers.creditCol')} /></Section></TabsContent>
        <TabsContent value="products"><Section>{products.data?.data.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-start font-medium">{t('common.sku')}</th><th className="pb-2 text-start font-medium">{t('common.category')}</th><th className="pb-2 text-end font-medium">{t('products.lastPurchaseCost')}</th><th className="pb-2 text-end font-medium">{t('products.currentStock')}</th></tr></thead><tbody>{products.data.data.map((p) => <tr key={p.id} className="border-t"><td className="py-1.5"><Link to={`/products/${p.id}`} className="hover:underline">{tx(p.name)}</Link></td><td className="py-1.5 num text-xs">{p.sku}</td><td className="py-1.5 text-xs">{productCategoryIds(p).map(categoryName).join('، ')}</td><td className="py-1.5 text-end"><Money value={p.lastPurchaseCost} /></td><td className="py-1.5 text-end num">{p.totalStock}</td></tr>)}</tbody></table> : <EmptyState />}</Section></TabsContent>
      </Tabs>
      <SupplierFormDialog open={editOpen} onOpenChange={setEditOpen} supplier={sup} onSaved={refresh} />
      <SupplierPaymentDialog open={payOpen} onOpenChange={setPayOpen} supplierId={sup.id} onDone={refresh} />
    </div>
  );
}
