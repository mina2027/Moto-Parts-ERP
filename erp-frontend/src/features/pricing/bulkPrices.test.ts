import { describe, expect, it, vi } from 'vitest';
import type { ProductWithStock } from '@/services/productService';
import { bulkPriceTargets } from './bulkPrices';

const product = (id: string, categoryId = 'c1', isActive = true) => ({ id, categoryId, isActive }) as ProductWithStock;
describe('bulk pricing targets', () => {
  it('fetches selected products independently of the displayed page', async () => {
    const get = vi.fn(async (id: string) => product(id));
    const all = vi.fn(async () => []);
    expect(await bulkPriceTargets({ get, all }, { outsidePage: true, unchecked: false }, 'all')).toEqual([product('outsidePage')]);
    expect(get).toHaveBeenCalledOnce();
    expect(all).not.toHaveBeenCalled();
  });
  it('applies category scope to the full active catalogue', async () => {
    const all = vi.fn(async () => [product('p1'), product('p2'), product('p3', 'c2'), product('inactive', 'c1', false)]);
    expect((await bulkPriceTargets({ get: vi.fn(), all }, {}, 'c1')).map((p) => p.id)).toEqual(['p1', 'p2']);
  });
  it('includes secondary categories without duplicating products or including inactive products', async () => {
    const multi = { ...product('multi'), categoryIds: ['c1', 'c2', 'c2'] };
    const all = vi.fn(async () => [multi, product('legacy', 'c2'), product('outside'), { ...product('inactive', 'c1', false), categoryIds: ['c1', 'c2'] }]);
    expect((await bulkPriceTargets({ get: vi.fn(), all }, {}, 'c2')).map((p) => p.id)).toEqual(['multi', 'legacy']);
  });
  it('surfaces missing selected products before applying any prices', async () => {
    await expect(bulkPriceTargets({ get: vi.fn().mockRejectedValue(new Error('missing')), all: vi.fn() }, { missing: true }, 'all')).rejects.toThrow('missing');
  });
});
