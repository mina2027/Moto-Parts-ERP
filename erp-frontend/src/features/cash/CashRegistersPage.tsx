import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { ArrowDownToLine, ArrowUpFromLine, Lock, LockOpen, Monitor, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, useListState } from '@/components/shared/data-table';
import { FilterSelect, Money, PageHeader, StatCard } from '@/components/shared/page';
import { FormField } from '@/components/shared/form';
import { StatusBadge } from '@/components/shared/status-badge';
import { CardsLoading } from '@/components/shared/states';
import { CloseRegisterDialog } from './CloseRegisterDialog';
import { branchService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';
import type { CashMovementType, CashRegister, RegisterSession } from '@/types';

export default function CashRegistersPage() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ls = useListState();
  const user = useAuthStore((s) => s.session!.user);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canAll = hasPermission('branches.all');
  const currentBranch = user.branchId;
  const { branchName, userName, registerName, options } = useLookups();
  const branchId = canAll ? (ls.filters.branchId as string | undefined) : currentBranch;
  const [openReg, setOpenReg] = React.useState<CashRegister | null>(null);
  const [opening, setOpening] = React.useState('1000');
  const [closeSess, setCloseSess] = React.useState<RegisterSession | null>(null);
  const [moveSess, setMoveSess] = React.useState<RegisterSession | null>(null);
  const [mv, setMv] = React.useState<{ type: CashMovementType; amount: string; notes: string }>({ type: 'deposit', amount: '', notes: '' });

  const registers = useQuery({ queryKey: ['registers', branchId], queryFn: () => branchService.registers(branchId) });
  const sessions = useQuery({ queryKey: ['sessions', ls.query, branchId], queryFn: () => branchService.sessions({ ...ls.query, branchId, status: ls.filters.status as RegisterSession['status'] | undefined }) });
  const openSessions = useQuery({ queryKey: ['sessions', 'open', branchId], queryFn: () => branchService.sessions({ branchId, status: 'open', pageSize: 50 }) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['registers'] }); qc.invalidateQueries({ queryKey: ['sessions'] }); qc.invalidateQueries({ queryKey: ['register'] }); };

  const totals = React.useMemo(() => { const o = openSessions.data?.data ?? []; return { expected: o.reduce((a, s) => a + s.expectedCash, 0), cash: o.reduce((a, s) => a + s.cashSales, 0), card: o.reduce((a, s) => a + s.cardSales, 0), open: o.length }; }, [openSessions.data]);

  const columns = React.useMemo<ColumnDef<RegisterSession, unknown>[]>(() => [
    { id: 'register', header: t('cash.registers'), cell: ({ row }) => <span className="font-medium">{registerName(row.original.registerId)}</span> },
    { id: 'branch', header: t('common.branch'), cell: ({ row }) => <span className="text-xs">{branchName(row.original.branchId)}</span> },
    { id: 'user', header: t('cash.openedBy'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { accessorKey: 'openedAt', header: t('cash.openedAt'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.openedAt, locale)}</span> },
    { accessorKey: 'closedAt', header: t('cash.closedAt'), cell: ({ row }) => <span className="num text-xs">{row.original.closedAt ? formatDateTime(row.original.closedAt, locale) : '—'}</span> },
    { accessorKey: 'openingBalance', header: t('cash.openingBalance'), cell: ({ row }) => <Money value={row.original.openingBalance} />, meta: { align: 'end' } },
    { accessorKey: 'cashSales', header: t('cash.cashSales'), cell: ({ row }) => <Money value={row.original.cashSales} />, meta: { align: 'end' } },
    { accessorKey: 'expectedCash', header: t('cash.expectedCash'), cell: ({ row }) => <Money value={row.original.expectedCash} className="font-medium" />, meta: { align: 'end' } },
    { accessorKey: 'actualCash', header: t('cash.actualCash'), cell: ({ row }) => row.original.actualCash != null ? <Money value={row.original.actualCash} /> : '—', meta: { align: 'end' } },
    { accessorKey: 'difference', header: t('cash.difference'), cell: ({ row }) => { const d = row.original.difference; if (d == null) return '—'; return <Badge variant={d === 0 ? 'success' : d < 0 ? 'destructive' : 'warning'} className="num">{d === 0 ? t('cash.balanced') : `${d < 0 ? t('cash.shortage') : t('cash.overage')} ${formatMoney(Math.abs(d), locale)}`}</Badge>; }, meta: { align: 'center' } },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="cash.status" /> },
  ], [t, locale, registerName, branchName, userName]);

  return (
    <div>
      <PageHeader title={t('cash.title')} subtitle={t('cash.subtitle')} actions={canAll ? <FilterSelect value={ls.filters.branchId} onChange={(v) => ls.setFilter('branchId', v)} options={options.activeBranches} allLabel={t('common.allBranches')} /> : undefined} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('cash.currentSession')} value={totals.open} format="number" icon={<Monitor />} variant="success" hint={`${registers.data?.length ?? 0} ${t('cash.registers')}`} />
        <StatCard title={t('cash.expectedCash')} value={totals.expected} icon={<Wallet />} />
        <StatCard title={t('cash.cashSales')} value={totals.cash} icon={<ArrowDownToLine />} variant="info" />
        <StatCard title={t('cash.cardSales')} value={totals.card} icon={<ArrowUpFromLine />} variant="warning" />
      </div>

      <Tabs defaultValue="registers">
        <TabsList><TabsTrigger value="registers">{t('cash.registers')}</TabsTrigger><TabsTrigger value="sessions">{t('cash.sessions')}</TabsTrigger></TabsList>
        <TabsContent value="registers">
          {registers.isLoading ? <CardsLoading count={6} /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {registers.data?.map((r) => { const sess = openSessions.data?.data.find((s) => s.id === r.currentSessionId); return (
                <Card key={r.id} className={cn(!r.isActive && 'opacity-60')}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2"><div className={cn('flex size-9 items-center justify-center rounded-md', sess ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground')}><Monitor className="size-5" /></div><div><div className="font-medium">{tx(r.name)}</div><div className="text-xs text-muted-foreground">{r.code} · {branchName(r.branchId)}</div></div></div>
                      <StatusBadge status={sess ? 'open' : r.isActive ? 'closed' : 'inactive'} label={sess ? t('cash.status.open') : r.isActive ? t('cash.status.closed') : t('common.inactive')} />
                    </div>
                    {sess ? (
                      <div className="mt-3 space-y-1 text-xs">
                        <div className="flex justify-between text-muted-foreground"><span>{t('cash.openedBy')}</span><span>{userName(sess.userId)} · {formatDateTime(sess.openedAt, locale)}</span></div>
                        <div className="grid grid-cols-3 gap-1.5 pt-1 text-center">
                          <div className="rounded bg-muted/50 p-1.5"><div className="font-semibold num">{formatMoney(sess.openingBalance, locale, { decimals: 0 })}</div><div className="text-[10px] text-muted-foreground">{t('common.opening')}</div></div>
                          <div className="rounded bg-muted/50 p-1.5"><div className="font-semibold num">{formatMoney(sess.cashSales, locale, { decimals: 0 })}</div><div className="text-[10px] text-muted-foreground">{t('cash.cashSales')}</div></div>
                          <div className="rounded bg-primary/10 p-1.5"><div className="font-semibold num text-primary">{formatMoney(sess.expectedCash, locale, { decimals: 0 })}</div><div className="text-[10px] text-muted-foreground">{t('common.expected')}</div></div>
                        </div>
                        <div className="flex gap-1.5 pt-2">
                          <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate(`/cash-registers/sessions/${sess.id}`)}>{t('common.details')}</Button>
                          <Button size="sm" variant="outline" onClick={() => { setMoveSess(sess); setMv({ type: 'deposit', amount: '', notes: '' }); }}>{t('cash.addMovement')}</Button>
                          {hasPermission('cash.close') ? <Button size="sm" variant="destructive" onClick={() => setCloseSess(sess)}><Lock /> {t('cash.closeRegister')}</Button> : null}
                        </div>
                      </div>
                    ) : r.isActive && hasPermission('cash.open') ? <Button size="sm" className="mt-3 w-full" onClick={() => { setOpenReg(r); setOpening('1000'); }}><LockOpen /> {t('cash.openRegister')}</Button> : <div className="mt-3 text-center text-xs text-muted-foreground">{t('cash.noSession')}</div>}
                  </CardContent>
                </Card>
              ); })}
            </div>
          )}
        </TabsContent>
        <TabsContent value="sessions">
          <DataTable columns={columns} data={sessions.data?.data ?? []} total={sessions.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={sessions.isLoading} isError={sessions.isError} onRetry={sessions.refetch} onRowClick={(s) => navigate(`/cash-registers/sessions/${s.id}`)} getRowId={(s) => s.id} dense enableColumnVisibility
            toolbar={<FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={[{ value: 'open', label: t('cash.status.open') }, { value: 'closed', label: t('cash.status.closed') }]} allLabel={t('common.status')} width="w-32" />} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!openReg} onOpenChange={(o) => !o && setOpenReg(null)}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{t('cash.openRegister')}</DialogTitle><DialogDescription>{openReg ? tx(openReg.name) : ''}</DialogDescription></DialogHeader>
          <FormField label={t('cash.openingBalance')} required><Input type="number" value={opening} onChange={(e) => setOpening(e.target.value)} className="h-11 text-lg" dir="ltr" autoFocus /></FormField>
          <div className="flex flex-wrap gap-1.5">{[500, 1000, 1500, 2000].map((n) => <Button key={n} size="sm" variant="outline" className="num" onClick={() => setOpening(String(n))}>{n}</Button>)}</div>
          <DialogFooter><Button variant="outline" onClick={() => setOpenReg(null)}>{t('common.cancel')}</Button><Button onClick={async () => { if (!openReg) return; await branchService.openSession(openReg.id, user.id, Number(opening) || 0); toast.success(t('cash.registerOpened')); setOpenReg(null); refresh(); }}><LockOpen /> {t('cash.openRegister')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!moveSess} onOpenChange={(o) => !o && setMoveSess(null)}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{t('cash.addMovement')}</DialogTitle><DialogDescription>{moveSess ? registerName(moveSess.registerId) : ''}</DialogDescription></DialogHeader>
          <FormField label={t('common.type')}><Select value={mv.type} onValueChange={(v) => setMv({ ...mv, type: v as CashMovementType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(['deposit', 'withdrawal', 'expense', 'payment_in', 'payment_out'] as CashMovementType[]).map((k) => <SelectItem key={k} value={k}>{t(`cash.types.${k}`)}</SelectItem>)}</SelectContent></Select></FormField>
          <FormField label={t('common.amount')} required><Input type="number" value={mv.amount} onChange={(e) => setMv({ ...mv, amount: e.target.value })} dir="ltr" /></FormField>
          <FormField label={t('common.notes')}><Textarea value={mv.notes} onChange={(e) => setMv({ ...mv, notes: e.target.value })} rows={2} /></FormField>
          <DialogFooter><Button variant="outline" onClick={() => setMoveSess(null)}>{t('common.cancel')}</Button><Button disabled={!Number(mv.amount)} onClick={async () => { if (!moveSess) return; await branchService.addMovement(moveSess.id, { type: mv.type, amount: Number(mv.amount), notes: mv.notes, userId: user.id }); toast.success(t('common.saved')); setMoveSess(null); refresh(); }}>{t('common.save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {closeSess ? <CloseRegisterDialog session={closeSess} open onOpenChange={(o) => !o && setCloseSess(null)} onClosed={(id) => { refresh(); navigate(`/cash-registers/sessions/${id}`); }} /> : null}
    </div>
  );
}
