import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StockCountDialog } from './StockCountDialog';

const mocks = vi.hoisted(() => ({ createCount: vi.fn() }));
vi.mock('@/services', () => ({ inventoryService: { createCount: mocks.createCount } }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (s: unknown) => unknown) => selector({ session: { user: { id: 'u1', branchId: 'b1' } }, hasPermission: () => false }) }));
vi.mock('@/hooks/useLookups', () => ({ useLookups: () => ({
  options: { categories: [], activeBranches: [] },
  warehouses: [{ id: 'main', branchId: 'b1', isMain: true, name: { ar: 'Main' } }, { id: 'shop', branchId: 'b1', isMain: false, name: { ar: 'Shop' } }],
  products: [{ id: 'selected', categoryId: 'c1', isActive: true }, { id: 'other', categoryId: 'c1', isActive: true }],
  categoryName: () => '',
}) }));
vi.mock('@/i18n', () => ({ useT: () => ({ t: (key: string) => key, tx: (value: { ar: string }) => value.ar }) }));
afterEach(cleanup);
describe('contextual stock counts', () => {
  it('submits only the contextual product in the selected warehouse', async () => {
    mocks.createCount.mockResolvedValue({ id: 'count1' });
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/inventory']}><Routes>
      <Route path="/inventory" element={<StockCountDialog open onOpenChange={() => undefined} initialProductIds={['selected']} initialBranchId="b1" initialWarehouseId="shop" />} />
      <Route path="/inventory/counts/count1" element={<span>Count created</span>} />
    </Routes></MemoryRouter></QueryClientProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'inventory.startCount' }));
    await waitFor(() => expect(mocks.createCount).toHaveBeenCalledWith({ branchId: 'b1', warehouseId: 'shop', userId: 'u1', productIds: ['selected'] }));
    await waitFor(() => expect(screen.getByText('Count created')).toBeInTheDocument());
  });
});
