import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mocks = vi.hoisted(() => ({ all: vi.fn(async () => [
  { id: 'live', name: { ar: 'منتج متاح' }, sku: 'LIVE', isActive: true, deletedAt: null },
  { id: 'archived', name: { ar: 'منتج قديم' }, sku: 'OLD', isActive: false, deletedAt: '2026-01-01T00:00:00Z' },
]) }));
vi.mock('@/services', () => ({
  productService: { all: mocks.all, brands: async () => [], categories: async () => [], models: async () => [] },
  branchService: { list: async () => [], allUsers: async () => [], expenseCategories: async () => [], registers: async () => [] },
  customerService: { all: async () => [] }, supplierService: { all: async () => [] }, inventoryService: { warehouses: async () => [] },
}));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ status: 'authenticated', hasPermission: () => true }) }));

import { useLookups } from './useLookups';
afterEach(cleanup);

it('retains archived names for historical documents while excluding them from product pickers', async () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(useLookups, { wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
  await waitFor(() => expect(result.current.productName('archived')).toBe('منتج قديم'));
  expect(mocks.all).toHaveBeenCalledWith(undefined, true);
  expect(result.current.options.products.map((p) => p.value)).toEqual(['live']);
});
