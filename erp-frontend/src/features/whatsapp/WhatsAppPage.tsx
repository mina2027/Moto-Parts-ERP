import * as React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Check, CheckCheck, Clock, MessageCircle, Pencil, RefreshCw, Send, XCircle, Plug } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/input';
import { Switch, Alert } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, useListState } from '@/components/shared/data-table';
import { FilterBar, FilterSelect, PageHeader, SearchInput, Section, StatCard } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { SendWhatsAppDialog } from './SendWhatsAppDialog';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { whatsappService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useT } from '@/i18n';
import { formatDateTime } from '@/lib/utils';
import type { MessageStatus, WhatsAppMessage, WhatsAppTemplate, WhatsAppTemplateKey } from '@/types';

const statusIcon: Record<MessageStatus, React.ReactNode> = { prepared: <MessageCircle className="size-3.5" />, queued: <Clock className="size-3.5" />, sent: <Check className="size-3.5" />, delivered: <CheckCheck className="size-3.5" />, read: <CheckCheck className="size-3.5 text-sky-500" />, failed: <XCircle className="size-3.5 text-destructive" /> };

export default function WhatsAppPage() {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'));
  const ls = useListState();
  const { customerName, userName } = useLookups();
  const [sendOpen, setSendOpen] = React.useState(false);
  const [tplOpen, setTplOpen] = React.useState<WhatsAppTemplate | null>(null);
  const [tplBody, setTplBody] = React.useState({ ar: '', en: '' });
  const q = useQuery({ queryKey: ['whatsapp', 'messages', ls.query], queryFn: () => whatsappService.messages({ ...ls.query, status: ls.filters.status as MessageStatus | undefined, templateKey: ls.filters.templateKey as WhatsAppTemplateKey | undefined }), refetchInterval: 3000 });
  const stats = useQuery({ queryKey: ['whatsapp', 'stats'], queryFn: whatsappService.stats, refetchInterval: 3000 });
  const templates = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: whatsappService.templates });

  const columns = React.useMemo<ColumnDef<WhatsAppMessage, unknown>[]>(() => [
    { accessorKey: 'sentAt', header: t('common.date'), cell: ({ row }) => <span className="num text-xs">{formatDateTime(row.original.sentAt, locale)}</span> },
    { id: 'customer', header: t('whatsapp.recipient'), cell: ({ row }) => <div><Link to={`/customers/${row.original.customerId}`} className="font-medium hover:underline">{customerName(row.original.customerId)}</Link><div className="text-[10px] text-muted-foreground num" dir="ltr">{row.original.phone}</div></div> },
    { accessorKey: 'templateKey', header: t('whatsapp.template'), cell: ({ row }) => <StatusBadge status="open" label={t(`whatsapp.templateKeys.${row.original.templateKey}`)} /> },
    { accessorKey: 'body', header: t('whatsapp.body'), cell: ({ row }) => <span className="line-clamp-1 max-w-md text-xs text-muted-foreground" title={row.original.body}>{row.original.body}</span> },
    { id: 'user', header: t('common.user'), cell: ({ row }) => <span className="text-xs">{userName(row.original.userId)}</span> },
    { accessorKey: 'status', header: t('common.status'), cell: ({ row }) => <div className="flex items-center gap-1.5"><span>{statusIcon[row.original.status]}</span><StatusBadge status={row.original.status} labelKey="whatsapp.status" />{row.original.status === 'failed' ? <Button size="xs" variant="ghost" title={row.original.error} onClick={async () => {
      try {
        const message = await whatsappService.retry(row.original.id);
        if (message.status === 'failed') toast.error(message.error || t('whatsapp.sendFailed'));
        else { if (message.link) window.open(message.link, '_blank', 'noopener'); toast.info(t(message.status === 'prepared' ? 'whatsapp.messagePrepared' : 'whatsapp.messageSent')); }
        q.refetch();
      } catch (error) { toast.error((error as Error).message); }
    }}><RefreshCw /></Button> : null}</div> },
  ], [t, locale, customerName, userName, q]);

  if (stats.isLoading) return <PageLoading />;
  if (stats.isError || !stats.data) return <ErrorState onRetry={stats.refetch} />;

  return (
    <div>
      <PageHeader title={t('whatsapp.title')} subtitle={t('whatsapp.subtitle')} actions={<Button className="bg-green-600 text-white hover:bg-green-700" onClick={() => setSendOpen(true)}><Send /> {t('whatsapp.send')}</Button>} />
      {stats.data?.mode === 'web' || stats.data?.mode === 'cloud' ? <Alert variant="info" icon={<Plug />} className="mb-4">{t(stats.data.mode === 'web' ? 'whatsapp.webNotice' : 'whatsapp.cloudNotice')}</Alert> : null}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title={t('whatsapp.messages')} value={stats.data?.total ?? 0} format="number" icon={<MessageCircle />} variant="success" />
        <StatCard title={t('whatsapp.sentToday')} value={stats.data?.sentToday ?? 0} format="number" icon={<Send />} />
        <StatCard title={t('whatsapp.deliveryRate')} value={stats.data?.deliveryRate == null ? '—' : `${Math.round(stats.data.deliveryRate)}%`} icon={<CheckCheck />} variant="info" />
        <StatCard title={t('whatsapp.failedCount')} value={stats.data?.failed ?? 0} format="number" icon={<XCircle />} variant="destructive" hint={`${stats.data?.queued ?? 0} ${t('whatsapp.status.queued')}`} />
      </div>
      <Tabs defaultValue="messages">
        <TabsList><TabsTrigger value="messages">{t('whatsapp.messages')}</TabsTrigger><TabsTrigger value="templates">{t('whatsapp.templates')}</TabsTrigger></TabsList>
        <TabsContent value="messages">
          <DataTable columns={columns} data={q.data?.data ?? []} total={q.data?.total} page={ls.page} pageSize={ls.pageSize} onPageChange={ls.setPage} onPageSizeChange={ls.setPageSize} isLoading={q.isLoading} isError={q.isError} onRetry={q.refetch} getRowId={(m) => m.id} dense
            toolbar={<><SearchInput value={ls.search} onChange={ls.setSearch} /><FilterBar activeCount={ls.activeFilterCount} onClear={ls.clearFilters}><FilterSelect value={ls.filters.status} onChange={(v) => ls.setFilter('status', v)} options={(['prepared', 'queued', 'sent', 'delivered', 'read', 'failed'] as const).map((s) => ({ value: s, label: t(`whatsapp.status.${s}`) }))} allLabel={t('common.status')} width="w-32" /><FilterSelect value={ls.filters.templateKey} onChange={(v) => ls.setFilter('templateKey', v)} options={(templates.data ?? []).map((x) => ({ value: x.key, label: tx(x.name) }))} allLabel={t('whatsapp.template')} /></FilterBar></>} />
        </TabsContent>
        <TabsContent value="templates">
          <div className="grid gap-3 md:grid-cols-2">
            {templates.data?.map((tp) => (
              <Section key={tp.key} title={tx(tp.name)} actions={<div className="flex items-center gap-2"><Switch disabled={!canEdit} checked={tp.isActive} onCheckedChange={async (v) => { await whatsappService.saveTemplate(tp.key, { isActive: v }); templates.refetch(); }} /><Button disabled={!canEdit} size="icon-xs" variant="ghost" onClick={() => { setTplOpen(tp); setTplBody({ ar: tp.body.ar, en: tp.body.en ?? '' }); }}><Pencil /></Button></div>}>
                <div className="rounded-lg bg-[#e7f5df] p-3 text-sm dark:bg-green-950/40 whitespace-pre-wrap">{tx(tp.body)}</div>
                <div className="mt-2 flex flex-wrap gap-1">{tp.variables.map((v) => <Badge key={v} variant="outline" className="font-mono">{`{${v}}`}</Badge>)}</div>
              </Section>
            ))}
          </div>
        </TabsContent>
      </Tabs>
      <SendWhatsAppDialog open={sendOpen} onOpenChange={setSendOpen} />
      <Dialog open={!!tplOpen} onOpenChange={(o) => !o && setTplOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader><DialogTitle>{t('whatsapp.editTemplate')} — {tplOpen ? tx(tplOpen.name) : ''}</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div><label className="text-xs text-muted-foreground">العربية</label><Textarea value={tplBody.ar} onChange={(e) => setTplBody({ ...tplBody, ar: e.target.value })} rows={6} dir="rtl" /></div>
            <div><label className="text-xs text-muted-foreground">English</label><Textarea value={tplBody.en} onChange={(e) => setTplBody({ ...tplBody, en: e.target.value })} rows={6} dir="ltr" /></div>
          </div>
          <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">{t('whatsapp.variables')}: {tplOpen?.variables.map((v) => <Badge key={v} variant="outline" className="font-mono">{`{${v}}`}</Badge>)}</div>
          <DialogFooter><Button variant="outline" onClick={() => setTplOpen(null)}>{t('common.cancel')}</Button><Button onClick={async () => { if (!tplOpen) return; await whatsappService.saveTemplate(tplOpen.key, { body: tplBody }); toast.success(t('whatsapp.templateSaved')); qc.invalidateQueries({ queryKey: ['whatsapp', 'templates'] }); setTplOpen(null); }}>{t('common.save')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
