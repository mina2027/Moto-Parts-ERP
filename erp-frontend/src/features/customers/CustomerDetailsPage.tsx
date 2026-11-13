import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { HandCoins, MessageCircle, Pencil, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/misc';
import { KeyValue, Money, PageHeader, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { ErrorState, PageLoading, EmptyState } from '@/components/shared/states';
import { StatementTable } from '@/components/shared/statement-table';
import { DonutChart } from '@/components/shared/charts';
import { CustomerFormDialog } from './CustomerFormDialog';
import { RecordPaymentDialog } from '@/features/debts/RecordPaymentDialog';
import { SendWhatsAppDialog } from '@/features/whatsapp/SendWhatsAppDialog';
import { customerService, salesService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDate, formatDateTime } from '@/lib/utils';
import { Combobox } from '@/components/shared/pickers';
import { Input } from '@/components/ui/input';

export default function CustomerDetailsPage() {
  const { id = '' } = useParams();
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const { branchName, userName, options, productName, product } = useLookups();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [editOpen, setEditOpen] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [waOpen, setWaOpen] = React.useState(false);
  const [spProduct, setSpProduct] = React.useState<string | null>(null);
  const [spPrice, setSpPrice] = React.useState('');

  const c = useQuery({ queryKey: ['customer', id], queryFn: () => customerService.get(id) });
  const summary = useQuery({ queryKey: ['customer', id, 'summary'], queryFn: () => customerService.summary(id) });
  const sales = useQuery({ queryKey: ['sales', { customerId: id }], queryFn: () => salesService.list({ customerId: id, pageSize: 50 }) });
  const payments = useQuery({ queryKey: ['debts', 'payments', id], queryFn: () => customerService.payments({ customerId: id, pageSize: 50 }) });
  const statement = useQuery({ queryKey: ['customer', id, 'statement'], queryFn: () => customerService.statement(id) });
  const debts = useQuery({ queryKey: ['debts', { customerId: id }], queryFn: () => customerService.debts({ customerId: id, pageSize: 100 }) });
  const special = useQuery({ queryKey: ['customer', id, 'special'], queryFn: () => customerService.specialPrices(id) });

  if (c.isLoading) return <PageLoading />;
  if (c.isError || !c.data) return <ErrorState onRetry={() => c.refetch()} />;
  const cust = c.data;
  const s = summary.data;
  const usage = cust.creditLimit ? (cust.balance / cust.creditLimit) * 100 : 0;
  const aging = s ? [
    { name: { ar: 'جاري', en: 'Current' }, value: s.aging.current, color: '#16a34a' },
    { name: { ar: '1-30', en: '1-30' }, value: s.aging.d1_30, color: '#84cc16' },
    { name: { ar: '31-60', en: '31-60' }, value: s.aging.d31_60, color: '#f59e0b' },
    { name: { ar: '61-90', en: '61-90' }, value: s.aging.d61_90, color: '#ea580c' },
    { name: { ar: '+90', en: '90+' }, value: s.aging.d90, color: '#dc2626' },
  ].filter((x) => x.value > 0) : [];

  const addSpecial = async () => {
    const price = Number(spPrice);
    if (!spProduct || !price) return;
    await customerService.addSpecialPrice({ customerId: id, productId: spProduct, price, validFrom: new Date().toISOString(), validTo: null });
    toast.success(t('common.saved'));
    setSpProduct(null); setSpPrice('');
    special.refetch();
  };

  return (
    <div>
      <PageHeader
        backTo="/customers"
        title={tx(cust.name)}
        badge={<><StatusBadge status={cust.type} labelKey="customers.types" /><StatusBadge status={cust.isActive ? 'active' : 'inactive'} label={cust.isActive ? t('common.active') : t('common.inactive')} /></>}
        subtitle={`${cust.code} · ${cust.phone} · ${branchName(cust.branchId)}`}
        actions={
          <>
            {hasPermission('whatsapp.send') ? <Button variant="outline" onClick={() => setWaOpen(true)} disabled={!cust.whatsapp}><MessageCircle /> {t('customers.sendWhatsApp')}</Button> : null}
            {hasPermission('customers.credit') && cust.balance > 0 ? <Button variant="success" onClick={() => setPayOpen(true)}><HandCoins /> {t('customers.recordPayment')}</Button> : null}
            {hasPermission('customers.edit') ? <Button variant="outline" onClick={() => setEditOpen(true)}><Pencil /> {t('common.edit')}</Button> : null}
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('customers.currentBalance')} value={cust.balance} icon={<Wallet />} variant={cust.balance > 0 ? 'destructive' : 'success'} />
        <StatCard title={t('customers.totalPurchases')} value={s?.totalPurchases ?? 0} icon={<Receipt />} hint={`${s?.invoiceCount ?? 0} ${t('dashboard.invoices')}`} />
        <StatCard title={t('customers.totalPaid')} value={s?.totalPaid ?? 0} icon={<HandCoins />} variant="success" />
        <div className="rounded-lg border bg-card p-3.5">
          <div className="text-xs font-medium text-muted-foreground">{t('customers.creditUsage')}</div>
          {cust.creditLimit ? (
            <>
              <div className="mt-1 flex items-baseline justify-between"><span className="text-xl font-semibold num">{Math.round(usage)}%</span><StatusBadge status={usage >= 100 ? 'overdue' : usage >= 80 ? 'partial' : 'paid'} label={usage >= 100 ? t('customers.overLimit') : usage >= 80 ? t('customers.nearLimit') : t('customers.withinLimit')} /></div>
              <Progress value={usage} className="mt-2" color={usage >= 100 ? 'bg-destructive' : usage >= 80 ? 'bg-warning' : 'bg-success'} />
              <div className="mt-1 text-[11px] text-muted-foreground">{t('customers.availableCredit')}: <Money value={s?.availableCredit ?? 0} /> / <Money value={cust.creditLimit} /></div>
            </>
          ) : <div className="mt-2 text-sm text-muted-foreground">—</div>}
        </div>
      </div>

      <Tabs defaultValue="overview" className="mt-4">
        <TabsList variant="underline">
          <TabsTrigger variant="underline" value="overview">{t('common.overview')}</TabsTrigger>
          <TabsTrigger variant="underline" value="invoices">{t('customers.invoices')} ({sales.data?.total ?? 0})</TabsTrigger>
          <TabsTrigger variant="underline" value="debts">{t('nav.debts')} ({debts.data?.data.filter((d) => d.remaining > 0).length ?? 0})</TabsTrigger>
          <TabsTrigger variant="underline" value="payments">{t('customers.payments')}</TabsTrigger>
          <TabsTrigger variant="underline" value="statement">{t('customers.statement')}</TabsTrigger>
          <TabsTrigger variant="underline" value="pricing">{t('customers.specialPricing')}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-3 lg:grid-cols-3">
            <Section title={t('common.generalInfo')} className="lg:col-span-2">
              <KeyValue cols={2} items={[
                { label: t('common.nameAr'), value: cust.name.ar }, { label: t('common.nameEn'), value: cust.name.en },
                { label: t('common.phone'), value: <span className="num">{cust.phone}</span> }, { label: t('customers.whatsapp'), value: <span className="num">{cust.whatsapp || '—'}</span> },
                { label: t('common.address'), value: tx(cust.address) }, { label: t('common.branch'), value: branchName(cust.branchId) },
                { label: t('customers.creditLimit'), value: cust.creditLimit ? <Money value={cust.creditLimit} /> : '—' }, { label: t('customers.lastPurchase'), value: s?.lastPurchase ? formatDate(s.lastPurchase, locale) : '—' },
                { label: t('common.createdAt'), value: formatDate(cust.createdAt, locale) }, { label: t('common.notes'), value: cust.notes || '—' },
              ]} />
            </Section>
            <Section title={t('customers.debtAging')}>
              {aging.length ? <DonutChart data={aging} height={160} /> : <EmptyState title={t('common.noData')} className="py-6" />}
            </Section>
          </div>
        </TabsContent>

        <TabsContent value="invoices">
          <Section>
            {sales.data?.data.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoiceNumber')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.cashier')}</th><th className="pb-2 text-start font-medium">{t('common.type')}</th><th className="pb-2 text-end font-medium">{t('common.total')}</th><th className="pb-2 text-end font-medium">{t('common.remaining')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody>{sales.data.data.map((sl) => (
                  <tr key={sl.id} className="border-t"><td className="py-1.5"><Link to={`/sales/${sl.id}`} className="num font-medium hover:underline">{sl.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDateTime(sl.date, locale)}</td><td className="py-1.5 text-xs">{userName(sl.cashierId)}</td><td className="py-1.5"><StatusBadge status={sl.type} labelKey="sales.types" /></td><td className="py-1.5 text-end"><Money value={sl.total} /></td><td className="py-1.5 text-end"><Money value={sl.remaining} colored={false} className={sl.remaining > 0 ? 'text-destructive' : ''} /></td><td className="py-1.5"><StatusBadge status={sl.status} labelKey="sales.status" /></td></tr>
                ))}</tbody>
              </table>
            ) : <EmptyState />}
          </Section>
        </TabsContent>

        <TabsContent value="debts">
          <Section>
            {debts.data?.data.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.invoice')}</th><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.dueDate')}</th><th className="pb-2 text-end font-medium">{t('debts.originalAmount')}</th><th className="pb-2 text-end font-medium">{t('debts.paidAmount')}</th><th className="pb-2 text-end font-medium">{t('common.remaining')}</th><th className="pb-2 text-center font-medium">{t('debts.daysOverdue')}</th><th className="pb-2 text-start font-medium">{t('common.status')}</th></tr></thead>
                <tbody>{debts.data.data.map((d) => (
                  <tr key={d.id} className="border-t"><td className="py-1.5"><Link to={`/sales/${d.saleId}`} className="num hover:underline">{d.invoiceNumber}</Link></td><td className="py-1.5 num text-xs">{formatDate(d.invoiceDate, locale)}</td><td className="py-1.5 num text-xs">{formatDate(d.dueDate, locale)}</td><td className="py-1.5 text-end"><Money value={d.originalAmount} /></td><td className="py-1.5 text-end"><Money value={d.paidAmount} /></td><td className="py-1.5 text-end font-medium"><Money value={d.remaining} /></td><td className="py-1.5 text-center num">{d.daysOverdue > 0 ? <span className="text-destructive font-medium">{d.daysOverdue}</span> : '—'}</td><td className="py-1.5"><StatusBadge status={d.status} labelKey="debts.status" /></td></tr>
                ))}</tbody>
              </table>
            ) : <EmptyState />}
          </Section>
        </TabsContent>

        <TabsContent value="payments">
          <Section>
            {payments.data?.data.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.date')}</th><th className="pb-2 text-start font-medium">{t('common.reference')}</th><th className="pb-2 text-start font-medium">{t('common.paymentMethod')}</th><th className="pb-2 text-start font-medium">{t('common.user')}</th><th className="pb-2 text-end font-medium">{t('common.amount')}</th></tr></thead>
                <tbody>{payments.data.data.map((p) => (
                  <tr key={p.id} className="border-t"><td className="py-1.5 num text-xs">{formatDateTime(p.date, locale)}</td><td className="py-1.5 num text-xs">{p.reference}</td><td className="py-1.5"><StatusBadge status={p.method} labelKey="sales.methods" /></td><td className="py-1.5 text-xs">{userName(p.userId)}</td><td className="py-1.5 text-end font-medium text-success"><Money value={p.amount} /></td></tr>
                ))}</tbody>
              </table>
            ) : <EmptyState />}
          </Section>
        </TabsContent>

        <TabsContent value="statement">
          <Section title={t('customers.statement')} actions={<Button size="sm" variant="outline" onClick={() => window.print()}>{t('common.print')}</Button>}>
            <StatementTable lines={statement.data ?? []} debitLabel={t('suppliers.debit')} creditLabel={t('suppliers.creditCol')} />
          </Section>
        </TabsContent>

        <TabsContent value="pricing">
          <Section title={t('customers.specialPricing')}>
            {hasPermission('prices.edit') ? (
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
                <div className="min-w-64 flex-1"><label className="text-xs text-muted-foreground">{t('common.product')}</label><Combobox value={spProduct} onChange={setSpProduct} options={options.products} placeholder={t('common.selectProduct')} /></div>
                <div><label className="text-xs text-muted-foreground">{t('common.price')}</label><Input type="number" value={spPrice} onChange={(e) => setSpPrice(e.target.value)} className="w-32" dir="ltr" /></div>
                <Button onClick={addSpecial} disabled={!spProduct || !spPrice}><Plus /> {t('customers.addSpecialPrice')}</Button>
              </div>
            ) : null}
            {special.data?.length ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground"><tr><th className="pb-2 text-start font-medium">{t('common.product')}</th><th className="pb-2 text-end font-medium">{t('products.retailPrice')}</th><th className="pb-2 text-end font-medium">{t('customers.specialPricing')}</th><th className="pb-2 text-start font-medium">{t('pricing.validFrom')}</th><th className="pb-2 text-start font-medium">{t('pricing.validTo')}</th><th /></tr></thead>
                <tbody>{special.data.map((sp) => { const p = product(sp.productId); return (
                  <tr key={sp.id} className="border-t"><td className="py-1.5">{productName(sp.productId)}</td><td className="py-1.5 text-end text-muted-foreground"><Money value={p?.prices.retail1 ?? 0} /></td><td className="py-1.5 text-end font-medium text-success"><Money value={sp.price} /></td><td className="py-1.5 num text-xs">{formatDate(sp.validFrom, locale)}</td><td className="py-1.5 num text-xs">{sp.validTo ? formatDate(sp.validTo, locale) : t('pricing.indefinite')}</td><td className="py-1.5 text-end">{hasPermission('prices.edit') ? <Button size="icon-xs" variant="ghost" className="text-destructive" onClick={async () => { await customerService.removeSpecialPrice(sp.id); special.refetch(); }}><Trash2 /></Button> : null}</td></tr>
                ); })}</tbody>
              </table>
            ) : <EmptyState title={t('customers.noSpecialPrices')} />}
          </Section>
        </TabsContent>
      </Tabs>

      <CustomerFormDialog open={editOpen} onOpenChange={setEditOpen} customer={cust} onSaved={() => { c.refetch(); qc.invalidateQueries({ queryKey: ['customers'] }); }} />
      <RecordPaymentDialog open={payOpen} onOpenChange={setPayOpen} customerId={cust.id} customerName={tx(cust.name)} maxAmount={cust.balance} onDone={() => { c.refetch(); summary.refetch(); debts.refetch(); payments.refetch(); statement.refetch(); }} />
      <SendWhatsAppDialog open={waOpen} onOpenChange={setWaOpen} customer={cust} />
    </div>
  );
}
