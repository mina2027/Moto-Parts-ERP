import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package, Receipt, Search, Truck, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/misc';
import { ALL_NAV_ITEMS } from '@/config/navigation';
import { reportService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { cn, formatMoney } from '@/lib/utils';

type Item = { id: string; group: string; label: string; sub?: string; icon: React.ReactNode; path: string };

export function GlobalSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const [q, setQ] = React.useState('');
  const [active, setActive] = React.useState(0);
  const term = q.trim().toLowerCase();
  const search = useQuery({ queryKey: ['search', term], queryFn: () => reportService.globalSearch(term), enabled: term.length >= 2 });
  const r = search.data;

  const items = React.useMemo<Item[]>(() => {
    const out: Item[] = [];
    const pages = ALL_NAV_ITEMS.filter((n) => (!n.permission || hasPermission(n.permission)) && (!term || t(n.labelKey).toLowerCase().includes(term) || n.path.includes(term))).slice(0, term ? 4 : 8);
    for (const p of pages) out.push({ id: `page-${p.key}`, group: t('header.searchPages'), label: t(p.labelKey), icon: <p.icon className="size-4" />, path: p.path });
    if (term.length >= 2 && r) {
      for (const p of r.products) out.push({ id: p.id, group: t('header.searchProducts'), label: tx(p.name), sub: `${p.sku} · ${p.internalBarcode} · ${formatMoney(p.prices.retail1, locale)}`, icon: <Package className="size-4" />, path: `/products/${p.id}` });
      for (const s of r.sales) out.push({ id: s.id, group: t('header.searchInvoices'), label: s.invoiceNumber, sub: formatMoney(s.total, locale), icon: <Receipt className="size-4" />, path: `/sales/${s.id}` });
      for (const c of r.customers) out.push({ id: c.id, group: t('header.searchCustomers'), label: tx(c.name), sub: c.phone, icon: <Users className="size-4" />, path: `/customers/${c.id}` });
      for (const s of r.suppliers) out.push({ id: s.id, group: t('nav.suppliers'), label: tx(s.name), sub: s.phone, icon: <Truck className="size-4" />, path: `/suppliers/${s.id}` });
    }
    return out;
  }, [term, r, t, tx, locale, hasPermission]);

  React.useEffect(() => setActive(0), [q]);
  React.useEffect(() => { if (!open) setQ(''); }, [open]);

  const go = (it: Item) => { onOpenChange(false); navigate(it.path); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    if (e.key === 'Enter' && items[active]) go(items[active]);
  };

  let lastGroup = '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-0 p-0" hideClose>
        <DialogTitle className="sr-only">{t('common.search')}</DialogTitle>
        <div className="border-b p-2">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder={t('header.searchHint')} className="h-10 border-0 shadow-none focus-visible:ring-0" startIcon={<Search />} />
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {items.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{t('header.noSearchResults')}</div> : null}
          {items.map((it, i) => {
            const showGroup = it.group !== lastGroup;
            lastGroup = it.group;
            return (
              <React.Fragment key={it.id}>
                {showGroup ? <div className="px-2 pb-1 pt-2 text-[10px] font-semibold uppercase text-muted-foreground">{it.group}</div> : null}
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(it)} className={cn('flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm', i === active && 'bg-accent')}>
                  <span className="text-muted-foreground">{it.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{it.label}</span>
                    {it.sub ? <span className="block truncate text-xs text-muted-foreground">{it.sub}</span> : null}
                  </span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          <span><Kbd>↑↓</Kbd> {t('pos.navigate')}</span>
          <span><Kbd>↵</Kbd> {t('common.open')}</span>
          <span><Kbd>Esc</Kbd> {t('common.close')}</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
