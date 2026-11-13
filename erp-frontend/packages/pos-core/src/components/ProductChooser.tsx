import * as React from 'react';
import type { AppSettings, PriceTier } from '@moto/shared';
import { Button, Input, Popover, PopoverContent, PopoverTrigger, cn } from '@moto/ui';
import { ChevronDown, Search } from 'lucide-react';
import type { PosProduct } from '../adapter';
import { EMPTY_FILTERS, filterCatalog, type CatalogSort } from '../catalogFilter';
import { formatMoney, usePosT } from '../i18n';

interface ProductChooserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  catalog: PosProduct[];
  categoryLabel?: (product: PosProduct) => string;
  brandLabel?: (product: PosProduct) => string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  settings: AppSettings;
  tier: PriceTier;
  sort?: CatalogSort;
  current?: string;
  label?: string;
  onPick: (product: PosProduct) => void;
}

export function ProductChooser({ open, onOpenChange, catalog, categoryLabel, brandLabel, loading, error, onRetry, settings, tier, sort = 'name', current, label, onPick }: ProductChooserProps) {
  const { p, tx, locale } = usePosT();
  const [term, setTerm] = React.useState('');
  const [limit, setLimit] = React.useState(100);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listId = React.useId();
  const products = React.useMemo(() => filterCatalog(catalog, { ...EMPTY_FILTERS, term, sort }, { tier, locale }), [catalog, term, tier, sort, locale]);
  return (
    <Popover open={open} onOpenChange={(value) => { if (value) { setTerm(''); setLimit(100); } onOpenChange(value); }}>
      <PopoverTrigger asChild ref={triggerRef}>
        <button type="button" aria-label={label ? `${p.changeProduct}: ${label}` : p.selectProduct} className="flex w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2 py-2 text-start text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={(e) => e.stopPropagation()}>
          <span className="min-w-0 break-words">{label ?? p.selectProduct}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-2" dir={locale === 'ar' ? 'rtl' : 'ltr'} onCloseAutoFocus={(e) => { e.preventDefault(); triggerRef.current?.focus({ preventScroll: true }); }}>
        <Input value={term} onChange={(e) => { setTerm(e.target.value); setLimit(100); }} placeholder={p.productSearch} aria-label={p.search} startIcon={<Search />} autoComplete="off" aria-controls={listId} />
        <div id={listId} role="listbox" aria-label={p.selectProduct} className="mt-2 max-h-72 overflow-y-auto">
          {loading ? <div role="status" className="p-3 text-sm text-muted-foreground">{p.loading}</div> : error ? (
            <div className="p-3 text-sm"><p role="alert">{p.catalogLoadError}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry}>{p.retryPrint}</Button></div>
          ) : products.length === 0 ? <div className="p-3 text-sm text-muted-foreground">{p.noProducts}</div> : products.slice(0, limit).map((prod) => (
            <button key={prod.id} type="button" role="option" aria-selected={current === prod.id} disabled={prod.available <= 0} onClick={() => onPick(prod)} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:opacity-50', current === prod.id && 'bg-primary/10')}>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">{tx(prod.name)}</span>
                <span className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{p.catalogFilters.category}: {categoryLabel?.(prod) || '—'}</span>
                  <span>{p.catalogFilters.brand}: {brandLabel?.(prod) || '—'}</span>
                  <span>{p.stock}: <bdi className="num">{prod.available}</bdi></span>
                  <span>{p.shelf}: {prod.location || '—'}</span>
                </span>
                {prod.partNumber ? <span className="block text-[10px] text-muted-foreground"><bdi className="num">{prod.partNumber}</bdi></span> : null}
              </span>
              <span className="shrink-0 text-xs font-medium num">{formatMoney(prod.prices[tier], locale, settings.currency.symbol, settings.currency.decimals)}</span>
            </button>
          ))}
        </div>
        {products.length > limit ? <Button type="button" size="sm" variant="ghost" className="mt-1 w-full" onClick={() => setLimit((v) => v + 100)}>{p.showMore}</Button> : null}
      </PopoverContent>
    </Popover>
  );
}
