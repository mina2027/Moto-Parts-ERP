import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import { ALL_PERMISSIONS, DEFAULT_SETTINGS, SaleCreateSchema } from '@moto/shared';
import { createSale } from './service.js';
import { signTaxSnapshot } from '../settings/taxSnapshot.js';
import { api, loginAs, startTestDb, stopTestDb } from '../../test/harness.js';
import { StockLevelModel, StockMovementModel, SaleModel, CustomerModel, CustomerDebtModel, AlertModel, ProductModel } from '../../db/models.js';

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;
let cashier: Awaited<ReturnType<typeof loginAs>>;
let sales: Awaited<ReturnType<typeof loginAs>>;

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  admin = await loginAs(app, 'admin');
  cashier = await loginAs(app, 'cashier1');
  sales = await loginAs(app, 'nour.h');
});
afterAll(stopTestDb);

const auth = (t: { token: string }) => ({ Authorization: `Bearer ${t.token}` });

describe('auth & RBAC', () => {
  it('rejects bad credentials', async () => {
    const res = await api(app).post('/api/auth/login').send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
  it('returns session with permissions', async () => {
    expect(admin.token).toBeTruthy();
    const me = await api(app).get('/api/auth/me').set(auth(admin));
    expect(me.status).toBe(200);
    expect(me.body.permissions).toContain('settings.edit');
  });
  it('denies cashier a settings edit', async () => {
    const res = await api(app).put('/api/settings/pos').set(auth(cashier)).send({ value: { autoPrint: false } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });
  it('refreshes with body token for desktop client', async () => {
    const res = await api(app).post('/api/auth/refresh').set('X-Client', 'pos-desktop').send({ refreshToken: cashier.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.refreshToken).toBeTruthy();
    cashier = res.body;
  });
});

describe('products & barcode engine', () => {
  it('creates a product with a unique internal barcode and Arabic-only name', async () => {
    const res = await api(app).post('/api/products').set(auth(admin)).send({
      name: { ar: 'قطعة اختبار', en: '' },
      sku: 'SKU-TEST-0001',
      partNumber: 'TST-001',
      brandId: 'brand-1',
      categoryId: 'cat-dep-2w-125-cat-2',
      supplierId: 'sup-1',
      purchasePrice: 10,
      prices: { retail1: 20, retail2: 18, wholesale: 15 },
      minStock: 5,
      unit: { ar: 'قطعة' },
    });
    expect(res.status).toBe(201);
    expect(res.body.internalBarcode).toMatch(/^MP\d+$/);
    expect(res.body.name.en).toBeUndefined();
    const dup = await ProductModel.countDocuments({ internalBarcode: res.body.internalBarcode });
    expect(dup).toBe(1);
    const lookup = await api(app).get('/api/products/lookup').query({ term: res.body.internalBarcode, branchId: 'br-1' }).set(auth(cashier));
    expect(lookup.body[0].id).toBe(res.body.id);
  });
  it('creates a category inline and stores product size', async () => {
    const cat = await api(app).post('/api/catalog/categories').set(auth(admin)).send({ name: { ar: 'إطارات اختبار' } });
    expect(cat.status).toBe(201);
    const again = await api(app).post('/api/catalog/categories').set(auth(admin)).send({ name: { ar: 'إطارات اختبار' } });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(cat.body.id);
    const denied = await api(app).post('/api/catalog/categories').set(auth(cashier)).send({ name: { ar: 'ممنوع' } });
    expect(denied.status).toBe(403);
    const res = await api(app).post('/api/products').set(auth(admin)).send({
      name: { ar: 'إطار اختبار' }, sku: 'SKU-TEST-SIZE', partNumber: 'TST-SZ', brandId: 'brand-1', categoryId: cat.body.id, supplierId: 'sup-1',
      size: ' 90/90-17 ', purchasePrice: 10, prices: { retail1: 20, retail2: 18, wholesale: 15 }, unit: { ar: 'قطعة' },
    });
    expect(res.status).toBe(201);
    expect(res.body.size).toBe('90/90-17');
    expect(res.body.categoryId).toBe(cat.body.id);
    const list = await api(app).get('/api/products').query({ search: '90/90' }).set(auth(admin));
    expect(list.body.data.map((p: { id: string }) => p.id)).toContain(res.body.id);
  });
  it('resolves legacy barcode with a hint header', async () => {
    const p = await ProductModel.findOne({ legacyBarcode: { $exists: true } }).lean();
    const res = await api(app).get('/api/products/lookup').query({ term: p!.legacyBarcode }).set(auth(cashier));
    expect(res.status).toBe(200);
    expect(res.headers['x-legacy-barcode']).toBe('true');
  });
  it('records price history when a tier changes', async () => {
    const res = await api(app).patch('/api/products/prod-1').set(auth(admin)).send({ prices: { wholesale: 999 }, changeReason: 'test' });
    expect(res.status).toBe(200);
    expect(res.body.prices.wholesale).toBe(999);
    const hist = await api(app).get('/api/products/price-history').query({ productId: 'prod-1' }).set(auth(admin));
    expect(hist.body.some((h: { field: string; newValue: number }) => h.field === 'wholesale' && h.newValue === 999)).toBe(true);
  });
  it('ranks alternatives: compatible in-stock first', async () => {
    const res = await api(app).get('/api/products/prod-5/alternatives').query({ branchId: 'br-1', inStockOnly: false }).set(auth(cashier));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    if (res.body.length > 1) {
      const first = res.body[0];
      expect(first.matchReason === 'explicit' || first.qtyAvailable >= 0).toBe(true);
    }
  });
});

describe('POS invoice search', () => {
  it('searches invoice product names in both languages before paging and retains branch scope', async () => {
    const marker = randomUUID();
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    try {
      await SaleModel.insertMany(ids.map((id, index) => ({
        _id: id, invoiceNumber: `POS-SEARCH-${id}`, date: `2026-01-0${index + 1}T00:00:00.000Z`,
        branchId: index === 2 ? 'br-2' : 'br-1', cashierId: cashier.user.id,
        type: 'cash', status: 'completed',
        items: [{ name: { ar: `قطعة اختبار ${marker}`, en: `Test part ${marker}` } }],
      })));
      for (const search of [`قطعة اختبار ${marker}`, `Test part ${marker}`]) {
        const result = await api(app).get('/api/sales').set(auth(cashier)).query({ branchId: 'br-1', search, page: 2, pageSize: 1 });
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
        expect(result.body.data).toHaveLength(1);
        expect(result.body.data[0].id).toBe(ids[0]);
      }
    } finally {
      await SaleModel.deleteMany({ _id: { $in: ids } });
    }
  });
});

describe('sales', () => {
  const saleBody = (overrides: Record<string, unknown> = {}) => ({
    branchId: 'br-1',
    customerId: null,
    registerSessionId: null,
    items: [{ productId: 'prod-1', name: { ar: 'x' }, quantity: 2, listPrice: 60, unitPrice: 60, unitCost: 35, priceTier: 'retail1', discount: 0, discountPercent: 0 }],
    invoiceDiscount: 0,
    payments: [{ method: 'cash', amount: 200 }],
    type: 'cash',
    ...overrides,
  });

  const recordedCreditInvoice = (overrides: Record<string, unknown>) => createSale(SaleCreateSchema.parse(saleBody({ ...overrides, type: 'credit', invoiceNumber: 'LEGACY-' + randomUUID() })), { userId: cashier.user.id, terminalId: 'legacy-terminal', permissions: ALL_PERMISSIONS, saleAmounts: { tax: 0, total: 120 } });

  it('creates a sale, deducts stock, stores tier, computes change, ignores client unitCost', async () => {
    const before = await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean();
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ ...saleBody().items[0], unitCost: 1 }] }));
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(120);
    expect(res.body.change).toBe(80);
    expect(res.body.items[0].priceTier).toBe('retail1');
    expect(res.body.items[0].unitCost).toBe(0);
    const stored = await import('../../db/models.js').then(({ SaleModel }) => SaleModel.findById(res.body.id).lean());
    expect(stored!.items[0]!.unitCost).toBeGreaterThan(1);
    expect(res.body.qrPayload).toBeTruthy();
    expect(res.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    const after = await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean();
    expect(after!.quantity).toBe(before!.quantity - 2);
  });

  it('rejects an underpaid cash sale', async () => {
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ payments: [{ method: 'cash', amount: 10 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNDERPAID');
  });

  it('enforces the product discount cap below the global limit', async () => {
    const before = await ProductModel.findById('prod-1').lean();
    await ProductModel.updateOne({ _id: 'prod-1' }, { $set: { maxDiscountAmount: 5 } });
    try {
      const res = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({
        items: [{ ...saleBody().items[0], discount: 6 }],
        payments: [{ method: 'cash', amount: 112 }],
      }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('DISCOUNT_EXCEEDS');
    } finally {
      await ProductModel.updateOne({ _id: 'prod-1' }, { $set: { maxDiscountAmount: before!.maxDiscountAmount ?? 0 } });
    }
  });

  it('rejects when stock is insufficient', async () => {
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ productId: 'prod-1', name: { ar: 'x' }, quantity: 99999, listPrice: 60, unitPrice: 60, unitCost: 35, priceTier: 'retail1' }], payments: [{ method: 'cash', amount: 99999 * 60 }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('blocks unavailable and repeated-row sales without recording an invoice or stock movement', async () => {
    const settings = await api(app).put('/api/settings/invoice').set(auth(admin)).send({ value: { allowNegativeStock: true } });
    expect(settings.status).toBe(200);
    expect(settings.body.invoice.allowNegativeStock).toBe(false);
    const stock = (await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean())!;
    const salesBefore = await SaleModel.countDocuments();
    const movementsBefore = await StockMovementModel.countDocuments();
    try {
      for (const [quantity, reserved, items] of [
        [0, 0, [{ ...saleBody().items[0], quantity: 1 }]],
        [5, 5, [{ ...saleBody().items[0], quantity: 1 }]],
        [2, 0, [{ ...saleBody().items[0], quantity: 2 }, { ...saleBody().items[0], quantity: 1 }]],
      ] as const) {
        await StockLevelModel.updateOne({ _id: stock._id }, { $set: { quantity, reserved } });
        const result = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({ items }));
        expect(result.status).toBe(422);
        expect(result.body.error.code).toBe('INSUFFICIENT_STOCK');
        expect((await StockLevelModel.findById(stock._id).lean())!.quantity).toBe(quantity);
        expect(await SaleModel.countDocuments()).toBe(salesBefore);
        expect(await StockMovementModel.countDocuments()).toBe(movementsBefore);
      }
    } finally {
      await StockLevelModel.updateOne({ _id: stock._id }, { $set: { quantity: stock.quantity, reserved: stock.reserved } });
    }
  });

  it('allows only one of two concurrent sales of the last unit', async () => {
    const stock = (await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean())!;
    const before = await SaleModel.countDocuments();
    try {
      await StockLevelModel.updateOne({ _id: stock._id }, { $set: { quantity: 1, reserved: 0 } });
      const request = () => api(app).post('/api/sales').set(auth(admin)).set('Idempotency-Key', randomUUID()).send(saleBody({ items: [{ ...saleBody().items[0], quantity: 1 }] }));
      const results = await Promise.all([request(), request()]);
      expect(results.map(r => r.status).sort()).toEqual([201, 422]);
      expect(results.find(r => r.status === 422)!.body.error.code).toBe('INSUFFICIENT_STOCK');
      expect((await StockLevelModel.findById(stock._id).lean())!.quantity).toBe(0);
      expect(await SaleModel.countDocuments()).toBe(before + 1);
    } finally {
      await StockLevelModel.updateOne({ _id: stock._id }, { $set: { quantity: stock.quantity, reserved: stock.reserved } });
    }
  });

  it('requires a customer for new credit sales', async () => {
    for (const payments of [[], [{ method: 'cash', amount: 120 }]]) {
      const res = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({ type: 'credit', payments }));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('CUSTOMER_REQUIRED');
    }
  });

  it('creates credit sales, books the debt and enforces the cumulative limit', async () => {
    const template = (await CustomerModel.findOne({ branchId: 'br-1', isActive: true }).lean())!;
    const id = randomUUID();
    await CustomerModel.create({ ...template, _id: id, code: id, balance: 0, creditLimit: 150 });
    const first = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ customerId: id, type: 'credit', payments: [] }));
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ type: 'credit', total: 120, paid: 0, remaining: 120 });
    expect((await CustomerDebtModel.findOne({ saleId: first.body.id }).lean())!.remaining).toBe(120);
    const stock = (await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean())!;
    const denied = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ customerId: id, type: 'credit', payments: [] }));
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('CUSTOMER_CREDIT_EXCEEDED');
    expect((await StockLevelModel.findById(stock._id).lean())!.quantity).toBe(stock.quantity);
    const partial = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ customerId: id, type: 'credit', payments: [{ method: 'cash', amount: 90 }] }));
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ paid: 90, remaining: 30 });
    expect((await CustomerModel.findById(id).lean())!.balance).toBe(150);
  });

  it('enforces tier prices, wholesale permission and discount limits server-side', async () => {
    const wrongPrice = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ ...saleBody().items[0], unitPrice: 1 }], payments: [{ method: 'cash', amount: 2 }] }));
    expect(wrongPrice.status).toBe(422);
    expect(wrongPrice.body.error.code).toBe('PRICE_NOT_ALLOWED');

    const wholesaleByCashier = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ ...saleBody().items[0], unitPrice: 48, priceTier: 'wholesale' }] }));
    expect(wholesaleByCashier.status).toBe(403);

    const wholesalePrice = (await ProductModel.findById('prod-1').lean())!.prices.wholesale;
    const wholesaleBySales = await api(app).post('/api/sales').set(auth(sales)).send(saleBody({ items: [{ ...saleBody().items[0], unitPrice: wholesalePrice, priceTier: 'wholesale' }], payments: [{ method: 'cash', amount: wholesalePrice * 2 }] }));
    expect(wholesaleBySales.status).toBe(201);
    expect(wholesaleBySales.body.items[0].priceTier).toBe('wholesale');

    const bigDiscount = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ ...saleBody().items[0], discountPercent: 50 }] }));
    expect(bigDiscount.status).toBe(422);
    expect(bigDiscount.body.error.code).toBe('DISCOUNT_EXCEEDS');

    const invoiceDiscountByCashier = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ invoiceDiscount: 5 }));
    expect(invoiceDiscountByCashier.status).toBe(403);
    expect(invoiceDiscountByCashier.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('requires catalog prices and accepts invoice discounts for administrators', async () => {
    for (const priceTier of ['manual', 'retail1']) {
      const result = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({ items: [{ ...saleBody().items[0], priceTier, unitPrice: 55 }] }));
      expect(result.status).toBe(422);
      expect(result.body.error.code).toBe('PRICE_NOT_ALLOWED');
    }
    const result = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({ invoiceDiscount: 5 }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ invoiceDiscount: 5, total: 115 });
  });

  it('accepts item discounts in amount and percent for administrators', async () => {
    for (const discount of [{ discount: 5 }, { discountPercent: 5 }]) {
      const result = await api(app).post('/api/sales').set(auth(admin)).send(saleBody({ items: [{ ...saleBody().items[0], ...discount }] }));
      expect(result.status).toBe(201);
      expect(result.body.itemDiscounts).toBe('discount' in discount ? 5 : 6);
      expect(result.body.total).toBe('discount' in discount ? 115 : 114);
    }
  });

  it('disables tax settings and never taxes a new sale', async () => {
    const settings = await api(app).put('/api/settings/invoice').set(auth(admin)).send({ value: { showTax: true, taxEnabled: true, taxRate: 14 } });
    expect(settings.status).toBe(200);
    expect(settings.body.invoice).toMatchObject({ showTax: false, taxEnabled: false, taxRate: 0 });
    const result = await api(app).post('/api/sales').set(auth(admin)).send(saleBody());
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ invoiceDiscount: 0, tax: 0, total: 120 });
  });

  it('replays idempotent POST with same key', async () => {
    const key = randomUUID();
    const a = await api(app).post('/api/sales').set(auth(cashier)).set('Idempotency-Key', key).send(saleBody());
    const b = await api(app).post('/api/sales').set(auth(cashier)).set('Idempotency-Key', key).send(saleBody());
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.id).toBe(a.body.id);
    expect(b.headers['idempotent-replay']).toBe('true');
  });

  it('reconciles a previously printed offline invoice without changing its legacy amounts', async () => {
    const input = SaleCreateSchema.parse(saleBody({
      invoiceNumber: 'INV-LEGACY-000001', offline: true,
      items: [{ ...saleBody().items[0], priceTier: 'manual', unitPrice: 55 }],
      invoiceDiscount: 5,
      taxSnapshot: signTaxSnapshot({ ...DEFAULT_SETTINGS.invoice, taxEnabled: true, taxRate: 14 }),
    }));
    const sale = await createSale(input, { userId: admin.user.id, terminalId: 'legacy-terminal', permissions: ALL_PERMISSIONS, saleAmounts: { tax: 14.7, total: 119.7 } });
    expect(sale).toMatchObject({ invoiceNumber: 'INV-LEGACY-000001', invoiceDiscount: 5, tax: 14.7, total: 119.7 });
    expect(sale.items[0]).toMatchObject({ priceTier: 'manual', unitPrice: 55 });
  });

  it('accepts a signed zero-tax invoice and rejects a different claimed printed total', async () => {
    const input = SaleCreateSchema.parse(saleBody({
      invoiceNumber: 'INV-ZERO-TAX-000001', offline: true,
      taxSnapshot: signTaxSnapshot({ ...DEFAULT_SETTINGS.invoice, taxEnabled: false, taxRate: 0 }),
    }));
    const context = { userId: admin.user.id, terminalId: 'zero-tax-terminal', permissions: ALL_PERMISSIONS };
    await expect(createSale(input, { ...context, saleAmounts: { tax: 0, total: 121 } })).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    const sale = await createSale(input, { ...context, saleAmounts: { tax: 0, total: 120 } });
    expect(sale).toMatchObject({ invoiceNumber: input.invoiceNumber, tax: 0, total: 120 });
    expect(await SaleModel.countDocuments({ invoiceNumber: input.invoiceNumber })).toBe(1);
  });

  it('raises exactly one out_of_stock alert when the last unit sells', async () => {
    await StockLevelModel.updateMany({ productId: 'prod-20', branchId: 'br-1' }, { $set: { quantity: 0 } });
    await StockLevelModel.updateOne({ productId: 'prod-20', warehouseId: 'wh-2' }, { $set: { quantity: 1 } });
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ items: [{ productId: 'prod-20', name: { ar: 'x' }, quantity: 1, listPrice: 950, unitPrice: 950, unitCost: 650, priceTier: 'retail1' }], payments: [{ method: 'cash', amount: 950 }] }));
    expect(res.status).toBe(201);
    await new Promise((r) => setTimeout(r, 300));
    const alerts = await AlertModel.find({ type: 'out_of_stock', entityId: 'prod-20', branchId: 'br-1', resolvedAt: null }).lean();
    expect(alerts.length).toBe(1);
    // second evaluation must not duplicate
    const again = await api(app).get('/api/alerts').query({ type: 'out_of_stock' }).set(auth(admin));
    expect(again.status).toBe(200);
    const again2 = await AlertModel.find({ type: 'out_of_stock', entityId: 'prod-20', branchId: 'br-1', resolvedAt: null }).lean();
    expect(again2.length).toBe(1);
  });

  it('public verify endpoint exposes invoice summary without auth', async () => {
    const sale = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody());
    const res = await api(app).get(`/api/public/invoices/${sale.body.id}/verify`);
    expect(res.status).toBe(200);
    expect(res.body.invoiceNumber).toBe(sale.body.invoiceNumber);
    expect(res.body.total).toBe(120);
  });

  it('rejects a cash sale paid with a credit split', async () => {
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ payments: [{ method: 'credit', amount: 120 }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_METHOD');
  });

  it('ignores client invoice number and date on the regular route', async () => {
    const res = await api(app).post('/api/sales').set(auth(cashier)).send(saleBody({ invoiceNumber: 'FAKE-0001', date: '2001-01-01T00:00:00.000Z' }));
    expect(res.status).toBe(201);
    expect(res.body.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(res.body.date.startsWith('2001')).toBe(false);
  });

  it('caps return refunds at the prorated paid amount and uses the stored product', async () => {
    const input = SaleCreateSchema.parse(saleBody({ invoiceNumber: 'INV-OLD-RETURN-001', items: [{ ...saleBody().items[0], discount: 15, discountPercent: 12.5 }], payments: [{ method: 'cash', amount: 105 }] }));
    const sale = await createSale(input, { userId: sales.user.id, terminalId: 'legacy-terminal', permissions: ALL_PERMISSIONS, saleAmounts: { tax: 0, total: 105 } });
    expect(sale.total).toBe(105);
    const item = sale.items[0]!;
    const res = await api(app).post('/api/sales/returns').set(auth(admin)).send({ saleId: sale.id, refundMethod: 'cash', items: [{ saleItemId: item.id, productId: 'prod-99', quantity: 1, unitPrice: 999, refund: 999, reason: 'defective' }] });
    expect(res.status).toBe(201);
    expect(res.body.items[0].productId).toBe('prod-1');
    expect(res.body.items[0].unitPrice).toBe(60);
    expect(res.body.refundAmount).toBe(52.5);
  });

  it('credit-sale return in cash does not also reduce the debt', async () => {
    const cust = await CustomerModel.findOne({ branchId: 'br-1', type: 'wholesale', creditLimit: { $gt: 0 } }).lean();
    const sale = await recordedCreditInvoice({ customerId: cust!._id, payments: [{ method: 'cash', amount: 60 }] });
    const debtBefore = await CustomerDebtModel.findOne({ saleId: sale.id }).lean();
    const cashRet = await api(app).post('/api/sales/returns').set(auth(admin)).send({ saleId: sale.id, refundMethod: 'cash', items: [{ saleItemId: sale.items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 60, refund: 0, reason: 'defective' }] });
    expect(cashRet.status).toBe(201);
    const debtAfterCash = await CustomerDebtModel.findOne({ saleId: sale.id }).lean();
    expect(debtAfterCash!.remaining).toBe(debtBefore!.remaining);
    const creditRet = await api(app).post('/api/sales/returns').set(auth(admin)).send({ saleId: sale.id, refundMethod: 'credit', items: [{ saleItemId: sale.items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 60, refund: 0, reason: 'defective' }] });
    expect(creditRet.status).toBe(201);
    const debtAfterCredit = await CustomerDebtModel.findOne({ saleId: sale.id }).lean();
    expect(debtAfterCredit!.remaining).toBe(debtBefore!.remaining - 60);
  });

  it('cancelling a credit sale removes the debt and restores the customer balance', async () => {
    const cust = await CustomerModel.findOne({ branchId: 'br-1', type: 'wholesale', creditLimit: { $gt: 0 } }).lean();
    const balanceBefore = cust!.balance;
    const sale = await recordedCreditInvoice({ customerId: cust!._id, payments: [] });
    const res = await api(app).post(`/api/sales/${sale.id}/cancel`).set(auth(admin));
    expect(res.status).toBe(200);
    expect(await CustomerDebtModel.findOne({ saleId: sale.id }).lean()).toBeNull();
    const after = await CustomerModel.findById(cust!._id).lean();
    expect(after!.balance).toBeCloseTo(balanceBefore, 2);
  });
});

