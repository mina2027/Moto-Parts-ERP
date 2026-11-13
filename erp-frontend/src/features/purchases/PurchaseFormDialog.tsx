import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField, FormGrid } from '@/components/shared/form';
import { Combobox, NumberStepper } from '@/components/shared/pickers';
import { Money } from '@/components/shared/page';
import { inventoryService, purchaseService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { round2 } from '@/lib/utils';

interface Line { productId: string; quantity: number; unitCost: number }

export function PurchaseFormDialog({ open, onOpenChange, onCreated, initialProductId }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (id: string) => void; initialProductId?: string }) {
  const { t, tx } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const { options, warehouses, productName, product, products } = useLookups();
  const [branchId, setBranchId] = React.useState(user.branchId);
  const whs = warehouses.filter((w) => w.branchId === branchId);
  const { data: stockLevels = [] } = useQuery({ queryKey: ['inventory', 'levels', { branchId }], queryFn: () => inventoryService.levels({ branchId }), enabled: open });
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const [supplierInvoice, setSupplierInvoice] = React.useState('');
  const [warehouseId, setWarehouseId] = React.useState(whs[0]?.id ?? '');
  const changeBranch = React.useCallback((b: string) => { setBranchId(b); setWarehouseId(warehouses.find((w) => w.branchId === b)?.id ?? ''); }, [warehouses]);
  const [expected, setExpected] = React.useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [lines, setLines] = React.useState<Line[]>([]);
  const [pick, setPick] = React.useState<string | null>(null);
  const [discount, setDiscount] = React.useState(0);
  const [paid, setPaid] = React.useState(0);
  const [notes, setNotes] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Reset only on the closed→open transition so lookup refetches don't wipe in-progress edits.
  const wasOpen = React.useRef(false);
  React.useEffect(() => {
    if (open && !wasOpen.current) { setSupplierId(null); setSupplierInvoice(''); changeBranch(user.branchId); setLines(initialProductId ? [{ productId: initialProductId, quantity: 10, unitCost: product(initialProductId)?.purchasePrice ?? 0 }] : []); setDiscount(0); setPaid(0); setNotes(''); setErrors({}); }
    wasOpen.current = open;
  }, [open, initialProductId, user.branchId, changeBranch, product]);

  const addLine = (pid: string) => { if (lines.some((l) => l.productId === pid)) return; const p = product(pid); setLines((l) => [...l, { productId: pid, quantity: 10, unitCost: p?.purchasePrice ?? 0 }]); setPick(null); };
  const subtotal = round2(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
  const total = round2(subtotal - discount);
  const supplierProducts = supplierId ? options.products.filter((o) => products.find((p) => p.id === o.value)?.supplierId === supplierId) : options.products;

  const submit = async (status: 'draft' | 'ordered') => {
    const e: Record<string, string> = {};
    if (!supplierId) e.supplier = t('validation.required');
    if (!warehouseId) e.warehouse = t('validation.required');
    if (!lines.length) e.lines = t('sales.selectAtLeastOne');
    if (lines.some((l) => l.quantity <= 0 || l.unitCost < 0)) e.lines = t('validation.positive');
    if (paid > total) e.paid = t('common.max');
    setErrors(e);
    if (Object.keys(e).length) return;
    const p = await purchaseService.create({ supplierId: supplierId!, supplierInvoiceNumber: supplierInvoice, branchId, warehouseId, expectedDate: expected ? new Date(expected).toISOString() : undefined, items: lines, discount, paid, userId: user.id, notes, status });
    toast.success(t('purchases.purchaseCreated'));
    qc.invalidateQueries({ queryKey: ['purchases'] }); qc.invalidateQueries({ queryKey: ['suppliers'] });
    onOpenChange(false);
    onCreated?.(p.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl">
        <DialogHeader><DialogTitle>{t('purchases.newPurchase')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <FormGrid cols={4}>
            <FormField label={t('common.supplier')} required error={errors.supplier}><Combobox value={supplierId} onChange={setSupplierId} options={options.suppliers} placeholder={t('common.selectSupplier')} /></FormField>
            <FormField label={t('purchases.supplierInvoice')}><Input value={supplierInvoice} onChange={(e) => setSupplierInvoice(e.target.value)} dir="ltr" /></FormField>
            {canAll ? <FormField label={t('common.branch')} required><Select value={branchId} onValueChange={changeBranch}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.activeBranches.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent></Select></FormField> : null}
            <FormField label={t('common.warehouse')} required error={errors.warehouse}><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{whs.map((w) => <SelectItem key={w.id} value={w.id}>{tx(w.name)}</SelectItem>)}</SelectContent></Select></FormField>
            <FormField label={t('purchases.expectedDate')}><Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} /></FormField>
          </FormGrid>
          <FormField label={t('purchases.addItem')} error={errors.lines}><div className="flex gap-2"><div className="flex-1"><Combobox value={pick} onChange={(v) => v && addLine(v)} options={supplierProducts} placeholder={t('common.selectProduct')} /></div></div></FormField>
          {lines.length ? (
            <div className="overflow-auto rounded-md border"><table className="w-full text-sm"><thead className="bg-muted/60 text-xs text-muted-foreground"><tr><th className="px-2 py-1.5 text-start font-medium">{t('common.product')}</th><th className="px-2 py-1.5 text-center font-medium">{t('purchases.currentStock')}</th><th className="px-2 py-1.5 text-center font-medium">{t('common.quantity')}</th><th className="px-2 py-1.5 text-end font-medium">{t('purchases.unitCost')}</th><th className="px-2 py-1.5 text-end font-medium">{t('common.subtotal')}</th><th /></tr></thead>
              <tbody>{lines.map((l) => { const stock = stockLevels.filter((s) => s.productId === l.productId && s.branchId === branchId).reduce((a, s) => a + s.quantity, 0); return <tr key={l.productId} className="border-t"><td className="px-2 py-1.5">{productName(l.productId)}</td><td className="px-2 py-1.5 text-center num text-muted-foreground">{stock}</td><td className="px-2 py-1.5 text-center"><NumberStepper value={l.quantity} min={1} onChange={(v) => setLines((x) => x.map((y) => (y.productId === l.productId ? { ...y, quantity: v } : y)))} size="sm" /></td><td className="px-2 py-1.5 text-end"><Input type="number" step="0.01" value={l.unitCost} onChange={(e) => setLines((x) => x.map((y) => (y.productId === l.productId ? { ...y, unitCost: Number(e.target.value) } : y)))} className="ms-auto h-7 w-24 text-end" dir="ltr" /></td><td className="px-2 py-1.5 text-end font-medium"><Money value={l.quantity * l.unitCost} /></td><td className="px-2 py-1.5"><Button size="icon-xs" variant="ghost" onClick={() => setLines((x) => x.filter((y) => y.productId !== l.productId))}><Trash2 /></Button></td></tr>; })}</tbody></table></div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-[1fr_280px]">
            <FormField label={t('common.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></FormField>
            <div className="space-y-1.5 rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.subtotal')}</span><Money value={subtotal} /></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('common.discount')}</span><Input type="number" value={discount || ''} onChange={(e) => setDiscount(Number(e.target.value) || 0)} className="h-7 w-28 text-end" dir="ltr" placeholder="0" /></div>
              <div className="flex justify-between border-t pt-1.5 font-semibold"><span>{t('common.total')}</span><Money value={total} /></div>
              <div className="flex items-center justify-between"><span className="text-muted-foreground">{t('common.paid')}</span><Input type="number" value={paid || ''} onChange={(e) => setPaid(Number(e.target.value) || 0)} className={`h-7 w-28 text-end ${errors.paid ? 'border-destructive' : ''}`} dir="ltr" placeholder="0" /></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.remaining')}</span><Money value={Math.max(0, total - paid)} className="text-destructive" /></div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button variant="secondary" onClick={() => submit('draft')}>{t('common.draft')}</Button>
          <Button onClick={() => submit('ordered')}><Plus /> {t('common.create')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
