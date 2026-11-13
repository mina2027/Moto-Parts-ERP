import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_SETTINGS } from '@moto/shared';
import { toast } from 'sonner';
import { ApiError } from '@moto/api-client';

const mocks = vi.hoisted(() => ({ deleteProduct: vi.fn(), canEdit: true }));
const product = {
  id: 'prod-1', name: { ar: 'منتج تجريبي' }, sku: 'SKU-1', internalBarcode: '123456789012', partNumber: 'PART-1',
  brandId: 'brand-1', categoryId: 'cat-1', purchasePrice: 10, lastPurchaseCost: 10,
  prices: { retail1: 20, retail2: 18, wholesale: 15 }, minStock: 0, totalStock: 0, stockStatus: 'out',
  unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
vi.mock('@/services', async () => ({
  ApiError: (await import('@moto/api-client')).ApiError,
  productService: { get: async () => product, stockLevels: async () => [], priceHistory: async () => [], delete: mocks.deleteProduct },
  inventoryService: { movementsForProduct: async () => [] },
  reportService: { auditLogs: async () => ({ data: [] }) },
  purchaseService: { list: async () => ({ data: [] }) },
  salesService: { list: async () => ({ data: [] }) },
}));
vi.mock('@/hooks/useLookups', () => ({ useLookups: () => ({ brandName: () => '', categoryName: () => '', supplierName: () => '', models: [], options: { products: [] } }) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ session: { user: { id: 'admin' } }, hasPermission: () => mocks.canEdit }) }));
vi.mock('./ProductFormDialog', () => ({ ProductFormDialog: () => null }));
vi.mock('@/components/shared/barcode', () => ({ Barcode: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ProductDetailsPage from './ProductDetailsPage';

beforeEach(() => { vi.clearAllMocks(); mocks.canEdit = true; });
afterEach(cleanup);

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={['/products/prod-1']}><Routes>
    <Route path="/products/:id" element={<ProductDetailsPage />} />
    <Route path="/products" element={<div>قائمة المنتجات</div>} />
  </Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('heading', { name: 'منتج تجريبي' });
  return qc;
}

describe('product delete action', () => {
  it('places delete next to disable and lets the user cancel without deleting', async () => {
    await mount();
    const button = screen.getByRole('button', { name: 'حذف المنتج' });
    expect(button.previousElementSibling).toHaveTextContent('تعطيل');
    fireEvent.click(button);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('منتج تجريبي');
    expect(mocks.deleteProduct).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocks.deleteProduct).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation, disables repeat clicks and returns to the refreshed list', async () => {
    let complete!: (value: { ok: true }) => void;
    mocks.deleteProduct.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    const qc = await mount();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'حذف المنتج' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'حذف المنتج' }));
    await waitFor(() => expect(mocks.deleteProduct).toHaveBeenCalledWith('prod-1'));
    expect(screen.getByRole('button', { name: 'حذف المنتج' })).toBeDisabled();
    complete({ ok: true });
    await screen.findByText('قائمة المنتجات');
    expect(toast.success).toHaveBeenCalledWith('تم الحذف');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['products'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['inventory'] });
    expect(qc.getQueryData(['product', 'prod-1'])).toBeNull();
    expect(mocks.deleteProduct).toHaveBeenCalledTimes(1);
  });

  it('reports a failed deletion and leaves the product available to retry', async () => {
    mocks.deleteProduct.mockRejectedValueOnce(new Error('تعذر الاتصال بالخادم'));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'حذف المنتج' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'حذف المنتج' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('تعذر الاتصال بالخادم'));
    expect(screen.getByRole('heading', { name: 'منتج تجريبي' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'حذف المنتج' })).toBeEnabled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('hides delete from users without product editing permissions', async () => {
    mocks.canEdit = false;
    await mount();
    expect(screen.queryByRole('button', { name: 'حذف المنتج' })).not.toBeInTheDocument();
  });

  it.each([
    ['PRODUCT_HAS_STOCK', 'لا يمكن حذف المنتج لأن له رصيدًا في أحد المخازن. سوِّ رصيد المخزون أولًا.'],
    ['PRODUCT_HAS_RESERVATIONS', 'لا يمكن حذف المنتج لأن له كمية محجوزة. ألغِ الحجز أولًا.'],
  ])('explains why deletion was blocked: %s', async (code, message) => {
    mocks.deleteProduct.mockRejectedValueOnce(new ApiError('Server conflict', 409, code));
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'حذف المنتج' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'حذف المنتج' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(screen.getByRole('heading', { name: 'منتج تجريبي' })).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
