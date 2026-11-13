import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageCircle, Send } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Alert } from '@/components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField } from '@/components/shared/form';
import { Combobox } from '@/components/shared/pickers';
import { customerService, whatsappService } from '@/services';
import { renderTemplate } from '@/services/whatsappService';
import { useAuthStore } from '@/stores/authStore';
import { useLookups } from '@/hooks/useLookups';
import { useSettings } from '@/hooks/useSettings';
import { useT } from '@/i18n';
import { formatDate, formatMoney } from '@/lib/utils';
import type { Customer, Sale, WhatsAppTemplateKey } from '@/types';

export function SendWhatsAppDialog({ open, onOpenChange, customer, sale, defaultTemplate }: { open: boolean; onOpenChange: (o: boolean) => void; customer?: Customer | null; sale?: Sale | null; defaultTemplate?: WhatsAppTemplateKey }) {
  const { t, tx, locale } = useT();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.session!.user);
  const { options, customers } = useLookups();
  const { settings } = useSettings();
  const [customerId, setCustomerId] = React.useState<string | null>(customer?.id ?? null);
  const [templateKey, setTemplateKey] = React.useState<WhatsAppTemplateKey>(defaultTemplate ?? (sale ? 'invoice' : 'statement'));
  const [body, setBody] = React.useState('');
  const [edited, setEdited] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const mode = useQuery({ queryKey: ['whatsapp', 'stats'], queryFn: whatsappService.stats, enabled: open });
  const templates = useQuery({ queryKey: ['whatsapp', 'templates'], queryFn: whatsappService.templates });

  const cust = customerId ? customers.find((c) => c.id === customerId) ?? (customer?.id === customerId ? customer : null) : null;
  const debtsQ = useQuery({
    queryKey: ['debts', { customerId: cust?.id }],
    queryFn: () => customerService.debts({ customerId: cust!.id, pageSize: 100 }),
    select: (response) => response.data,
    enabled: open && !!cust,
  });

  React.useEffect(() => { if (open) { setCustomerId(customer?.id ?? null); setTemplateKey(defaultTemplate ?? (sale ? 'invoice' : 'statement')); setEdited(false); } }, [open, customer, sale, defaultTemplate]);

  React.useEffect(() => {
    if (edited) return;
    const tpl = templates.data?.find((x) => x.key === templateKey);
    if (!tpl || !cust) { setBody(''); return; }
    const debt = (debtsQ.data ?? []).filter((d) => d.customerId === cust.id && d.remaining > 0).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))[0];
    const vars: Record<string, string | number> = {
      customer: tx(cust.name), company: tx(settings.company.name), date: formatDate(new Date(), locale), balance: formatMoney(cust.balance, locale),
    };
    if (sale || debt) {
      vars.invoice = sale?.invoiceNumber ?? debt!.invoiceNumber;
      vars.total = formatMoney(sale?.total ?? debt!.originalAmount, locale);
      vars.paid = formatMoney(sale?.paid ?? debt!.paidAmount, locale);
      vars.remaining = formatMoney(sale?.remaining ?? debt!.remaining, locale);
    }
    if (debt) vars.days = Math.max(0, Math.floor((Date.now() - new Date(debt.dueDate).getTime()) / 86400000));
    // Unknown payment/offer fields stay visibly unresolved until the operator enters actual values.
    setBody(renderTemplate(tx(tpl.body), vars));
  }, [templateKey, cust, templates.data, debtsQ.data, settings, locale, tx, sale, edited]);

  const send = async () => {
    if (!cust) return;
    setSending(true);
    try {
      const message = await whatsappService.send({ customerId: cust.id, phone: cust.whatsapp, templateKey, body, userId: user.id, referenceId: sale?.id });
      // Deep-link mode hands back a wa.me URL that the operator completes in WhatsApp Web.
      if (message.status === 'failed') { toast.error(message.error || t('whatsapp.sendFailed')); qc.invalidateQueries({ queryKey: ['whatsapp'] }); return; }
      if (message.link) window.open(message.link, '_blank', 'noopener');
      toast.success(t(message.status === 'prepared' ? 'whatsapp.messagePrepared' : 'whatsapp.messageSent'));
      qc.invalidateQueries({ queryKey: ['whatsapp'] });
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSending(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><MessageCircle className="size-5 text-green-600" /> {t('whatsapp.send')}</DialogTitle>
          <DialogDescription>{mode.data ? t(mode.data.mode === 'cloud' ? 'whatsapp.cloudNotice' : 'whatsapp.webNotice') : t('common.loading')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {!customer ? <FormField label={t('whatsapp.recipient')} required><Combobox value={customerId} onChange={setCustomerId} options={options.customers} placeholder={t('common.selectCustomer')} /></FormField> : null}
          {cust ? (
            <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="font-medium">{tx(cust.name)}</span>
              <span className="num text-muted-foreground" dir="ltr">{cust.whatsapp || '—'}</span>
            </div>
          ) : null}
          {cust && !cust.whatsapp ? <Alert variant="destructive">{t('whatsapp.noWhatsapp')}</Alert> : null}
          <FormField label={t('whatsapp.template')}>
            <Select value={templateKey} onValueChange={(v) => { setTemplateKey(v as WhatsAppTemplateKey); setEdited(false); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{templates.data?.filter((x) => x.isActive).map((x) => <SelectItem key={x.key} value={x.key}>{tx(x.name)}</SelectItem>)}</SelectContent>
            </Select>
          </FormField>
          <FormField label={t('whatsapp.preview')}>
            <div className="rounded-lg bg-[#e7f5df] p-3 dark:bg-green-950/40">
              <Textarea value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} rows={6} className="border-0 bg-transparent shadow-none focus-visible:ring-0" />
              <div className="mt-1 text-end text-[10px] text-muted-foreground">{t('whatsapp.preview')}</div>
            </div>
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={send} disabled={!cust?.whatsapp || !body.trim() || /\{[a-zA-Z_]+\}/.test(body) || !mode.data} loading={sending}><Send /> {t(mode.data?.mode === 'web' ? 'whatsapp.openWhatsapp' : 'common.send')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
