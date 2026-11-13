import { useId } from 'react';
import type { Brand, Category, MotorcycleModel } from '@moto/shared';
import { Button, Input, cn } from '@moto/ui';
import { ChevronDown, ChevronUp, Filter, Search, X } from 'lucide-react';
import { EMPTY_FILTERS, type CatalogFilters } from '../catalogFilter';
import { usePosT } from '../i18n';

interface ProductFiltersProps {
  value: CatalogFilters;
  onChange: (filters: CatalogFilters) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadata?: { categories: Category[]; brands: Brand[]; models: MotorcycleModel[] };
  disabled?: boolean;
}

export function ProductFilters({ value, onChange, open, onOpenChange, metadata, disabled }: ProductFiltersProps) {
  const { p, tx } = usePosT();
  const contentId = useId();
  const labels = p.catalogFilters;
  const selectClass = 'h-9 min-w-0 w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
  const change = (update: Partial<CatalogFilters>) => onChange({ ...value, ...update });
  return (
    <section className="pos-product-filters shrink-0 border-b bg-card p-2" aria-label={labels.title}>
      <div className={cn('flex flex-wrap items-center justify-between gap-2', open && 'mb-2')}>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Filter className="size-4" />{labels.title}</h3>
        <div className="flex items-center gap-1">
          <Button type="button" size="xs" variant="ghost" disabled={disabled} onClick={() => onChange({ ...EMPTY_FILTERS })}><X className="size-3" />{labels.reset}</Button>
          <Button type="button" size="xs" variant="outline" disabled={disabled} onClick={() => onOpenChange(!open)} aria-expanded={open} aria-controls={contentId}>
            {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}{open ? labels.hide : labels.show}
          </Button>
        </div>
      </div>
      <div id={contentId} hidden={!open}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Input value={value.term} onChange={(event) => change({ term: event.target.value })} aria-label={labels.search} placeholder={p.productSearch} startIcon={<Search />} disabled={disabled} autoComplete="off" data-scanner-ignore />
        {([
          ['categoryId', labels.category, labels.allCategories, metadata?.categories ?? []],
          ['brandId', labels.brand, labels.allBrands, metadata?.brands ?? []],
          ['modelId', labels.model, labels.allModels, metadata?.models ?? []],
        ] as const).map(([key, label, all, options]) => (
          <select key={key} className={selectClass} aria-label={label} value={value[key] ?? ''} disabled={disabled} onChange={(event) => change({ [key]: event.target.value || null })}>
            <option value="">{all}</option>
            {options.map((option) => <option key={option.id} value={option.id}>{tx(option.name)}</option>)}
          </select>
        ))}
        <select className={selectClass} aria-label={labels.stock} value={value.stock} disabled={disabled} onChange={(event) => change({ stock: event.target.value as CatalogFilters['stock'] })}>
          <option value="all">{labels.allStock}</option><option value="in">{labels.inStock}</option><option value="low">{labels.lowStock}</option><option value="out">{labels.outOfStock}</option>
        </select>
        <select className={selectClass} aria-label={labels.sort} value={value.sort} disabled={disabled} onChange={(event) => change({ sort: event.target.value as CatalogFilters['sort'] })}>
          <option value="name">{labels.name}</option><option value="priceAsc">{labels.priceAsc}</option><option value="priceDesc">{labels.priceDesc}</option><option value="stock">{labels.stockDesc}</option>
        </select>
      </div>
      </div>
    </section>
  );
}
