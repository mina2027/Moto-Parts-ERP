import type { Category, PriceTier } from '@moto/shared';
import { productCategoryIds } from '@moto/shared';
import type { PosProduct } from './adapter';

export type StockFilter = 'all' | 'in' | 'low' | 'out';
export type CatalogSort = 'name' | 'priceAsc' | 'priceDesc' | 'stock';

export interface CatalogFilters {
  term: string;
  categoryId: string | null;
  brandId: string | null;
  modelId: string | null;
  stock: StockFilter;
  sort: CatalogSort;
}

export const EMPTY_FILTERS: CatalogFilters = { term: '', categoryId: null, brandId: null, modelId: null, stock: 'all', sort: 'name' };

export function hasActiveFilters(f: CatalogFilters): boolean {
  return Boolean(f.term.trim() || f.categoryId || f.brandId || f.modelId || f.stock !== 'all');
}

export function stockStateOf(p: Pick<PosProduct, 'available' | 'minStock'>): Exclude<StockFilter, 'all'> {
  return p.available <= 0 ? 'out' : p.available < p.minStock ? 'low' : 'in';
}

/** A category and all of its descendants, so picking a parent includes its sub-categories. */
export function categoryScope(categories: Category[], rootId: string): Set<string> {
  const scope = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of categories) {
      if (c.parentId && scope.has(c.parentId) && !scope.has(c.id)) {
        scope.add(c.id);
        grew = true;
      }
    }
  }
  return scope;
}

// Arabic-insensitive matching: unify alef/yaa/taa-marbuta forms and drop diacritics/tatweel.
const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .trim();

/** Filters and sorts the local catalog. Every word of the search term must match some product field. */
export function filterCatalog(products: PosProduct[], f: CatalogFilters, opts: { categories?: Category[]; tier?: PriceTier; locale?: 'ar' | 'en' } = {}): PosProduct[] {
  const words = normalize(f.term).split(/\s+/).filter(Boolean);
  const cats = f.categoryId ? categoryScope(opts.categories ?? [], f.categoryId) : null;
  const tier = opts.tier ?? 'retail1';
  const out = products.filter((p) => {
    if (p.isActive === false) return false;
    if (cats && !productCategoryIds(p).some(id => cats.has(id))) return false;
    if (f.brandId && p.brandId !== f.brandId) return false;
    if (f.modelId && !(p.compatibleModelIds ?? []).includes(f.modelId)) return false;
    if (f.stock !== 'all' && stockStateOf(p) !== f.stock) return false;
    if (words.length) {
      const hay = normalize([p.name.ar, p.name.en, p.sku, p.partNumber, p.internalBarcode, p.legacyBarcode, p.size].filter(Boolean).join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const name = (p: PosProduct) => (opts.locale === 'en' && p.name.en) || p.name.ar;
  const collator = new Intl.Collator(opts.locale === 'en' ? 'en' : 'ar');
  const sorters: Record<CatalogSort, (a: PosProduct, b: PosProduct) => number> = {
    name: (a, b) => collator.compare(name(a), name(b)),
    priceAsc: (a, b) => a.prices[tier] - b.prices[tier] || collator.compare(name(a), name(b)),
    priceDesc: (a, b) => b.prices[tier] - a.prices[tier] || collator.compare(name(a), name(b)),
    stock: (a, b) => b.available - a.available || collator.compare(name(a), name(b)),
  };
  return out.sort(sorters[f.sort]);
}
