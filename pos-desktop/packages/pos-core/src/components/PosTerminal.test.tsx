import { beforeEach, describe, expect, it, vi } from 'vitest';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ALL_PERMISSIONS, DEFAULT_SETTINGS } from '@moto/shared';
import type { Customer, RegisterSession, Sale, User } from '@moto/shared';
import { TooltipProvider } from '@moto/ui';
import type { PosAdapter, PosProduct } from '../adapter';
import { createPosStore, type PosStore } from '../store';
import { PosTerminal } from './PosTerminal';
import { toast } from 'sonner';

const user: User = {
  id: 'u1', username: 'cashier', fullName: { ar: 'كاشير' }, email: '', phone: '', role: 'cashier',
  branchId: 'br1', status: 'active', avatarColor: '#000', lastLogin: null, createdAt: '2026-01-01T00:00:00.000Z',
};

const product: PosProduct = {
  id: 'p1', name: { ar: 'تيل فرامل' }, internalBarcode: 'MP1', sku: 'S1', partNumber: 'P1',
  brandId: 'b1', categoryId: 'c1', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2,
  unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true,
  createdAt: '', updatedAt: '', prices: { retail1: 100, retail2: 90, wholesale: 80 }, available: 10,
};

const session: RegisterSession = {
  id: 'sess1', registerId: 'r1', branchId: 'br1', userId: 'u1', openedAt: '2026-01-01T00:00:00.000Z', closedAt: null,
  openingBalance: 0, cashSales: 0, cardSales: 0, transferSales: 0, paymentsIn: 0, paymentsOut: 0, expenses: 0,
  refunds: 0, expectedCash: 0, actualCash: null, difference: null, status: 'open', movements: [],
};

const sale: Sale = {
  id: 's1', invoiceNumber: 'INV-1', date: '2026-01-01T00:00:00.000Z', branchId: 'br1', cashierId: 'u1',
  customerId: null, registerSessionId: 'sess1', items: [], subtotal: 100, itemDiscounts: 0, invoiceDiscount: 0,
  tax: 0, total: 100, paid: 100, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 100 }],
  type: 'cash', status: 'completed',
};

const saleWithItem: Sale = {
  ...sale,
  items: [{ id: 'i1', productId: product.id, name: product.name, barcode: product.internalBarcode, sku: product.sku, partNumber: product.partNumber,
    quantity: 1, listPrice: 100, unitPrice: 100, unitCost: 40, priceTier: 'retail1', discount: 0, discountPercent: 0, subtotal: 100, returnedQty: 0 }],
};
const printCatalogMeta = async () => ({
  brands: [{ id: 'b1', name: { ar: 'ماركة الاختبار' }, country: { ar: '' } }],
  categories: [{ id: 'c1', name: { ar: 'فئة الاختبار' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true }],
  models: [],
});

function expectPrintedCatalogColumns(element: HTMLElement, paper: string) {
  const table = element.querySelector('table')!;
  if (paper === 'a4') {
    const headings = Array.from(table.querySelectorAll('thead th'), (th) => th.textContent);
    expect(headings.slice(2, 5)).toEqual(['الماركة', 'الفئة', 'الباركود / SKU']);
    const cells = table.querySelectorAll('tbody tr:first-child td');
    expect(cells[2]!.textContent).toBe('ماركة الاختبار');
    expect(cells[3]!.textContent).toBe('فئة الاختبار');
    expect(cells[4]!.textContent).toBe(product.internalBarcode);
  } else {
    expect(table.textContent).not.toContain('ماركة الاختبار');
    expect(table.textContent).not.toContain('فئة الاختبار');
  }
}

function fakeAdapter(over: Partial<PosAdapter> = {}): PosAdapter {
  return {
    user,
    permissions: [...ALL_PERMISSIONS],
    branchId: 'br1',
    locale: 'ar',
    settings: async () => DEFAULT_SETTINGS,
    lookup: async () => ({ products: [], legacyHit: false }),
    product: async () => product,
    customers: async () => [],
    createCustomer: async () => {
      throw new Error('not used');
    },
    specialPrices: async () => [],
    catalog: async () => [product],
    currentSession: async () => session,
    createSale: async () => {
      throw new Error('not used');
    },
    lastSale: async () => null,
    alternatives: async () => [],
    print: async () => undefined,
    navigate: vi.fn(),
    connectivity: () => ({ online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null }),
    subscribeConnectivity: () => () => undefined,
    ...over,
  };
}

async function mount(store: PosStore, over: Partial<PosAdapter> = {}, printOnComplete = true, suspended = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <PosTerminal adapter={fakeAdapter(over)} store={store} printOnComplete={printOnComplete} suspended={suspended} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText('إتمام البيع')).toBeTruthy());
  return view;
}

async function openPayment() {
  fireEvent.click(screen.getByText('إتمام البيع'));
  await waitFor(() => expect(screen.getByText('إتمام الدفع')).toBeTruthy());
}

function cartStore() {
  // The store persists to localStorage, so a stale `held` list would leak into the next test.
  localStorage.clear();
  const store = createPosStore();
  store.getState().addLine({
    productId: product.id, name: product.name, barcode: product.internalBarcode, sku: product.sku,
    partNumber: product.partNumber, listPrice: 100, unitPrice: 100, unitCost: 40, priceTier: 'retail1',
    discountPercent: 0, quantity: 1, available: 10,
  });
  return store;
}

describe('PosTerminal invoice rows and sales history', () => {
  beforeEach(() => localStorage.clear());

  it('submits the selected credit sale and resets the next invoice to cash', async () => {
    const store = cartStore();
    const customer: Customer = { id: 'c1', code: 'C1', name: { ar: 'عميل آجل' }, phone: '', whatsapp: '', address: { ar: '' }, type: 'retail', creditLimit: 500, balance: 0, branchId: 'br1', isActive: true, createdAt: '' };
    store.getState().setCustomer(customer);
    const createSale = vi.fn(async (_input: Parameters<PosAdapter['createSale']>[0]) => ({ ...sale, customerId: customer.id, type: 'credit' as const, paid: 0, remaining: 100, payments: [] }));
    await mount(store, { customers: async () => [customer], createSale }, false);
    fireEvent.click(screen.getByRole('button', { name: 'آجل' }));
    expect(store.getState().saleType).toBe('credit');
    await openPayment();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /إتمام البيع/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(createSale.mock.calls[0][0]).toMatchObject({ type: 'credit', customerId: customer.id, payments: [] });
    await waitFor(() => expect(store.getState().lines).toHaveLength(0));
    expect(store.getState().saleType).toBe('cash');
  });

  it('asks for a customer before opening credit payment', async () => {
    const createSale = vi.fn();
    await mount(cartStore(), { createSale }, false);
    fireEvent.click(screen.getByRole('button', { name: 'آجل' }));
    fireEvent.click(screen.getByText('إتمام البيع'));
    expect(screen.queryByText('إتمام الدفع')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(createSale).not.toHaveBeenCalled();
  });

  const second: PosProduct = { ...product, id: 'p2', name: { ar: 'فلتر زيت' }, sku: 'S2', internalBarcode: 'MP2', prices: { retail1: 60, retail2: 50, wholesale: 45 }, location: 'رف 3', available: 6 };
  const catalog = async () => [product, second];

  it('refreshes category assignments on focus and shows the product in every category without changing the invoice', async () => {
    const store = cartStore();
    let snapshot = product;
    const loadCatalog = vi.fn(async () => [snapshot]);
    const categories = ['c1', 'c2'].map((id) => ({ id, name: { ar: id }, parentId: null, ancestors: [], sortOrder: 0, isActive: true }));
    await mount(store, { catalog: loadCatalog, catalogMeta: async () => ({ categories, brands: [], models: [] }) });
    const filters = screen.getByRole('region', { name: 'فلترة المنتجات' });
    const quick = screen.getByRole('region', { name: 'المنتجات السريعة' });
    const category = within(filters).getByRole('combobox', { name: 'التصنيف' });
    await within(filters).findByRole('option', { name: 'c2' });
    fireEvent.change(category, { target: { value: 'c2' } });
    expect(within(quick).queryByRole('button', { name: `إضافة منتج سريع: ${product.name.ar}` })).toBeNull();
    snapshot = { ...product, categoryIds: ['c1', 'c2'] };
    try {
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      for (const value of ['c2', 'c1']) {
        fireEvent.change(category, { target: { value } });
        await within(quick).findByRole('button', { name: `إضافة منتج سريع: ${product.name.ar}` });
        fireEvent.click(screen.getByRole('button', { name: 'اختر المنتج' }));
        expect(within(screen.getByRole('listbox')).getByRole('option', { name: new RegExp(product.name.ar) })).toBeTruthy();
        fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
      }
      expect(loadCatalog.mock.calls.length).toBeGreaterThan(1);
      expect(store.getState().lines).toMatchObject([{ productId: product.id, quantity: 1 }]);
    } finally {
      focusManager.setFocused(undefined);
    }
  });

  it('filters quick products and product choices from the top without changing the invoice', async () => {
    const store = cartStore();
    const available = { ...product, compatibleModelIds: ['m1'] };
    const low = { ...second, categoryId: 'c2', brandId: 'b2', compatibleModelIds: ['m2'], minStock: 10 };
    const metadata = {
      categories: [{ id: 'c1', name: { ar: 'فرامل' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true }, { id: 'c2', name: { ar: 'فلاتر' }, parentId: null, ancestors: [], sortOrder: 1, isActive: true }],
      brands: [{ id: 'b1', name: { ar: 'ماركة 1' }, country: { ar: '' } }, { id: 'b2', name: { ar: 'ماركة 2' }, country: { ar: '' } }],
      models: [{ id: 'm1', name: { ar: 'موديل 1' }, code: 'M1', manufacturer: '', engineCc: 125, years: '' }, { id: 'm2', name: { ar: 'موديل 2' }, code: 'M2', manufacturer: '', engineCc: 150, years: '' }],
    };
    await mount(store, { catalog: async () => [available, low], catalogMeta: async () => metadata });
    const filters = screen.getByRole('region', { name: 'فلترة المنتجات' });
    const quick = screen.getByRole('region', { name: 'المنتجات السريعة' });
    await within(filters).findByRole('option', { name: 'فرامل' });
    for (const [label, value] of [['التصنيف', 'c2'], ['الماركة', 'b2'], ['الموديل', 'm2'], ['حالة المخزون', 'low']]) {
      fireEvent.change(within(filters).getByRole('combobox', { name: label }), { target: { value } });
      expect(within(quick).queryByRole('button', { name: 'إضافة منتج سريع: تيل فرامل' })).toBeNull();
      expect(within(quick).getByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' })).toBeTruthy();
      fireEvent.click(within(filters).getByRole('button', { name: 'مسح الفلاتر' }));
    }
    fireEvent.change(within(filters).getByRole('textbox'), { target: { value: 'فلتر' } });
    fireEvent.click(screen.getByRole('button', { name: 'اختر المنتج' }));
    const choices = screen.getByRole('listbox');
    expect(within(choices).queryByRole('option', { name: /تيل فرامل/ })).toBeNull();
    expect(within(choices).getByRole('option', { name: /فلتر زيت/ })).toBeTruthy();
    expect(store.getState().lines).toMatchObject([{ productId: 'p1', quantity: 1 }]);
  });

  it('keeps multiline invoice notes editable without interpreting typing as a barcode', async () => {
    const store = cartStore();
    const lookup = vi.fn();
    const createSale = vi.fn(async (input: Parameters<PosAdapter['createSale']>[0]) => ({ ...sale, notes: input.notes }));
    await mount(store, { createSale, lookup }, false);
    const notes = screen.getByRole('textbox', { name: 'ملاحظات الفاتورة' });
    fireEvent.change(notes, { target: { value: 'تسليم غداً\nيرجى الاتصال قبل التسليم' } });
    for (const key of 'ABCD') fireEvent.keyDown(notes, { key });
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    notes.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(lookup).not.toHaveBeenCalled();
    await openPayment();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /إتمام البيع/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(createSale.mock.calls[0][0].notes).toBe('تسليم غداً\nيرجى الاتصال قبل التسليم');
    await waitFor(() => expect(store.getState().notes).toBe(''));
  });

  it('hides barcode and SKU below product names while keeping stock and shelf details', async () => {
    await mount(cartStore());
    const row = screen.getByRole('button', { name: 'تغيير المنتج: تيل فرامل' }).closest('tr')!;
    expect(row.textContent).not.toContain('الباركود');
    expect(row.textContent).not.toContain('كود الصنف');
    expect(row.textContent).not.toContain('MP1');
    expect(row.textContent).not.toContain('S1');
    expect(row.textContent).toContain('المخزون');
    expect(row.textContent).toContain('الرف');
  });

  it('keeps product editing available without filter tabs or their old shortcuts', async () => {
    const store = cartStore();
    const loadCatalog = vi.fn(catalog);
    await mount(store, { catalog: loadCatalog });
    expect(loadCatalog).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('الأصناف السريعة')).toBeNull();
    expect(screen.queryByText('تصفية المنتجات')).toBeNull();
    fireEvent.keyDown(window, { key: 'F5' });
    fireEvent.keyDown(window, { key: 'F11' });
    expect(screen.getByRole('region', { name: 'المنتجات' })).toBeTruthy();
    expect(store.getState().lines).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'الاختصارات' }));
    const help = screen.getByRole('dialog');
    expect(within(help).queryByText('F5')).toBeNull();
    expect(within(help).queryByText('F11')).toBeNull();
  });

  it('adds quick products at their catalog price and stops at available stock', async () => {
    const store = cartStore();
    const soldOut = { ...product, id: 'p0', name: { ar: 'منتج نفد' }, available: 0 };
    const inactive = { ...product, id: 'inactive', name: { ar: 'منتج متوقف' }, isActive: false };
    await mount(store, { catalog: async () => [product, second, soldOut, inactive], settings: async () => ({ ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, showTierChooserOnScan: false } }) });
    const quick = screen.getByRole('region', { name: 'المنتجات السريعة' });
    const add = await within(quick).findByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' });
    expect(add.textContent).toContain('60.00');
    expect(add.textContent).toContain('المخزون: 6');
    expect(add.textContent).toContain('الرف: رف 3');
    expect((within(quick).getByRole('button', { name: 'إضافة منتج سريع: منتج نفد' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(quick).queryByRole('button', { name: 'إضافة منتج سريع: منتج متوقف' })).toBeNull();
    for (let i = 0; i < 6; i++) fireEvent.click(add);
    expect(store.getState().lines.find((line) => line.productId === second.id)).toMatchObject({ quantity: 6, unitPrice: 60, priceTier: 'retail1' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(add);
    expect(store.getState().lines.find((line) => line.productId === second.id)?.quantity).toBe(6);
    fireEvent.click(screen.getByRole('button', { name: 'نقص الكمية: فلتر زيت' }));
    expect((add as HTMLButtonElement).disabled).toBe(false);
  });

  it('hides excluded quick products while allowing them to be searched and sold', async () => {
    const store = createPosStore();
    const excluded = { ...second, isQuickProduct: false };
    await mount(store, { catalog: async () => [product, excluded] });
    const quick = screen.getByRole('region', { name: 'المنتجات السريعة' });
    await within(quick).findByRole('button', { name: 'إضافة منتج سريع: تيل فرامل' });
    expect(within(quick).queryByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: 'البحث عن المنتجات' }), { target: { value: 'فلتر' } });
    expect(within(quick).queryByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'اختر المنتج' }));
    const option = await screen.findByRole('option', { name: /فلتر زيت/ });
    fireEvent.click(option);
    expect(store.getState().lines).toMatchObject([{ productId: second.id, quantity: 1, unitPrice: 60 }]);
  });

  it('folds quick products independently and restores the preference on remount', async () => {
    const store = cartStore();
    const view = await mount(store, { catalog });
    const editor = screen.getByRole('table', { name: 'المنتجات' });
    const collapse = screen.getByRole('button', { name: 'طيّ المنتجات السريعة' });
    fireEvent.click(collapse);
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' })).toBeNull();
    expect(editor.closest('[aria-hidden]')?.getAttribute('aria-hidden')).toBe('false');
    expect(store.getState().lines).toHaveLength(1);
    view.unmount();
    await mount(store, { catalog });
    const expand = screen.getByRole('button', { name: 'إظهار المنتجات السريعة' });
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(expand);
    expect(await screen.findByRole('button', { name: 'إضافة منتج سريع: فلتر زيت' })).toBeTruthy();
    expect(expand.getAttribute('aria-expanded')).toBe('true');
    expect(store.getState().lines).toHaveLength(1);
  });

  it('makes products beyond the initial quick grid available with show more', async () => {
    const products = Array.from({ length: 25 }, (_, i) => ({ ...product, id: `quick-${i}`, name: { ar: `منتج ${String(i).padStart(2, '0')}` } }));
    const store = createPosStore();
    await mount(store, { catalog: async () => products, settings: async () => ({ ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, showTierChooserOnScan: false } }) });
    const quick = screen.getByRole('region', { name: 'المنتجات السريعة' });
    const showMore = await within(quick).findByRole('button', { name: 'عرض المزيد' });
    expect(within(quick).queryByRole('button', { name: 'إضافة منتج سريع: منتج 24' })).toBeNull();
    fireEvent.click(showMore);
    fireEvent.click(within(quick).getByRole('button', { name: 'إضافة منتج سريع: منتج 24' }));
    expect(store.getState().lines).toMatchObject([{ productId: 'quick-24', quantity: 1 }]);
    expect(within(quick).queryByRole('button', { name: 'عرض المزيد' })).toBeNull();
  });

  it('applies the top customer type to all selected products, totals and later additions', async () => {
    const store = cartStore();
    store.getState().setQty(product.id, 2);
    const third = { ...second, id: 'p3', name: { ar: 'بوجيه' } };
    store.getState().addLine({ productId: second.id, name: second.name, barcode: second.internalBarcode, sku: second.sku, quantity: 3, unitPrice: 50, listPrice: 50, unitCost: 40, priceTier: 'retail2', discountPercent: 0, available: 6 });
    await mount(store, { catalog: async () => [product, second, third], settings: async () => ({ ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, showTierChooserOnScan: false } }) });
    const type = screen.getByRole('combobox', { name: 'نوع العميل' });
    const invoice = screen.getByRole('region', { name: 'تفاصيل الفاتورة' });
    expect(within(invoice).queryByRole('combobox', { name: 'نوع العميل' })).toBeNull();
    for (const [tier, firstPrice, secondPrice, total] of [['wholesale', 80, 45, '295.00'], ['retail2', 90, 50, '330.00'], ['retail1', 100, 60, '380.00']] as const) {
      fireEvent.change(type, { target: { value: tier } });
      await waitFor(() => expect(store.getState().priceTier).toBe(tier));
      expect(store.getState().lines).toMatchObject([{ quantity: 2, priceTier: tier, unitPrice: firstPrice, listPrice: firstPrice }, { quantity: 3, priceTier: tier, unitPrice: secondPrice, listPrice: secondPrice }]);
      expect(invoice.textContent).toContain(total);
    }
    fireEvent.change(type, { target: { value: 'retail2' } });
    await waitFor(() => expect(store.getState().priceTier).toBe('retail2'));
    const add = screen.getByRole('button', { name: 'إضافة منتج سريع: بوجيه' });
    expect(add.textContent).toContain('50.00');
    fireEvent.click(add);
    expect(store.getState().lines.find((line) => line.productId === third.id)).toMatchObject({ quantity: 1, unitPrice: 50, priceTier: 'retail2' });
    expect(invoice.textContent).toContain('380.00');
  });

  it('uses the selected whole-cart type for scanner additions even when the customer has special prices', async () => {
    const store = cartStore();
    const customer: Customer = { id: 'customer', code: 'C1', name: { ar: 'عميل اختبار' }, phone: '0100', whatsapp: '0100', address: { ar: '' }, type: 'retail', creditLimit: 0, balance: 0, branchId: 'br1', isActive: true, createdAt: '' };
    store.setState({ customer });
    store.getState().setLineTier(product.id, 'special', 70);
    const lookup = vi.fn(async () => ({ products: [second], legacyHit: false }));
    await mount(store, { catalog, lookup, specialPrices: async () => [product, second].map((prod) => ({ id: `special-${prod.id}`, customerId: customer.id, productId: prod.id, price: 30, validFrom: '2020-01-01T00:00:00Z', validTo: null })), settings: async () => ({ ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, showTierChooserOnScan: false } }) });
    fireEvent.change(screen.getByRole('combobox', { name: 'نوع العميل' }), { target: { value: 'wholesale' } });
    await waitFor(() => expect(store.getState().lines[0]).toMatchObject({ priceTier: 'wholesale', unitPrice: 80 }));
    for (const key of 'MP1234') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(store.getState().lines).toHaveLength(2));
    expect(store.getState().lines[1]).toMatchObject({ productId: second.id, priceTier: 'wholesale', unitPrice: 45 });
  });

  it('loads missing prices for restored cart lines and keeps all prices unchanged on lookup failure', async () => {
    const store = cartStore();
    store.getState().addLine({ productId: second.id, name: second.name, barcode: second.internalBarcode, sku: second.sku, quantity: 1, unitPrice: 60, listPrice: 60, unitCost: 40, priceTier: 'retail1', discountPercent: 0, available: 6 });
    const loadProduct = vi.fn<PosAdapter['product']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(second);
    await mount(store, { catalog: async () => [product], product: loadProduct });
    const type = screen.getByRole('combobox', { name: 'نوع العميل' });
    fireEvent.change(type, { target: { value: 'retail2' } });
    await waitFor(() => expect(loadProduct).toHaveBeenCalledOnce());
    await waitFor(() => expect((type as HTMLSelectElement).disabled).toBe(false));
    expect(store.getState()).toMatchObject({ priceTier: 'retail1', lines: [{ unitPrice: 100 }, { unitPrice: 60 }] });
    expect((type as HTMLSelectElement).value).toBe('retail1');
    fireEvent.change(type, { target: { value: 'retail2' } });
    await waitFor(() => expect(store.getState()).toMatchObject({ priceTier: 'retail2', lines: [{ unitPrice: 90 }, { unitPrice: 50 }] }));
    expect(loadProduct).toHaveBeenLastCalledWith(second.id);
  });

  it('limits the top customer type to the cashier price permissions', async () => {
    const store = cartStore();
    await mount(store, { permissions: ALL_PERMISSIONS.filter((permission) => permission !== 'prices.wholesale') });
    const type = screen.getByRole('combobox', { name: 'نوع العميل' });
    expect(within(type).getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['retail1', 'retail2']);
    fireEvent.change(type, { target: { value: 'wholesale' } });
    expect(store.getState()).toMatchObject({ priceTier: 'retail1', lines: [{ unitPrice: 100 }] });
  });

  it('offers invoice discounts while keeping catalog pricing and zero tax', async () => {
    const store = cartStore();
    await mount(store, { settings: async () => ({ ...DEFAULT_SETTINGS, invoice: { ...DEFAULT_SETTINGS.invoice, showTax: true, taxEnabled: true, taxRate: 14 } }) });
    const invoice = screen.getByRole('region', { name: 'تفاصيل الفاتورة' });
    expect(within(invoice).queryByText(/نوع السعر/)).toBeNull();
    expect(within(invoice).getByRole('button', { name: /خصم الفاتورة/ })).toBeTruthy();
    expect(screen.queryByText(/الضريبة/)).toBeNull();
    expect(screen.queryByRole('spinbutton', { name: /يدوي/ })).toBeNull();
    expect(within(invoice).getAllByText('100.00 ج.م')).toHaveLength(1);
    expect(within(invoice).getAllByText('الإجمالي')).toHaveLength(1);
    expect(within(invoice).queryByText('الصافي')).toBeNull();
    expect(within(invoice).queryByText(/صنف/)).toBeNull();
    expect(screen.getByRole('button', { name: 'نقدي' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'آجل' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'اختر السعر: تيل فرامل' }));
    expect(screen.getByRole('button', { name: /قطاعي 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /قطاعي 2/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /جملة/ })).toBeTruthy();
  });

  it('places product selection, quantity, price and value in the products section', async () => {
    await mount(cartStore(), { catalog });
    const products = screen.getByRole('region', { name: 'المنتجات' });
    const invoice = screen.getByRole('region', { name: 'تفاصيل الفاتورة' });
    expect(within(products).getByRole('button', { name: 'تغيير المنتج: تيل فرامل' })).toBeTruthy();
    expect(within(products).getByRole('spinbutton', { name: 'الكمية: تيل فرامل' })).toBeTruthy();
    expect(within(products).getByRole('button', { name: 'اختر السعر: تيل فرامل' })).toBeTruthy();
    expect(within(products).getByRole('columnheader', { name: 'القيمة' })).toBeTruthy();
    expect(within(invoice).queryByRole('table')).toBeNull();
    expect(within(invoice).getByRole('button', { name: /إتمام البيع/ })).toBeTruthy();
  });

  it('keeps top filters and barcode scanning at the default price', async () => {
    const store = cartStore();
    const lookup = vi.fn(async () => ({ products: [product], legacyHit: false }));
    await mount(store, { lookup });
    expect(screen.getByRole('textbox', { name: 'البحث عن المنتجات' })).toBeTruthy();
    expect(screen.queryByRole('spinbutton', { name: /خصم/ })).toBeNull();
    fireEvent.keyDown(window, { key: 'F2' });
    expect(screen.getByRole('textbox', { name: 'ملاحظات الفاتورة' })).toBeTruthy();
    for (const key of 'MP1234') fireEvent.keyDown(window, { key });
    fireEvent.keyDown(window, { key: 'Enter' });
    await waitFor(() => expect(store.getState().lines[0]?.quantity).toBe(2));
    expect(lookup).toHaveBeenCalledWith('MP1234');
    expect(store.getState().lines[0]).toMatchObject({ priceTier: 'retail1', unitPrice: 100 });
  });

  it('includes item discounts in the displayed value and checkout payload', async () => {
    const store = cartStore();
    store.setState({ lines: store.getState().lines.map(l => ({ ...l, discountPercent: 25 })) });
    const createSale = vi.fn(async (_input: Parameters<PosAdapter['createSale']>[0]) => sale);
    await mount(store, { createSale }, false);
    const row = screen.getByRole('button', { name: 'تغيير المنتج: تيل فرامل' }).closest('tr')!;
    expect(row.children[3].textContent).toContain('75.00');
    await openPayment();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /إتمام البيع/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(createSale.mock.calls[0]?.[0]).toMatchObject({ items: [{ discount: 25, discountPercent: 25 }], invoiceDiscount: 0 });
  });

  it('applies product percentage and invoice amount discounts and charges the resulting total', async () => {
    const store = cartStore();
    const createSale = vi.fn(async (_input: Parameters<PosAdapter['createSale']>[0]) => ({ ...sale, total: 85, paid: 85 }));
    await mount(store, { createSale }, false);
    fireEvent.click(screen.getByRole('button', { name: 'خصم المنتج: تيل فرامل' }));
    const productDialog = screen.getByRole('dialog');
    fireEvent.click(within(productDialog).getByRole('button', { name: /نسبة مئوية/ }));
    fireEvent.change(within(productDialog).getByRole('spinbutton', { name: 'قيمة الخصم' }), { target: { value: '10' } });
    fireEvent.click(within(productDialog).getByRole('button', { name: 'تطبيق الخصم' }));
    expect(store.getState().lines[0].discountPercent).toBe(10);
    fireEvent.click(screen.getByRole('button', { name: /خصم الفاتورة/ }));
    const invoiceDialog = screen.getByRole('dialog');
    fireEvent.change(within(invoiceDialog).getByRole('spinbutton', { name: 'قيمة الخصم' }), { target: { value: '5' } });
    fireEvent.click(within(invoiceDialog).getByRole('button', { name: 'تطبيق الخصم' }));
    expect(store.getState().invoiceDiscount).toBe(5);
    await openPayment();
    const payment = screen.getByRole('dialog');
    expect(within(payment).getAllByText('85.00 ج.م').length).toBeGreaterThan(0);
    fireEvent.click(within(payment).getByRole('button', { name: /إتمام البيع/ }));
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(createSale.mock.calls[0]?.[0]).toMatchObject({ items: [{ discount: 10, discountPercent: 10 }], invoiceDiscount: 5, payments: [{ method: 'cash', amount: 85 }] });
  });

  it('calculates invoice percentages after product amount discounts and supports removal', async () => {
    const store = cartStore();
    store.getState().setLineDiscount('p1', 20, 'amount');
    await mount(store);
    fireEvent.click(screen.getByRole('button', { name: /خصم الفاتورة/ }));
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /نسبة مئوية/ }));
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'قيمة الخصم' }), { target: { value: '10' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تطبيق الخصم' }));
    expect(store.getState().invoiceDiscount).toBe(8);
    fireEvent.click(screen.getByRole('button', { name: /خصم الفاتورة/ }));
    dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'إزالة الخصم' }));
    expect(store.getState().invoiceDiscount).toBe(0);
  });

  it('completes a fully discounted invoice without collecting payment', async () => {
    const store = cartStore();
    store.getState().setLineDiscount('p1', 100);
    const createSale = vi.fn(async (_input: Parameters<PosAdapter['createSale']>[0]) => ({ ...sale, total: 0, paid: 0, payments: [] }));
    await mount(store, { createSale }, false);
    await openPayment();
    const confirm = within(screen.getByRole('dialog')).getByRole('button', { name: /إتمام البيع/ }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(createSale).toHaveBeenCalledOnce());
    expect(createSale.mock.calls[0]?.[0]).toMatchObject({ items: [{ discount: 100, discountPercent: 100 }], payments: [] });
  });

  it('enforces the combined allowance and permissions for restored discounts', async () => {
    const store = cartStore();
    store.getState().setLineDiscount('p1', 10, 'amount');
    const view = await mount(store, { permissions: ['sales.create', 'discounts.item', 'discounts.invoice'] });
    fireEvent.click(screen.getByRole('button', { name: /خصم الفاتورة/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'قيمة الخصم' }), { target: { value: '6' } });
    expect((within(dialog).getByRole('button', { name: 'تطبيق الخصم' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'قيمة الخصم' }), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'تطبيق الخصم' }));
    view.unmount();
    await mount(store, { permissions: ['sales.create'] });
    expect((screen.getByRole('button', { name: /إتمام البيع/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/لا توجد صلاحية لهذا الخصم/)).toBeTruthy();
  });

  it('adds from the empty invoice and searches the product list with stock and shelf details', async () => {
    const store = createPosStore();
    await mount(store, { catalog });
    fireEvent.click(screen.getByRole('button', { name: 'اختر المنتج' }));
    const list = await screen.findByRole('listbox');
    const option = within(list).getByRole('option', { name: /فلتر زيت/ });
    expect(option.textContent).toContain('المخزون: 6');
    expect(option.textContent).toContain('الرف: رف 3');
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox', { name: 'بحث' }), { target: { value: 'S2' } });
    expect(within(list).queryByRole('option', { name: /تيل فرامل/ })).toBeNull();
    fireEvent.click(option);
    expect(store.getState().lines).toMatchObject([{ productId: 'p2', quantity: 1, unitPrice: 60 }]);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('replaces the chosen row using the new product price while preserving quantity and tier', async () => {
    const store = cartStore();
    store.getState().setQty('p1', 3);
    store.getState().setLineTier('p1', 'retail2', 90);
    await mount(store, { catalog });
    fireEvent.click(screen.getByRole('button', { name: 'تغيير المنتج: تيل فرامل' }));
    fireEvent.click(await screen.findByRole('option', { name: /فلتر زيت/ }));
    expect(store.getState().lines).toMatchObject([{ productId: 'p2', quantity: 3, unitPrice: 50, listPrice: 50, priceTier: 'retail2', discountPercent: 0 }]);
    const row = screen.getByRole('button', { name: 'تغيير المنتج: فلتر زيت' }).closest('tr')!;
    expect(row.children[3].textContent).toContain('150.00');
  });

  it('merges with an existing product without losing its quantity or chosen price', async () => {
    const store = cartStore();
    store.getState().setQty('p1', 2);
    store.getState().addLine({ productId: 'p2', name: second.name, barcode: 'MP2', sku: 'S2', unitPrice: 45, listPrice: 45, unitCost: 40, priceTier: 'wholesale', quantity: 3, discountPercent: 0, available: 6 });
    await mount(store, { catalog });
    fireEvent.click(screen.getByRole('button', { name: 'تغيير المنتج: تيل فرامل' }));
    fireEvent.click(await screen.findByRole('option', { name: /فلتر زيت/ }));
    expect(store.getState().lines).toMatchObject([{ productId: 'p2', quantity: 5, unitPrice: 45, priceTier: 'wholesale' }]);
  });

  it('rejects a replacement whose combined quantity exceeds stock and keeps both rows', async () => {
    const store = cartStore();
    store.getState().setQty('p1', 5);
    store.getState().addLine({ productId: 'p2', name: second.name, barcode: 'MP2', sku: 'S2', unitPrice: 60, listPrice: 60, unitCost: 40, priceTier: 'retail1', quantity: 3, discountPercent: 0, available: 6 });
    await mount(store, { catalog, settings: async () => ({ ...DEFAULT_SETTINGS, invoice: { ...DEFAULT_SETTINGS.invoice, allowNegativeStock: true } }) });
    fireEvent.click(screen.getByRole('button', { name: 'تغيير المنتج: تيل فرامل' }));
    fireEvent.click(await screen.findByRole('option', { name: /فلتر زيت/ }));
    expect(store.getState().lines.map((line) => line.quantity)).toEqual([5, 3]);
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('changes quantity by arrows, direct entry and shortcuts while respecting stock', async () => {
    const store = cartStore();
    await mount(store);
    fireEvent.click(screen.getByRole('button', { name: 'زيادة الكمية: تيل فرامل' }));
    expect(store.getState().lines[0].quantity).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'نقص الكمية: تيل فرامل' }));
    expect(store.getState().lines[0].quantity).toBe(1);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'الكمية: تيل فرامل' }), { target: { value: '11' } });
    expect(store.getState().lines[0].quantity).toBe(1);
    fireEvent.change(screen.getByRole('spinbutton', { name: 'الكمية: تيل فرامل' }), { target: { value: '10' } });
    expect((screen.getByRole('button', { name: 'زيادة الكمية: تيل فرامل' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('spinbutton', { name: 'الكمية: تيل فرامل' }).closest('tr')!);
    fireEvent.keyDown(window, { key: '+' });
    expect(store.getState().lines[0].quantity).toBe(10);
  });

  it('disables a zero-stock product even when legacy settings allowed negative stock', async () => {
    const store = cartStore();
    store.getState().clear();
    await mount(store, { catalog: async () => [{ ...product, available: 0 }], settings: async () => ({ ...DEFAULT_SETTINGS, invoice: { ...DEFAULT_SETTINGS.invoice, allowNegativeStock: true } }) });
    fireEvent.click(screen.getByRole('button', { name: 'اختر المنتج' }));
    const option = await screen.findByRole('option', { name: /تيل فرامل/ });
    expect((option as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(option);
    expect(store.getState().lines).toHaveLength(0);
  });

  it('blocks checkout of a restored cart whose quantity exceeds current stock', async () => {
    const store = cartStore();
    store.getState().setQty('p1', 2);
    const createSale = vi.fn(async () => sale);
    await mount(store, { catalog: async () => [{ ...product, available: 1 }], createSale });
    await waitFor(() => expect((screen.getByRole('button', { name: 'زيادة الكمية: تيل فرامل' }) as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: /إتمام البيع/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(createSale).not.toHaveBeenCalled();
    expect(store.getState().lines[0]?.quantity).toBe(2);
  });

  it('selects the price tier from the price cell and updates the row value', async () => {
    const store = cartStore();
    store.getState().setQty('p1', 2);
    await mount(store);
    fireEvent.click(screen.getByRole('button', { name: 'اختر السعر: تيل فرامل' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /جملة/ }));
    expect(store.getState().lines[0]).toMatchObject({ priceTier: 'wholesale', unitPrice: 80, quantity: 2 });
    const row = screen.getByRole('button', { name: 'اختر السعر: تيل فرامل' }).closest('tr')!;
    expect(row.children[3].textContent).toContain('160.00');
  });

  it('keeps wholesale out of the price list when the user lacks its permission', async () => {
    await mount(cartStore(), { permissions: ALL_PERMISSIONS.filter((permission) => permission !== 'prices.wholesale') });
    fireEvent.click(screen.getByRole('button', { name: 'اختر السعر: تيل فرامل' }));
    expect(within(screen.getByRole('dialog')).queryByRole('button', { name: /جملة/ })).toBeNull();
  });

  it('opens, filters and inspects saved sales without altering the active invoice or capturing scans', async () => {
    const store = cartStore();
    const items: Sale['items'] = [{ id: 'i1', productId: product.id, name: product.name, barcode: 'MP1', sku: 'S1', quantity: 1, listPrice: 100, unitPrice: 100, unitCost: 40, priceTier: 'retail1', discountPercent: 0, discount: 0, subtotal: 100, returnedQty: 0 }];
    const recentSales = vi.fn(async () => [{ ...sale, items }, { ...sale, id: 's2', invoiceNumber: 'INV-2', items }]);
    const lookup = vi.fn(async () => ({ products: [product], legacyHit: false }));
    await mount(store, { recentSales, lookup });
    fireEvent.click(screen.getByRole('button', { name: 'المبيعات' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'INV-1' })).toBeTruthy());
    expect(recentSales).toHaveBeenCalledWith(100);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'INV-2' } });
    expect(within(dialog).queryByRole('button', { name: 'INV-1' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'INV-2' }));
    expect(within(dialog).getByLabelText('تفاصيل الفاتورة').textContent).toContain('تيل فرامل');
    fireEvent.keyDown(window, { key: 'F4' });
    for (const key of ['M', 'P', '1', 'Enter']) fireEvent.keyDown(window, { key });
    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().held).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(store.getState().lines[0].quantity).toBe(1);
  });

  it('allows retry after a sales loading error and shows the empty state', async () => {
    const recentSales = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]);
    await mount(cartStore(), { recentSales });
    fireEvent.click(screen.getByRole('button', { name: 'المبيعات' }));
    await screen.findByText('تعذّر تحميل المبيعات. أعد المحاولة من زر التحديث.');
    fireEvent.click(screen.getByRole('button', { name: 'تحديث المبيعات' }));
    await screen.findByText('لا توجد مبيعات مطابقة');
    expect(recentSales).toHaveBeenCalledTimes(2);
  });
});

describe('PosTerminal shortcuts', () => {
  beforeEach(() => localStorage.clear());

  it('preserves the cart and ignores scanner input behind the host lock or shift dialog', async () => {
    const store = cartStore();
    const lookup = vi.fn(async () => ({ products: [product], legacyHit: false }));
    await mount(store, { lookup }, true, true);
    act(() => {
      for (const key of ['F4', 'F9', 'F10', 'F1', '1', '2', '3', '4', 'Enter']) fireEvent.keyDown(window, { key });
    });
    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().held).toHaveLength(0);
    expect(lookup).not.toHaveBeenCalled();
    expect(screen.queryByText('إتمام الدفع')).toBeNull();
  });

  it('holds the invoice on F4 when no dialog is open', async () => {
    const store = cartStore();
    await mount(store);
    act(() => {
      fireEvent.keyDown(window, { key: 'F4' });
    });
    expect(store.getState().lines).toHaveLength(0);
    expect(store.getState().held).toHaveLength(1);
  });

  it('ignores cart shortcuts while the payment dialog is open', async () => {
    const store = cartStore();
    await mount(store);
    await openPayment();

    act(() => {
      fireEvent.keyDown(window, { key: 'F4' });
      fireEvent.keyDown(window, { key: 'F10' });
      fireEvent.keyDown(window, { key: '3' });
    });

    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().held).toHaveLength(0);
    expect(store.getState().priceTier).toBe('retail1');
    expect(screen.getByText('إتمام الدفع')).toBeTruthy();
  });
});

describe('PosTerminal payment dialog', () => {
  beforeEach(() => localStorage.clear());

  it('removes payment before printing even if its closing animation never finishes', async () => {
    // Native printing can interrupt the exit animation, so animationend never reaches Radix Presence.
    const computedStyle = window.getComputedStyle.bind(window);
    const styles = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      const original = computedStyle(element, pseudo);
      return new Proxy(original, {
        get(target, key) {
          if (key === 'animationName' && element.getAttribute('role') === 'dialog') {
            return element.getAttribute('data-state') === 'open' ? 'enter' : 'exit';
          }
          return Reflect.get(target, key, target);
        },
      });
    });
    let releasePrint: (() => void) | undefined;
    const print = vi.fn(() => new Promise<void>((resolve) => { releasePrint = resolve; }));
    try {
      const store = cartStore();
      const createSale = vi.fn(async () => sale);
      await mount(store, { createSale, print });
      await openPayment();
      fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
      expect(store.getState().lines).toHaveLength(0);
      expect(store.getState().lastSaleId).toBe(sale.id);
      expect(screen.queryByText('إتمام الدفع')).toBeNull();
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(createSale).toHaveBeenCalledTimes(1);
      await act(async () => releasePrint?.());
      expect(screen.queryByText('إتمام الدفع')).toBeNull();
    } finally {
      await act(async () => releasePrint?.());
      styles.mockRestore();
    }
  });

  it('closes itself when the cart empties underneath it', async () => {
    const store = cartStore();
    await mount(store);
    await openPayment();

    act(() => store.getState().clear());

    await waitFor(() => expect(screen.queryByText('إتمام الدفع')).toBeNull());
  });

  it('creates one sale when confirm fires twice in the same tick', async () => {
    let release: (() => void) | undefined;
    const createSale = vi.fn(async () => {
      await new Promise<void>((r) => (release = r));
      return sale;
    });
    const store = cartStore();
    await mount(store, { createSale });
    await openPayment();

    const confirm = screen.getByRole('button', { name: /تأكيد البيع والطباعة/ });
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await waitFor(() => expect(createSale).toHaveBeenCalledTimes(1));
    expect(createSale).toHaveBeenCalledTimes(1);

    await act(async () => {
      release?.();
    });
    await waitFor(() => expect(store.getState().lines).toHaveLength(0));
    await waitFor(() => expect(screen.queryByText('إتمام الدفع')).toBeNull());
  });
});

describe('PosTerminal products and invoice printing', () => {
  beforeEach(() => localStorage.clear());

  it('collapses products into the cart without changing the invoice and remembers the choice', async () => {
    const store = cartStore();
    await mount(store);
    fireEvent.click(screen.getByRole('button', { name: 'طيّ المنتجات' }));
    expect(document.querySelector('.pos-workspace')!.classList.contains('pos-products-collapsed')).toBe(true);
    expect(document.getElementById('pos-products-panel')!.getAttribute('aria-hidden')).toBe('true');
    expect(localStorage.getItem('pos.panelOpen.u1')).toBe('0');
    expect(store.getState().lines).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'تفاصيل الفاتورة' }).textContent).toContain('100.00');
    fireEvent.click(screen.getByRole('button', { name: 'إظهار المنتجات' }));
    expect(document.querySelector('.pos-workspace')!.classList.contains('pos-products-collapsed')).toBe(false);
    expect(screen.getByRole('region', { name: 'المنتجات' }).textContent).toContain('P1');
  });

  it.each([
    ['فاتورة صغيرة', 'thermal80'],
    ['فاتورة كبيرة', 'a4'],
  ])('saves the sale before printing %s using %s', async (label, paper) => {
    const store = cartStore();
    const createSale = vi.fn(async () => saleWithItem);
    const branchName = vi.fn(() => 'فرع مدينة نصر');
    const print = vi.fn(async () => {
      expect(store.getState().lastSaleId).toBe(sale.id);
      expect(store.getState().lines).toHaveLength(0);
    });
    await mount(store, { createSale, print, branchName, catalogMeta: printCatalogMeta });
    expect(screen.queryByRole('button', { name: 'طباعة فاتورة صغيرة' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'طباعة فاتورة كبيرة' })).toBeNull();
    await openPayment();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));
    expect((screen.getByRole('radio', { name: new RegExp(label) }) as HTMLInputElement).checked).toBe(true);
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const [element, profile] = print.mock.calls[0] as unknown as [HTMLElement, { paper: string }];
    expect(profile.paper).toBe(paper);
    expectPrintedCatalogColumns(element, paper);
    expect(element.textContent).toContain(sale.invoiceNumber);
    expect(element.textContent).toContain('فرع مدينة نصر');
    expect(branchName).toHaveBeenCalledWith(sale.branchId);
    expect(element.querySelector('button')).toBeNull();
    expect(createSale).toHaveBeenCalledTimes(1);
    expect(store.getState().lines).toHaveLength(0);
  });

  it('reports a printer error and keeps the saved invoice available for retry', async () => {
    const store = cartStore();
    await mount(store, { createSale: async () => sale, print: async () => { throw new Error('Printer offline'); } });
    await openPayment();
    fireEvent.click(screen.getByRole('radio', { name: /فاتورة كبيرة/ }));
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(screen.getByText('Printer offline')).toBeTruthy());
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(store.getState().lastSaleId).toBe(sale.id);
    expect(store.getState().lines).toHaveLength(0);
  });
});

describe('simple sale and printing flow', () => {
  it.each([
    ['فاتورة صغيرة', 'pp-thermal58', 'thermal80', 'invoice-small', 'width: 80mm'],
    ['فاتورة كبيرة', 'pp-a5', 'a4', 'invoice-large', 'width: 210mm'],
  ] as const)('prints %s at its fixed size with a legacy %s device setting', async (label, legacyId, paper, profileId, width) => {
    const store = cartStore();
    localStorage.setItem('printProfile', legacyId);
    const print = vi.fn(async () => undefined);
    await mount(store, { createSale: async () => sale, print });
    await openPayment();
    expect(screen.queryByLabelText('قالب الطباعة')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const [element, profile] = print.mock.calls[0] as unknown as [HTMLElement, { paper: string; id: string; copies: number }];
    expect(profile).toMatchObject({ paper, id: profileId, copies: 1 });
    expect(element.querySelector('style')!.textContent).toContain(width);
    expect(store.getState().lastSaleId).toBe(sale.id);
    expect(store.getState().lines).toHaveLength(0);
  });

  it('blocks sale shortcuts while a print job is awaiting a decision', async () => {
    const store = cartStore();
    let release: (() => void) | undefined;
    const createSale = vi.fn(async () => sale);
    await mount(store, { createSale, print: () => new Promise<void>((resolve) => { release = resolve; }) });
    await openPayment();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(release).toBeDefined());
    act(() => store.getState().addLine({ productId: product.id, name: product.name, barcode: product.internalBarcode, sku: product.sku, listPrice: 100, unitPrice: 100, unitCost: 40, priceTier: 'retail1', discountPercent: 0, quantity: 1, available: 10 }));
    fireEvent.keyDown(window, { key: 'F4' });
    fireEvent.keyDown(window, { key: 'F9' });
    expect(store.getState().lines).toHaveLength(1);
    expect(screen.queryByText('إتمام الدفع')).toBeNull();
    expect(createSale).toHaveBeenCalledTimes(1);
    await act(async () => release?.());
  });

  it('keeps the existing web checkout behavior when desktop printing is disabled', async () => {
    const store = cartStore();
    const print = vi.fn(async () => undefined);
    await mount(store, { settings: async () => ({ ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, autoPrint: true } }), createSale: async () => sale, print }, false);
    await openPayment();
    expect(screen.queryByText('إتمام وطباعة')).toBeNull();
    const confirm = screen.getAllByText('إتمام البيع').find((el) => el.closest('[role="dialog"]'))!.closest('button')!;
    fireEvent.click(confirm);
    await waitFor(() => expect(store.getState().lastSaleId).toBe(sale.id));
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('قالب الطباعة')).toBeNull();
    expect(screen.queryByLabelText('إعادة طباعة')).toBeNull();
    expect(screen.getByText('INV-1')).toBeTruthy();
  });

  it.each([
    ['فاتورة صغيرة', 'thermal80'],
    ['فاتورة كبيرة', 'a4'],
  ])('offers a size before F8 reprinting %s and prevents duplicate jobs', async (label, paper) => {
    const store = cartStore();
    store.getState().setLastSale(sale.id);
    const savedSale = { ...saleWithItem, branchId: 'br-original' };
    const branchName = vi.fn((id: string) => id === savedSale.branchId ? 'فرع المعادي' : 'فرع مدينة نصر');
    const print = vi.fn(async () => undefined);
    const createSale = vi.fn();
    await mount(store, { lastSale: async () => savedSale, createSale, print, branchName, catalogMeta: printCatalogMeta });
    act(() => { fireEvent.keyDown(window, { key: 'F8' }); fireEvent.keyDown(window, { key: 'F8' }); });
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));
    const confirm = screen.getByRole('button', { name: /^طباعة$/ });
    act(() => { fireEvent.click(confirm); fireEvent.click(confirm); });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect((print.mock.calls[0] as unknown as [HTMLElement, { paper: string }])[1].paper).toBe(paper);
    const element = (print.mock.calls[0] as unknown as [HTMLElement])[0];
    expectPrintedCatalogColumns(element, paper);
    expect(element.textContent).toContain('فرع المعادي');
    expect(element.textContent).not.toContain('فرع مدينة نصر');
    expect(branchName).toHaveBeenCalledWith(savedSale.branchId);
    expect(store.getState().lines).toHaveLength(1);
    expect(createSale).not.toHaveBeenCalled();
  });

  it('cancels reprinting without changing the saved sale or current cart', async () => {
    const store = cartStore();
    store.getState().setLastSale(sale.id);
    const print = vi.fn(async () => undefined);
    await mount(store, { lastSale: async () => sale, print });
    fireEvent.click(screen.getByRole('button', { name: /إعادة طباعة/ }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: /فاتورة كبيرة/ }));
    fireEvent.click(screen.getByRole('button', { name: 'إغلاق' }));
    expect(print).not.toHaveBeenCalled();
    expect(store.getState().lastSaleId).toBe(sale.id);
    expect(store.getState().lines).toHaveLength(1);
  });

  it('reports cancellation without reporting successful printing', async () => {
    const success = vi.spyOn(toast, 'success');
    const info = vi.spyOn(toast, 'info');
    const store = cartStore();
    const createSale = vi.fn(async () => sale);
    await mount(store, { createSale, print: async () => ({ status: 'cancelled' }) });
    await openPayment();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(info).toHaveBeenCalledWith('تم إلغاء الطباعة'));
    expect(success).not.toHaveBeenCalledWith('تم إرسال الفاتورة للطابعة');
    expect(store.getState().lastSaleId).toBe(sale.id);
    expect(store.getState().lines).toHaveLength(0);
    expect(createSale).toHaveBeenCalledTimes(1);
    info.mockRestore(); success.mockRestore();
  });

  it.each([
    ['فاتورة صغيرة', 'thermal80'],
    ['فاتورة كبيرة', 'a4'],
  ])('retries the same saved invoice at the selected %s size', async (label, paper) => {
    const store = cartStore();
    const createSale = vi.fn(async () => sale);
    const print = vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValue({ status: 'printed' });
    await mount(store, { createSale, print });
    await openPayment();
    fireEvent.click(screen.getByRole('radio', { name: /فاتورة كبيرة/ }));
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(screen.getByText('Disconnected')).toBeTruthy());
    fireEvent.click(screen.getByRole('radio', { name: new RegExp(label) }));
    fireEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    expect(print.mock.calls[1][1].paper).toBe(paper);
    expect(store.getState().lastSaleId).toBe(sale.id);
    expect(createSale).toHaveBeenCalledTimes(1);
    expect(print.mock.calls[0][0].textContent).toContain(sale.invoiceNumber);
    expect(print.mock.calls[1][0].textContent).toContain(sale.invoiceNumber);
  });

  it('does not print or clear the cart when saving the sale fails', async () => {
    const error = vi.spyOn(toast, 'error');
    const store = cartStore();
    const print = vi.fn(async () => undefined);
    await mount(store, { createSale: async () => { throw new Error('Cannot save'); }, print });
    await openPayment();
    fireEvent.click(screen.getByRole('button', { name: /تأكيد البيع والطباعة/ }));
    await waitFor(() => expect(error).toHaveBeenCalledWith('Cannot save'));
    expect(print).not.toHaveBeenCalled();
    expect(store.getState().lines).toHaveLength(1);
    expect(store.getState().lastSaleId).toBeNull();
    expect(screen.getByText('إتمام الدفع')).toBeTruthy();
    error.mockRestore();
  });

  it('uses the selected size when confirming by Enter', async () => {
    const store = cartStore();
    const print = vi.fn(async () => undefined);
    await mount(store, { createSale: async () => sale, print });
    await openPayment();
    fireEvent.click(screen.getByRole('radio', { name: /فاتورة كبيرة/ }));
    const amount = document.querySelector('[role="dialog"] input[type="number"]')!;
    fireEvent.keyDown(amount, { key: 'Enter' });
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect((print.mock.calls[0] as unknown as [HTMLElement, { paper: string }])[1].paper).toBe('a4');
  });
});
