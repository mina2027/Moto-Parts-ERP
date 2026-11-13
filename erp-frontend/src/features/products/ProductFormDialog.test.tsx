import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS, type Product } from '@moto/shared';

const mocks = vi.hoisted(() => ({ update: vi.fn(), create: vi.fn(), addCategory: vi.fn() }));
vi.mock('@/services', async () => ({
  ApiError: (await import('@moto/api-client')).ApiError,
  productService: { update: mocks.update, create: mocks.create, addCategory: mocks.addCategory, stockLevels: async () => [] },
}));
vi.mock('@/hooks/useLookups', () => ({ useLookups: () => ({
  warehouses: [], options: { brands: [{ value: 'brand-1', label: 'ماركة' }], categories: [{ value: 'cat-1', label: 'تصنيف' }, { value: 'cat-2', label: 'فئة ثانية' }, { value: 'cat-3', label: 'فئة ثالثة' }], suppliers: [] },
}) }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (state: { hasPermission: () => boolean }) => unknown) => selector({ hasPermission: () => true }),
  useCurrentUser: () => ({ id: 'admin', branchId: 'br-1' }),
}));
vi.mock('@/components/shared/barcode', () => ({ Barcode: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ProductFormDialog } from './ProductFormDialog';

const product: Product = {
  id: 'prod-1', name: { ar: 'فلتر زيت' }, sku: 'SKU-1', internalBarcode: 'MP1', partNumber: '',
  brandId: 'brand-1', categoryId: 'cat-1', supplierId: '', purchasePrice: 10, lastPurchaseCost: 10,
  prices: { retail1: 20, retail2: 18, wholesale: 15 }, minStock: 2, unit: { ar: 'قطعة' },
  compatibleModelIds: [], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  mocks.update.mockImplementation(async (_id, patch) => ({ ...product, ...patch }));
  mocks.create.mockImplementation(async payload => ({ ...product, ...payload }));
  mocks.addCategory.mockResolvedValue({ id: 'cat-new', name: { ar: 'قسم جديد للاختبار' } });
});

describe('multiple product categories', () => {
  const mount = (value: Product | null = product, defaultCategoryId?: string) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={qc}><ProductFormDialog open onOpenChange={() => undefined} product={value} defaultCategoryId={defaultCategoryId} /></QueryClientProvider>);
  };

  it('adds a second category to a legacy product and saves both selections', async () => {
    mount();
    expect(screen.getByRole('button', { name: 'حذف: تصنيف' })).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'الفئات' }));
    fireEvent.click(await screen.findByRole('button', { name: 'فئة ثانية' }));
    expect(screen.getByRole('button', { name: 'حذف: فئة ثانية' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(product.id, expect.objectContaining({ categoryId: 'cat-1', categoryIds: ['cat-1', 'cat-2'] }), undefined, ''));
  });

  it('restores all selections and removes a category when editing', async () => {
    mount({ ...product, categoryIds: ['cat-1', 'cat-2', 'cat-3'] });
    fireEvent.click(screen.getByRole('button', { name: 'حذف: تصنيف' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(product.id, expect.objectContaining({ categoryId: 'cat-2', categoryIds: ['cat-2', 'cat-3'] }), undefined, ''));
  });

  it('requires at least one category', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'حذف: تصنيف' }));
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await screen.findByText('هذا الحقل مطلوب');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('creates a product in two categories from the category page', async () => {
    mount(null, 'cat-1');
    fireEvent.change(screen.getByLabelText(/الاسم بالعربية/), { target: { value: 'منتج جديد' } });
    fireEvent.change(screen.getByLabelText(/SKU/), { target: { value: 'NEW-1' } });
    fireEvent.keyDown(document.getElementById('brandId')!, { key: 'Enter' });
    fireEvent.keyDown(await screen.findByRole('option', { name: 'ماركة' }), { key: 'Enter' });
    await screen.findByRole('combobox', { name: 'الفئات' });
    fireEvent.click(screen.getByRole('combobox', { name: 'الفئات' }));
    fireEvent.click(await screen.findByRole('button', { name: 'فئة ثانية' }));
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'التسعير' }), { button: 0 });
    fireEvent.change(screen.getByRole('spinbutton', { name: /قطاعي 1/ }), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ categoryId: 'cat-1', categoryIds: ['cat-1', 'cat-2'] })));
  });

  it('keeps previous selections when a new category is created inline', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'قسم جديد' }));
    fireEvent.change(screen.getByPlaceholderText('اسم القسم...'), { target: { value: 'قسم جديد للاختبار' } });
    fireEvent.click(screen.getByRole('button', { name: 'إضافة' }));
    await screen.findByRole('button', { name: 'حذف: الفئة' });
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(product.id, expect.objectContaining({ categoryIds: ['cat-1', 'cat-new'] }), undefined, ''));
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('product quick visibility', () => {
  it.each([true, false])('saves the changed choice when the initial value is %s', async (initial) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    const onOpenChange = vi.fn();
    render(<QueryClientProvider client={qc}><ProductFormDialog open onOpenChange={onOpenChange} product={{ ...product, isQuickProduct: initial }} /></QueryClientProvider>);
    const toggle = await screen.findByRole('switch', { name: 'إظهار في المنتجات السريعة' });
    expect(toggle).toHaveAttribute('aria-checked', String(initial));
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('button', { name: 'حفظ' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(product.id, expect.objectContaining({ isQuickProduct: !initial }), undefined, ''));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['pos', 'catalog'] });
  });

  it('keeps legacy products visible and resets the choice for the next product', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={qc}><ProductFormDialog open onOpenChange={() => undefined} product={{ ...product, isQuickProduct: false }} /></QueryClientProvider>);
    expect(await screen.findByRole('switch', { name: 'إظهار في المنتجات السريعة' })).toHaveAttribute('aria-checked', 'false');
    view.rerender(<QueryClientProvider client={qc}><ProductFormDialog open onOpenChange={() => undefined} product={product} /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'إظهار في المنتجات السريعة' })).toHaveAttribute('aria-checked', 'true'));
  });
});
