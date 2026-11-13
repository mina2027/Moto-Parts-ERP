import { afterEach, expect, it } from 'vitest';
import type { SaleCreateInput, Customer } from '@moto/shared';
import { memDb, emptyPull, makeWorker, product, fakeApi, recordedCreditSale } from '../test/helpers';
import { createLocalOps } from './localOps';
import type { LocalDb } from '../db/database';

const open: LocalDb[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });
function boot() {
  const db = memDb(); open.push(db);
  const pull = emptyPull({ products: [product()], salesWarehouseId: 'w1', stockLevels: [{ productId: 'p1', warehouseId: 'w1', branchId: 'br-1', quantity: 10, reserved: 0 }] });
  db.applyPull(pull, 'br-1', true);
  db.upsertSession({ id: 'sess-refund', registerId: 'reg-1', branchId: 'br-1', userId: 'u1', openedAt: new Date().toISOString(), closedAt: null, openingBalance: 100, cashSales: 0, cardSales: 0, transferSales: 0, paymentsIn: 0, paymentsOut: 0, expenses: 0, refunds: 0, expectedCash: 100, actualCash: null, difference: null, status: 'open', movements: [] });
  const { worker } = makeWorker(db, () => null);
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', publicUrl: () => 'http://erp.local' });
  return { db, ops, pull };
}
const input = (over: Partial<SaleCreateInput> = {}): SaleCreateInput => ({ branchId: 'br-1', customerId: null, registerSessionId: null, items: [{ productId: 'p1', name: { ar: 'audit' }, quantity: 1, listPrice: 100, unitPrice: 100, unitCost: 50, priceTier: 'retail1', discount: 0, discountPercent: 0 }], invoiceDiscount: 0, payments: [{ method: 'cash', amount: 100 }], type: 'cash', ...over });
const customer: Customer = { id: 'cust-audit', code: 'AUDIT', name: { ar: 'audit' }, phone: '', whatsapp: '', address: { ar: '' }, type: 'retail', creditLimit: 150, balance: 0, branchId: 'br-1', isActive: true, createdAt: '', updatedAt: '' };

it('stores invoice notes locally and includes them in the sync operation', async () => {
  const { db, ops } = boot();
  const notes = 'تسليم غداً\nيرجى الاتصال أولاً';
  const sale = await ops.createSale(input({ notes }));
  expect(db.sale(sale.id)?.notes).toBe(notes);
  expect(db.pendingOps()[0].payload).toMatchObject({ notes });
});

it('excludes reserved units from local availability and stock guards', async () => {
  const { db, ops, pull } = boot();
  db.applyPull({ ...pull, stockLevels: [{ ...pull.stockLevels[0]!, reserved: 9 }] }, 'br-1', true);
  expect(db.product('p1', 'br-1')?.available).toBe(1);
  await expect(ops.createSale(input({ items: [{ ...input().items[0]!, quantity: 2 }], payments: [{ method: 'cash', amount: 200 }] }))).rejects.toThrow('INSUFFICIENT_STOCK');
  expect(db.counts().pending).toBe(0);
});

it('blocks a sale with no stock row even when old settings allow negative stock', async () => {
  const { db, ops, pull } = boot();
  db.applyPull({ ...pull, settings: { ...pull.settings, invoice: { ...pull.settings.invoice, allowNegativeStock: true } }, stockLevels: [] }, 'br-1', true);
  await expect(ops.createSale(input())).rejects.toThrow('INSUFFICIENT_STOCK');
  expect(db.product('p1', 'br-1')?.available).toBe(0);
  expect(db.recentSales()).toHaveLength(0);
  expect(db.counts().pending).toBe(0);
});

it('checks repeated product rows together and stops further sales when stock reaches zero', async () => {
  const { db, ops, pull } = boot();
  db.applyPull({ ...pull, stockLevels: [{ ...pull.stockLevels[0]!, quantity: 2 }] }, 'br-1', true);
  await expect(ops.createSale(input({ items: [{ ...input().items[0]!, quantity: 2 }, input().items[0]!], payments: [{ method: 'cash', amount: 300 }] }))).rejects.toThrow('INSUFFICIENT_STOCK');
  expect(db.product('p1', 'br-1')?.available).toBe(2);
  expect(db.recentSales()).toHaveLength(0);
  const sale = await ops.createSale(input({ items: [{ ...input().items[0]!, quantity: 2 }], payments: [{ method: 'cash', amount: 200 }] }));
  expect(sale.total).toBe(200);
  expect(db.product('p1', 'br-1')?.available).toBe(0);
  await expect(ops.createSale(input())).rejects.toThrow('INSUFFICIENT_STOCK');
  expect(db.recentSales()).toHaveLength(1);
  expect(db.counts().pending).toBe(1);
});

it('ignores legacy tax settings for new sales and pushes the same printed amounts', async () => {
  const { db, ops, pull } = boot();
  const taxSnapshot = 'signed-offline-tax';
  db.applyPull({ ...pull, settings: { ...pull.settings, invoice: { ...pull.settings.invoice, showTax: false, taxEnabled: true, taxRate: 14, taxSnapshot } } }, 'br-1', true);
  const sale = await ops.createSale(input());
  expect(sale).toMatchObject({ invoiceDiscount: 0, tax: 0, total: 100 });
  const payload = db.pendingOps()[0]!.payload; expect(payload.taxSnapshot).toBeUndefined();
  const { api, pushes } = fakeApi(); const { worker } = makeWorker(db, () => api);
  await worker.syncNow();
  expect(pushes[0]!.ops[0]).toMatchObject({ payload, saleAmounts: { tax: 0, total: 100 } });
});

it('pins the signed zero-tax policy so an older server cannot add tax during sync', async () => {
  const { db, ops, pull } = boot();
  const taxSnapshot = `${Buffer.from(JSON.stringify({ rate: 0 })).toString('base64url')}.server-signature`;
  db.applyPull({ ...pull, settings: { ...pull.settings, invoice: { ...pull.settings.invoice, taxSnapshot } } }, 'br-1', true);
  const sale = await ops.createSale(input());
  db.applyPull({ ...pull, settings: { ...pull.settings, invoice: { ...pull.settings.invoice, taxSnapshot: `${Buffer.from(JSON.stringify({ rate: 14 })).toString('base64url')}.later-signature` } } }, 'br-1', false);
  const { api, pushes } = fakeApi();
  const { worker } = makeWorker(db, () => api);
  await worker.syncNow();
  expect(sale).toMatchObject({ tax: 0, total: 100 });
  expect(pushes[0]!.ops[0]).toMatchObject({ payload: { taxSnapshot }, saleAmounts: { tax: 0, total: 100 } });
});

it('preserves advance balances on previously recorded credit invoices', async () => {
  const { db, ops, pull } = boot(); db.upsertCustomer({ ...customer, balance: -100 });
  db.applyPull({ ...pull, products: [product({ prices: { retail1: 150, retail2: 90, wholesale: 80 } })] }, 'br-1', false);
  const sale = await recordedCreditSale(db, input({ customerId: customer.id, type: 'credit', items: [{ ...input().items[0]!, unitPrice: 150 }], payments: [] }));
  expect(sale).toMatchObject({ total: 150, paid: 100, remaining: 50 }); expect(db.customers()[0]?.balance).toBe(50);
  await ops.recordCustomerPayment({ customerId: customer.id, amount: 50, method: 'card' });
  expect(db.customers()[0]?.balance).toBe(0);
});

it('rejects combined discounts exceeding the allowance before committing an offline invoice', async () => {
  const { db, pull } = boot();
  db.applyPull({ ...pull, settings: { ...pull.settings, pos: { ...pull.settings.pos, maxDiscountAmount: 20 } } }, 'br-1', true);
  const { worker } = makeWorker(db, () => null);
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', permissions: () => ['sales.create', 'discounts.item', 'discounts.invoice'], publicUrl: () => 'http://erp.local' });
  await expect(ops.createSale(input({ items: [{ ...input().items[0]!, discount: 15 }], invoiceDiscount: 15, payments: [{ method: 'cash', amount: 70 }] }))).rejects.toThrow('DISCOUNT_EXCEEDS');
  expect(db.counts().pending).toBe(0); expect(db.product('p1', 'br-1')?.available).toBe(10);
});

it('saves item discounts in amount and percent with the invoice discount in the outbox', async () => {
  const { db, ops } = boot();
  for (const discount of [{ discount: 5 }, { discountPercent: 5 }]) {
    const sale = await ops.createSale(input({ items: [{ ...input().items[0]!, ...discount }], invoiceDiscount: 3, payments: [{ method: 'cash', amount: 92 }] }));
    expect(sale).toMatchObject({ subtotal: 100, itemDiscounts: 5, invoiceDiscount: 3, total: 92, paid: 92 });
    expect(sale.items[0]).toMatchObject({ discount: 5, discountPercent: 0, subtotal: 95 });
  }
  expect(db.counts().pending).toBe(2);
  expect(db.pendingOps()[0].payload).toMatchObject({ invoiceDiscount: 3 });
  expect(db.product('p1', 'br-1')?.available).toBe(8);
});

it('enforces discount permissions and accepts the exact combined offline allowance', async () => {
  const { db, pull } = boot();
  db.applyPull({ ...pull, settings: { ...pull.settings, pos: { ...pull.settings.pos, maxDiscountAmount: 20 } } }, 'br-1', true);
  const { worker } = makeWorker(db, () => null);
  let permissions = ['sales.create'];
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', permissions: () => permissions, publicUrl: () => 'http://erp.local' });
  await expect(ops.createSale(input({ items: [{ ...input().items[0]!, discount: 5 }] }))).rejects.toThrow('PERMISSION_DENIED');
  await expect(ops.createSale(input({ invoiceDiscount: 5 }))).rejects.toThrow('PERMISSION_DENIED');
  expect(db.counts().pending).toBe(0);
  permissions = ['sales.create', 'discounts.item', 'discounts.invoice'];
  const sale = await ops.createSale(input({ items: [{ ...input().items[0]!, discountPercent: 10 }], invoiceDiscount: 10, payments: [{ method: 'cash', amount: 80 }] }));
  expect(sale).toMatchObject({ total: 80, itemDiscounts: 10, invoiceDiscount: 10 });
});

it('refunds only the paid amount after item and invoice discounts', async () => {
  const { ops } = boot();
  const sale = await ops.createSale(input({ items: [{ ...input().items[0]!, discount: 10, quantity: 2 }], invoiceDiscount: 20, payments: [{ method: 'cash', amount: 170 }] }));
  const returned = await ops.createSaleReturn({ saleId: sale.id, items: [{ saleItemId: sale.items[0].id, productId: 'p1', quantity: 2, unitPrice: 100, refund: 0, reason: 'other' }], refundMethod: 'cash' });
  expect(returned.refundAmount).toBe(170);
});

it('rejects electronic overpayments before committing offline stock or outbox changes', async () => {
  const { db, ops } = boot();
  await expect(ops.createSale(input({ payments: [{ method: 'card', amount: 150 }] }))).rejects.toThrow('OVERPAYMENT');
  expect(db.product('p1', 'br-1')?.available).toBe(10);
  expect(db.counts().pending).toBe(0);
  const sale = await ops.createSale(input({ payments: [{ method: 'card', amount: 80 }, { method: 'cash', amount: 50 }] }));
  expect(sale).toMatchObject({ total: 100, paid: 100, change: 30 });
});

it('keeps pending deductions after full and delta pulls, without accumulating deductions', async () => {
  const { db, ops, pull } = boot();
  await ops.createSale(input({ items: [{ ...input().items[0]!, quantity: 2 }], payments: [{ method: 'cash', amount: 200 }] }));
  for (const full of [false, false, true]) {
    db.applyPull(pull, 'br-1', full);
    expect(db.product('p1', 'br-1')?.available).toBe(8);
    expect(db.counts().pending).toBe(1);
  }
  db.applyPull(emptyPull(), 'br-1', false);
  expect(db.product('p1', 'br-1')?.available).toBe(8);
});

it('does not deduct an acknowledged sale twice after its response was lost', async () => {
  const { db, ops, pull } = boot();
  await ops.createSale(input());
  const opId = db.pendingOps()[0]!.opId;
  db.applyPull({ ...pull, stockLevels: [{ ...pull.stockLevels[0]!, quantity: 9 }], acknowledgedOps: [{ opId, status: 'duplicate', serverId: 'sale-server' }] }, 'br-1', false);
  expect(db.product('p1', 'br-1')?.available).toBe(9);
});

it('preserves a sale created during an awaited pull and drains acknowledged ops atomically', async () => {
  const { db, ops, pull } = boot();
  const { api, mock } = fakeApi();
  const { worker } = makeWorker(db, () => api);
  mock.sync.pull.mockImplementationOnce(async () => { await ops.createSale(input()); return pull; });
  await worker.syncNow();
  expect(db.product('p1', 'br-1')?.available).toBe(9);
  expect(db.counts().pending).toBe(1);
});

it('creates credit sales atomically and enforces the cumulative customer limit', async () => {
  const { db, ops } = boot(); db.upsertCustomer(customer);
  const sale = await ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [] }));
  expect(sale).toMatchObject({ type: 'credit', paid: 0, remaining: 100, change: 0 });
  await expect(ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [] }))).rejects.toThrow('CUSTOMER_CREDIT_EXCEEDED');
  expect(db.customers()[0]?.balance).toBe(100);
  expect(db.counts().pending).toBe(1);
  expect(db.product('p1', 'br-1')?.available).toBe(9);
  const partial = await ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [{ method: 'cash', amount: 50 }] }));
  expect(partial).toMatchObject({ paid: 50, remaining: 50 });
  expect(db.customers()[0]?.balance).toBe(150);
});

it('requires a local active customer and rejects credit overpayment before committing', async () => {
  const { db, ops } = boot(); db.upsertCustomer(customer);
  await expect(ops.createSale(input({ type: 'credit', payments: [] }))).rejects.toThrow('CUSTOMER_REQUIRED');
  await expect(ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [{ method: 'cash', amount: 150 }] }))).rejects.toThrow('OVERPAYMENT');
  db.upsertCustomer({ ...customer, branchId: 'br-other' });
  await expect(ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [] }))).rejects.toThrow('BRANCH_DENIED');
  expect(db.customers()[0]?.balance).toBe(0);
  expect(db.product('p1', 'br-1')?.available).toBe(10);
  expect(db.counts().pending).toBe(0);
});

it('uses customer advances on new credit invoices and preserves the effect through pulls', async () => {
  const { db, ops, pull } = boot(); db.upsertCustomer({ ...customer, balance: -60 });
  const sale = await ops.createSale(input({ customerId: customer.id, type: 'credit', payments: [] }));
  expect(sale).toMatchObject({ total: 100, paid: 60, remaining: 40 });
  expect(db.customers()[0]?.balance).toBe(40);
  for (const full of [false, true]) {
    db.applyPull({ ...pull, customers: [{ ...customer, balance: -60 }] }, 'br-1', full);
    expect(db.customers()[0]?.balance).toBe(40);
    expect(db.product('p1', 'br-1')?.available).toBe(9);
  }
});

it('retains stable invoice and line references for a synced local sale return', async () => {
  const { db, ops } = boot(); const sale = await ops.createSale(input());
  db.markSaleSynced(sale.id, 'sale-server-audit');
  await ops.createSaleReturn({ saleId: sale.id, refundMethod: 'cash', items: [{ saleItemId: sale.items[0]!.id, productId: 'p1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] });
  expect(db.pendingOps().find(o => o.type === 'sale_return')?.payload).toMatchObject({ saleId: sale.id, invoiceNumber: sale.invoiceNumber, lineIndexes: [0] });
});

it('keeps new customers and their debt through a full bootstrap', async () => {
  const { db, ops, pull } = boot();
  const created = await ops.createCustomer({ name: { ar: 'offline' }, phone: '', type: 'retail', creditLimit: 150 });
  await recordedCreditSale(db, input({ customerId: created.id, type: 'credit', payments: [] }));
  db.applyPull(pull, 'br-1', true);
  expect(db.customers().find(c => c.id === created.id)?.balance).toBe(100);
});

it('preserves credit sale and refund effects together through repeated snapshots', async () => {
  const { db, ops, pull } = boot(); db.upsertCustomer({ ...customer, creditLimit: 1000 });
  const sale = recordedCreditSale(db, input({ customerId: customer.id, type: 'credit', payments: [] }));
  await ops.createSaleReturn({ saleId: sale.id, refundMethod: 'credit', items: [{ saleItemId: sale.items[0]!.id, productId: 'p1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] });
  for (let attempt = 0; attempt < 2; attempt++) {
    db.applyPull({ ...pull, customers: [{ ...customer, creditLimit: 1000 }] }, 'br-1', false);
    expect(db.customers()[0]?.balance).toBe(0);
    expect(db.product('p1', 'br-1')?.available).toBe(10);
  }
});

it('rejects manual and off-tier prices while retaining all three catalog tiers', async () => {
  const { db, ops } = boot();
  for (const row of [{ unitPrice: 75, priceTier: 'manual' as const }, { unitPrice: 75, priceTier: 'retail1' as const }]) {
    await expect(ops.createSale(input({ items: [{ ...input().items[0]!, ...row }] }))).rejects.toThrow('PRICE_NOT_ALLOWED');
  }
  expect(db.counts().pending).toBe(0);
  expect(db.product('p1', 'br-1')?.available).toBe(10);
  for (const [priceTier, unitPrice] of [['retail1', 100], ['retail2', 90], ['wholesale', 80]] as const) {
    const sale = await ops.createSale(input({ items: [{ ...input().items[0]!, priceTier, unitPrice }], payments: [{ method: 'cash', amount: unitPrice }] }));
    expect(sale.total).toBe(unitPrice);
  }
});
