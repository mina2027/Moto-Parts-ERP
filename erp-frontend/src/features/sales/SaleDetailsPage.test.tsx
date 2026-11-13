import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { DEFAULT_SETTINGS } from '@moto/shared';
import type { Product, Sale } from '@/types';
import { useUiStore } from '@/stores/uiStore';
import SaleDetailsPage from './SaleDetailsPage';

const sale: Sale = {
  id: 's1', invoiceNumber: 'INV-1', date: '2026-01-01T00:00:00.000Z', branchId: 'br1', cashierId: 'u1',
  customerId: null, registerSessionId: 'sess1',
  items: [{ id: 'i1', productId: 'p1', name: { ar: 'تيل فرامل', en: 'Brake pads' }, barcode: 'MP1', sku: 'S1', quantity: 1, listPrice: 100, unitPrice: 100, unitCost: 40, priceTier: 'retail1', discount: 0, discountPercent: 0, subtotal: 100, returnedQty: 0 }],
  subtotal: 100, itemDiscounts: 0, invoiceDiscount: 0,
  tax: 0, total: 100, paid: 100, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 100 }],
  type: 'cash', status: 'completed',
};
let canPrint = true;
const product: Product = {
  id: 'p1', name: sale.items[0]!.name, internalBarcode: 'MP1', sku: 'S1', partNumber: '', brandId: 'brand1', categoryId: 'category1', supplierId: '',
  purchasePrice: 40, lastPurchaseCost: 40, prices: { retail1: 100, retail2: 90, wholesale: 80 }, minStock: 0,
  unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '',
};

vi.mock('@/services', () => ({ salesService: { get: vi.fn(async () => sale), returns: vi.fn(async () => ({ data: [] })) } }));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS, isLoading: false }) }));
vi.mock('@/hooks/useLookups', () => ({ useLookups: () => ({
  branchName: () => 'Branch', userName: () => 'Cashier', customerName: () => '', product: () => null,
  branches: [], users: [], customers: [], products: [product], models: [],
  brands: [{ id: 'brand1', name: { ar: 'ماركة الاختبار', en: 'Test brand' }, country: { ar: '' } }],
  categories: [{ id: 'category1', name: { ar: 'فئة الاختبار', en: 'Test category' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true }],
}) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (select: (state: { session: { user: { id: string } }; hasPermission: (permission: string) => boolean }) => unknown) => select({
  session: { user: { id: 'u1' } }, hasPermission: (permission) => permission === 'sales.print' && canPrint,
}) }));
vi.mock('@/features/whatsapp/SendWhatsAppDialog', () => ({ SendWhatsAppDialog: () => null }));

beforeEach(() => { canPrint = true; useUiStore.setState({ locale: 'en' }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); useUiStore.setState({ locale: 'ar' }); });

async function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/sales/s1']}><Routes><Route path="/sales/:id" element={<SaleDetailsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
  await screen.findByRole('button', { name: 'Reprint' });
}

describe('printing invoices from ERP sale details', () => {
  it.each([
    ['Reprint', /Small invoice.*80mm/, 'mpt', '80mm'],
    ['Reprint', /Large invoice.*A4/, 'mpi', '210mm 297mm'],
    ['Print', /Small invoice.*80mm/, 'mpt', '80mm'],
    ['Print', /Large invoice.*A4/, 'mpi', '210mm 297mm'],
  ])('offers both sizes before the %s action prints %s', async (entry, size, className, page) => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const document = window.document.querySelector('.invoice-print-document')!;
      expect(document.querySelector(`.${className}`)).toBeTruthy();
      expect(document.textContent).toContain(sale.invoiceNumber);
      const table = document.querySelector('table')!;
      if (className === 'mpi') {
        const headings = Array.from(table.querySelectorAll('thead th'), (th) => th.textContent);
        expect(headings.slice(2, 5)).toEqual(['Brand', 'Category', 'Barcode / SKU']);
        const cells = table.querySelectorAll('tbody tr:first-child td');
        expect(cells[2]!.textContent).toBe('Test brand');
        expect(cells[3]!.textContent).toBe('Test category');
        expect(cells[4]!.textContent).toBe('MP1');
      } else {
        expect(table.textContent).not.toContain('Test brand');
        expect(table.textContent).not.toContain('Test category');
      }
      expect(document.querySelector('button')).toBeNull();
      expect(window.document.body.lastElementChild?.textContent).toContain(`size: ${page}`);
    });
    await mount();
    fireEvent.click(screen.getByRole('button', { name: entry }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: size }));
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(print).toHaveBeenCalledOnce());
    expect(window.document.querySelector('.invoice-print-document')).toBeNull();
  });

  it('cancels the size picker without printing', async () => {
    const print = vi.spyOn(window, 'print');
    await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Reprint' }));
    fireEvent.click(screen.getByText('Close', { selector: 'button' }));
    expect(print).not.toHaveBeenCalled();
  });

  it('requires invoice print permission for both entry points', async () => {
    canPrint = false;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/sales/s1']}><Routes><Route path="/sales/:id" element={<SaleDetailsPage />} /></Routes></MemoryRouter></QueryClientProvider>);
    await screen.findByRole('heading', { name: sale.invoiceNumber });
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
  });
});
