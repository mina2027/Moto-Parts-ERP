import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrintProfiles } from '@moto/shared';
import type { PaperKind } from '@moto/shared';
import { createWebPosAdapter } from './webAdapter';

const catalogApi = vi.hoisted(() => ({ all: vi.fn(), categories: vi.fn(), brands: vi.fn(), models: vi.fn() }));
const salesApi = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/services', () => ({ api: { products: catalogApi, sales: salesApi }, devicePrintPref: {} }));

afterEach(() => vi.restoreAllMocks());

describe('POS product catalog', () => {
  it('loads branch products, stock and shelf directly without quick-grid endpoints', async () => {
    catalogApi.all.mockResolvedValueOnce([{ id: 'p1', branchStock: { br1: 12 }, saleStock: 7, saleLocation: 'رف 3' }]);
    const adapter = createWebPosAdapter({ user: {} as Parameters<typeof createWebPosAdapter>[0]['user'], permissions: [], branchId: 'br1', locale: 'ar', navigate: () => undefined, branchName: () => '' });
    expect(await adapter.catalog()).toMatchObject([{ id: 'p1', available: 7, location: 'رف 3' }]);
    expect(catalogApi.all).toHaveBeenCalledWith('br1');
  });

  it('loads categories, brands and motorcycle models for the desktop product filters', async () => {
    const metadata = { categories: [{ id: 'category-1' }], brands: [{ id: 'brand-1' }], models: [{ id: 'model-1' }] };
    catalogApi.categories.mockResolvedValueOnce(metadata.categories);
    catalogApi.brands.mockResolvedValueOnce(metadata.brands);
    catalogApi.models.mockResolvedValueOnce(metadata.models);
    const adapter = createWebPosAdapter({ user: {} as Parameters<typeof createWebPosAdapter>[0]['user'], permissions: [], branchId: 'br1', locale: 'ar', navigate: () => undefined, branchName: () => '' });
    expect(await adapter.catalogMeta!()).toEqual(metadata);
  });
});

describe('POS sales history', () => {
  it('searches and pages the full history on the server within the current branch', async () => {
    const page = { data: [{ id: 'old-sale' }], total: 205, page: 2, pageSize: 100 };
    salesApi.list.mockResolvedValueOnce(page);
    const adapter = createWebPosAdapter({ user: {} as Parameters<typeof createWebPosAdapter>[0]['user'], permissions: [], branchId: 'br1', locale: 'ar', navigate: () => undefined, branchName: () => '' });
    expect(await adapter.salesHistory!({ page: 2, pageSize: 100, search: 'تيل فرامل' })).toEqual(page);
    expect(salesApi.list).toHaveBeenCalledWith({ branchId: 'br1', page: 2, pageSize: 100, search: 'تيل فرامل' });
  });
});

describe('browser invoice paper dimensions', () => {
  it.each([
    ['thermal80', '@page { size: 80mm 304mm; margin: 0mm; }'],
    ['a4', '@page { size: 210mm 297mm; margin: 0mm; }'],
  ] as const)('prints %s with its exact page dimensions', async (paper: PaperKind, expectedPage) => {
    const adapter = createWebPosAdapter({ user: {} as Parameters<typeof createWebPosAdapter>[0]['user'], permissions: [], branchId: 'br1', locale: 'ar', navigate: () => undefined, branchName: () => '' });
    const element = document.createElement('div');
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ height: 300 * 96 / 25.4 } as DOMRect);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(document.body.lastElementChild?.textContent).toContain(expectedPage);
      expect(document.querySelector('.invoice-print-document')?.firstElementChild).not.toBe(element);
    });
    const profile = defaultPrintProfiles().find((p) => p.paper === paper)!;
    await adapter.print(element, profile);
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.querySelector('style')).toBeNull();
    expect(document.querySelector('.invoice-print-document')).toBeNull();
  });

  it('removes the temporary page size when printing fails', async () => {
    const adapter = createWebPosAdapter({ user: {} as Parameters<typeof createWebPosAdapter>[0]['user'], permissions: [], branchId: 'br1', locale: 'ar', navigate: () => undefined, branchName: () => '' });
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('Print failed'); });
    await expect(adapter.print(document.createElement('div'), defaultPrintProfiles()[0])).rejects.toThrow('Print failed');
    expect(document.body.querySelector('style')).toBeNull();
    expect(document.querySelector('.invoice-print-document')).toBeNull();
  });
});
