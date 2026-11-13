import { describe, expect, it } from 'vitest';
import type { Category } from '@moto/shared';
import type { PosProduct } from './adapter';
import { EMPTY_FILTERS, categoryScope, filterCatalog, hasActiveFilters, stockStateOf } from './catalogFilter';

const prod = (id: string, over: Partial<PosProduct> = {}): PosProduct => ({
  id,
  name: { ar: `منتج ${id}` },
  internalBarcode: `MP${id}`,
  sku: `SKU-${id}`,
  partNumber: `PN-${id}`,
  brandId: 'b1',
  categoryId: 'c1',
  supplierId: 's1',
  purchasePrice: 10,
  lastPurchaseCost: 10,
  prices: { retail1: 100, retail2: 90, wholesale: 80 },
  minStock: 5,
  unit: { ar: 'قطعة' },
  compatibleModelIds: [],
  alternativeProductIds: [],
  isActive: true,
  createdAt: '',
  updatedAt: '',
  available: 10,
  ...over,
});

const catalog: PosProduct[] = [
  prod('1', { name: { ar: 'تيل فرامل أمامي', en: 'Front brake pads' }, brandId: 'honda', categoryId: 'brakes', compatibleModelIds: ['cg125'], prices: { retail1: 85, retail2: 80, wholesale: 70 }, available: 12 }),
  prod('2', { name: { ar: 'تيل فرامل خلفي' }, brandId: 'bajaj', categoryId: 'brakes-rear', compatibleModelIds: ['boxer'], prices: { retail1: 60, retail2: 55, wholesale: 50 }, available: 2 }),
  prod('3', { name: { ar: 'بوجيه NGK' }, brandId: 'ngk', categoryId: 'electric', size: 'CR7HSA', prices: { retail1: 60, retail2: 58, wholesale: 50 }, available: 0 }),
  prod('4', { name: { ar: 'زيت محرك' }, brandId: 'honda', categoryId: 'oil', isActive: false }),
  prod('5', { name: { ar: 'إطار أمامي' }, brandId: 'honda', categoryId: 'tires', size: '90/90-17', prices: { retail1: 950, retail2: 900, wholesale: 850 }, available: 30 }),
];

it('matches every assigned category and their parents without duplicating a product', () => {
  const multi = prod('multi', { categoryId: 'brakes', categoryIds: ['brakes', 'electric-child', 'electric-child'] });
  const categories: Category[] = [
    { id: 'electric', name: { ar: 'كهرباء' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true },
    { id: 'electric-child', name: { ar: 'إشعال' }, parentId: 'electric', ancestors: ['electric'], sortOrder: 0, isActive: true },
  ];
  for (const categoryId of ['brakes', 'electric-child', 'electric']) {
    expect(filterCatalog([multi], { ...EMPTY_FILTERS, categoryId }, { categories }).map(p => p.id)).toEqual(['multi']);
  }
  expect(filterCatalog([prod('legacy')], { ...EMPTY_FILTERS, categoryId: 'c1' }).map(p => p.id)).toEqual(['legacy']);
  expect(filterCatalog([multi], { ...EMPTY_FILTERS, categoryId: 'oil' }, { categories })).toEqual([]);
});
const cat = (id: string, ar: string, parentId: string | null, sortOrder: number): Category => ({ id, name: { ar }, parentId, ancestors: parentId ? [parentId] : [], sortOrder, isActive: true });
const categories: Category[] = [
  cat('brakes', 'فرامل', null, 0),
  cat('brakes-rear', 'فرامل خلفية', 'brakes', 0),
  cat('electric', 'كهرباء', null, 1),
];
const ids = (list: PosProduct[]) => list.map((p) => p.id);

describe('filterCatalog', () => {
  it('hides inactive products and sorts by name by default', () => {
    expect(ids(filterCatalog(catalog, EMPTY_FILTERS))).toEqual(['5', '3', '1', '2']);
  });

  it('matches every search word across name, codes and size, ignoring Arabic letter variants', () => {
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, term: 'تيل امامي' }))).toEqual(['1']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, term: 'اطار' }))).toEqual(['5']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, term: 'cr7hsa' }))).toEqual(['3']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, term: 'brake' }))).toEqual(['1']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, term: 'PN-2' }))).toEqual(['2']);
  });

  it('includes sub-categories when filtering by a parent category', () => {
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, categoryId: 'brakes' }, { categories }))).toEqual(['1', '2']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, categoryId: 'brakes-rear' }, { categories }))).toEqual(['2']);
    expect([...categoryScope(categories, 'brakes')].sort()).toEqual(['brakes', 'brakes-rear']);
  });

  it('filters by brand, fitment model and stock state', () => {
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, brandId: 'honda' }))).toEqual(['5', '1']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, modelId: 'boxer' }))).toEqual(['2']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, stock: 'out' }))).toEqual(['3']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, stock: 'low' }))).toEqual(['2']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, stock: 'in' }))).toEqual(['5', '1']);
  });

  it('sorts by the active price tier and by stock', () => {
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, sort: 'priceAsc' }, { tier: 'wholesale' }))).toEqual(['3', '2', '1', '5']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, sort: 'priceDesc' }))).toEqual(['5', '1', '3', '2']);
    expect(ids(filterCatalog(catalog, { ...EMPTY_FILTERS, sort: 'stock' }))).toEqual(['5', '1', '2', '3']);
  });

  it('reports stock state and active filters', () => {
    expect(stockStateOf({ available: 0, minStock: 5 })).toBe('out');
    expect(stockStateOf({ available: 3, minStock: 5 })).toBe('low');
    expect(stockStateOf({ available: 5, minStock: 5 })).toBe('in');
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, sort: 'stock' })).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, stock: 'low' })).toBe(true);
  });
});
