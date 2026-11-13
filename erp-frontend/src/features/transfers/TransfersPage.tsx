import * as React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ArrowLeftRight, ArrowDownToLine, ArrowUpFromLine, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/misc';
import { Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, useListState } from '@/components/shared/data-table';
import { FilterBar, FilterSelect, PageHeader, SearchInput, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { FormField } from '@/components/shared/form';
import { Combobox, NumberStepper } from '@/components/shared/pickers';
import { inventoryService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/utils';
import type { Transfer, TransferStatus } from '@/types';

const STATUSES: TransferStatus[] = ['draft', 'requested', 'approved', 'sent', 'received', 'completed', 'rejected'];

export default function TransfersPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const ls = useListState();
  const user = useAuthStore((s) => s.session!.user);
  const canAll = useAuthStore((s) => s.hasPermission('branches.all'));
  const currentBranch = user.branchId;
  const { branchName, userName, options, productName, warehouses } = useLookups();
  const canTransfer = useAuthStore((s) => s.hasPermission('inventory.transfer'));
  const [newOpen, setNewOpen] = React.useState(false);
  const [direction, setDirection] = React.useState<'all' | 'in' | 'out'>('all');
  const branchId = canAll ? ls.filters.branchId : currentBranch;

  const q = useQuery({ queryKey: ['transfers', ls.query, branchId, direction], queryFn: () => inventoryService.transfers({ ...ls.query, branchId, direction: direction === 'all' ? undefined : direction, status: ls.filters.status as TransferStatus | undefined }) });
  const allQ = useQuery({ queryKey: ['transfers', 'all', branchId], queryFn: () => inventoryService.transfers({ branchId, pageSize: 500 }).then((r) => r.data) });
  const all = allQ.data ?? [];

  // new transfer form state
  const [src, setSrc] = React.useState<string>('');
  const [srcWarehouse, setSrcWarehouse] = React.useState<string>('');
  const [dst, setDst] = React.useState<string>(currentBranch);
  const [items, setItems] = React.useState<{ productId: string; qty: number }[]>([]);
  const [pick, setPick] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState('');
  React.useEffect(() => {
    const action = location.state as { productId?: string; sourceBranchId?: string; sourceWarehouseId?: string } | null;
    if (!action?.productId || !canTransfer) return;
    setItems([{ productId: action.productId, qty: 1 }]);
    setSrc(action.sourceBranchId ?? '');
    setSrcWarehouse(action.sourceWarehouseId ?? '');
    setDst(action.sourceBranchId === currentBranch ? '' : currentBranch);
    setNewOpen(true);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, currentBranch, canTransfer, navigate]);
  const sourceWarehouses = warehouses.filter((w) => w.branchId === src && w.isActive).sort((a, b) => a.id.localeCompare(b.id));
  const selectedWarehouse = sourceWarehouses.find((w) => w.id === srcWarehouse) ?? sourceWarehouses.find((w) => w.isMain) ?? sourceWarehouses[0];
  const canReadSource = canAll || src === currentBranch;
  const { data: srcLevels = [] } = useQuery({ queryKey: ['inventory', 'levels', { branchId: src, warehouseId: selectedWarehouse?.id }], queryFn: () => inventoryService.levels({ branchId: src, warehouseId: selectedWarehouse?.id }), enabled: newOpen && !!src && canReadSource && !!selectedWarehouse });
  const srcStock = (pid: string) => srcLevels.filter((s) => s.productId === pid && s.warehouseId === selectedWarehouse?.id).reduce((a, s) => a + s.quantity, 0);
  const changeSource = (id: string) => { setSrc(id); setSrcWarehouse(''); if (!canAll) setDst(id === currentBranch ? '' : currentBranch); };
  const create = async (submit: boolean) => {
    if (!src || !dst || src === dst || !items.length) return;
    const tr = await inventoryService.createTransfer({ sourceBranchId: src, sourceWarehouseId: selectedWarehouse?.id, destinationBranchId: dst, items: items.map((i) => ({ productId: i.productId, requestedQty: i.qty })), userId: user.id, notes, submit });
    toast.success(t('common.created'));
    qc.invalidateQueries({ queryKey: ['transfers'] });
    setNewOpen(false); setItems([]); setNotes('');
    navigate(`/transfers/${tr.id}`);
  };

  const columns = React.useMemo<ColumnDef<Transfer, unknown>[]>(() => [
    { accessorKey: 'code', header: t('common.code'), cell: ({ row }) => <span className="num font-medium text-primary">{row.original.code}</span> },
    { id: 'route', header: `${t('transfers.source')} → ${t('transfers.destination')}`, cell: ({ row }) => <div className="flex items-center gap-1.5 text-xs"><span>{branchName(row.original.sourceBranchId)}</span><ArrowLeftRight className="size-3 text-muted-foreground" /><span>{branchName(row.original.destinationBranchId)}</span></div> },
    { id: 'items', header: t('common.items'), cell: ({ row }) => <span className="num">{row.original.items.length} / {row.original.items.reduce((a, i) => a + i.requestedQty, 0)}</span>, meta: { align: 'center' } },
    { accessorKey: 'requestedAt', header: t('transfers.requestDate'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.requestedAt, locale)}</span> },
    { id: 'by', header: t('transfers.requestedBy'), cell: ({ row }) => <span className="text-xs">{userName(row.original.requestedBy)}</span> },
    { id: 'appr', header: t('transfers.approvedBy'), cell: ({ row }) => <span className="text-xs">{row.original.approvedBy ? userName(row.original.approvedBy) : '—'}</span> },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="transfers.status" /> },
  ], [t, locale, branchName, userName]);

  return (
    <div>
      <PageHeader title={t('transfers.title')} subtitle={t('transfers.subtitle')} actions={canTransfer ? <Button onClick={() => setNewOpen(true)}><Plus /> {t('transfers.newTransfer')}</Button> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <StatCard title={t('transfers.status.requested')} value={all.filter((x) => x.status === 'requested').length} format="number" icon={<ArrowLeftRight />} variant="info" onClick={() => ls.setFilter('status', 'requested')} />
        <StatCard title={t('transfers.status.sent')} value={all.filter((x) => x.status === 'sent').length} format="number" icon={<ArrowUpFromLine />} variant="warning" onClick={() => ls.setFilter('status', 'sent')} />
        <StatCard title={t('transfers.incoming')} value={all.filter((x) => x.destinationBranchId === currentBranch && ['approved', 'sent'].includes(x.status)).length} format="number" icon={<ArrowDownToLine />} variant="success" onClick={() => setDirection('in')} />
        <StatCard title={t('transfers.status.completed')} value={all.filter((x) => x.status === 'completed').length} format="number" icon={<ArrowLeftRight />} />
      </div>
      <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} onRowClick={(r) => navigate(`/transfers/${r.id}`)} getRowId={(r) => r.id} dense
        toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount + (direction !== 'all' ? 1 : 0)} onClear={() => { ls.clearFilters(); setDirection('all'); }}>
          <div className="inline-flex rounded-md border p-0.5">{(['all', 'in', 'out'] as const).map((d) => <Button key={d} size="xs" variant={direction === d ? 'secondary' : 'ghost'} onClick={() => setDirection(d)}>{d === 'all' ? t('common.all') : d === 'in' ? t('transfers.incoming') : t('transfers.outgoing')}</Button>)}</div>
          {canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.branches} allLabel={t('common.allBranches')} /> : null}
          <FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={STATUSES.map((s) => ({ value: s, label: t(`transfers.status.${s}`) }))} allLabel={t('common.status')} width="w-36" />
        </FilterBar></>} />

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{t('transfers.newTransfer')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label={t('transfers.source')} required><Select value={src} onValueChange={changeSource}><SelectTrigger><SelectValue placeholder={t('common.selectBranch')} /></SelectTrigger><SelectContent>{options.activeBranches.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent></Select></FormField>
              <FormField label={t('transfers.destination')} required><Select value={dst} onValueChange={setDst} disabled={!canAll && src !== currentBranch}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{options.activeBranches.filter((b) => b.value !== src).map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}</SelectContent></Select></FormField>
              {sourceWarehouses.length ? <FormField label={`${t('common.warehouse')} (${t('transfers.source')})`}><Select value={selectedWarehouse?.id} onValueChange={setSrcWarehouse}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{sourceWarehouses.map((w) => <SelectItem key={w.id} value={w.id}>{tx(w.name)}</SelectItem>)}</SelectContent></Select></FormField> : null}
            </div>
            {src && src === dst ? <Alert variant="destructive">{t('transfers.sameBranch')}</Alert> : null}
            <FormField label={t('transfers.addItems')}><div className="flex gap-2"><div className="flex-1"><Combobox value={pick} onChange={setPick} options={options.products} placeholder={t('common.selectProduct')} /></div><Button variant="outline" disabled={!pick || items.some((i) => i.productId === pick)} onClick={() => { setItems((x) => [...x, { productId: pick!, qty: 1 }]); setPick(null); }}><Plus /></Button></div></FormField>
            {items.length ? <table className="w-full text-sm"><thead className="text-xs text-muted-foreground"><tr><th className="pb-1 text-start font-medium">{t('common.product')}</th><th className="pb-1 text-center font-medium">{t('inventory.available')} ({t('transfers.source')})</th><th className="pb-1 text-center font-medium">{t('transfers.requestedQty')}</th><th /></tr></thead><tbody>{items.map((i) => { const avail = src ? srcStock(i.productId) : 0; return <tr key={i.productId} className="border-t"><td className="py-1.5">{productName(i.productId)}</td><td className={`py-1.5 text-center num ${avail < i.qty ? 'text-destructive' : ''}`}>{src && canReadSource ? avail : '—'}</td><td className="py-1.5 text-center"><NumberStepper value={i.qty} min={1} onChange={(v) => setItems((x) => x.map((y) => (y.productId === i.productId ? { ...y, qty: v } : y)))} size="sm" /></td><td className="py-1.5 text-end"><Button size="icon-xs" variant="ghost" onClick={() => setItems((x) => x.filter((y) => y.productId !== i.productId))}><Trash2 /></Button></td></tr>; })}</tbody></table> : null}
            <FormField label={t('common.notes')}><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></FormField>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>{t('common.cancel')}</Button>
            <Button variant="secondary" disabled={!src || !dst || src === dst || !items.length} onClick={() => create(false)}>{t('common.draft')}</Button>
            <Button disabled={!src || !dst || src === dst || !items.length} onClick={() => create(true)}>{t('transfers.actions.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
