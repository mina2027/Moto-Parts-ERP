import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { Express } from 'express';
import { SaleCreateSchema, DEFAULT_SETTINGS, ROLE_PERMISSIONS } from '@moto/shared';
import { api, loginAs, startTestDb, stopTestDb } from './harness.js';
import { CashRegisterModel, CustomerDebtModel, CustomerModel, ExpenseCategoryModel, ProductModel, RegisterSessionModel, SaleModel, StockCountModel, StockLevelModel, TransferModel, UserModel, WarehouseModel, stockLevelId } from '../db/models.js';
import { applyMovement, salesWarehouseFor } from '../modules/inventory/stock.js';
import { getSettings, replaceSettings, updateSettingsSection } from '../modules/settings/service.js';
import { signTaxSnapshot } from '../modules/settings/taxSnapshot.js';
import { createSale } from '../modules/sales/service.js';
import { customerStatement } from '../modules/customers/service.js';
import { accounting } from '../modules/reports/service.js';
import { withTransaction } from '../db/connect.js';
import * as socket from '../realtime/socket.js';
import { businessDay } from '../lib/businessTime.js';

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;
let manager: Awaited<ReturnType<typeof loginAs>>;
let cashier: Awaited<ReturnType<typeof loginAs>>;
let warehouseId: string;
let categoryId: string;
const pid = 'logic-product';
const sessions = ['logic-drawer-a', 'logic-drawer-b'];
const auth = (who = admin) => ({ Authorization: `Bearer ${who.token}` });
const body = (over: object = {}) => ({ branchId: 'br-1', registerSessionId: sessions[0], items: [{ productId: pid, name: { ar: 'logic' }, quantity: 1, unitPrice: 100 }], payments: [{ method: 'cash', amount: 100 }], type: 'cash', ...over });
const checkout = (input = body(), who = admin) => api(app).post('/api/sales').set(auth(who)).set('Idempotency-Key', randomUUID()).send(input);
const customer = async (id: string) => {
  await CustomerModel.create({ _id: id, code: id, name: { ar: 'logic' }, address: { ar: '' }, branchId: 'br-1', type: 'retail', creditLimit: 1000, balance: 0, isActive: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  return id;
};

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  admin = await loginAs(app, 'admin'); manager = await loginAs(app, 'khaled.m'); cashier = await loginAs(app, 'cashier1');
  await UserModel.updateOne({ _id: cashier.user.id }, { $addToSet: { extraPermissions: 'expenses.create' } });
  const product = (await ProductModel.findById('prod-1').lean())!;
  await ProductModel.create({ ...product, _id: pid, sku: pid, internalBarcode: pid, legacyBarcode: undefined });
  warehouseId = await salesWarehouseFor('br-1');
  categoryId = (await ExpenseCategoryModel.findOne().lean())!._id;
  for (const [index, id] of sessions.entries()) {
    const regId = `logic-register-${index}`;
    await CashRegisterModel.create({ _id: regId, code: regId, name: { ar: 'logic' }, branchId: 'br-1', isActive: true });
    await RegisterSessionModel.create({ _id: id, registerId: regId, branchId: 'br-1', userId: admin.user.id, openedAt: new Date().toISOString(), status: 'open', openingBalance: 10000, expectedCash: 10000 });
  }
}, 60_000);
beforeEach(async () => {
  await replaceSettings(DEFAULT_SETTINGS);
  await ProductModel.updateOne({ _id: pid }, { $set: { prices: { retail1: 100, retail2: 100, wholesale: 100 }, lastPurchaseCost: 60, purchasePrice: 60, isActive: true } });
  await StockLevelModel.updateOne({ _id: stockLevelId(pid, warehouseId) }, { $set: { productId: pid, warehouseId, branchId: 'br-1', quantity: 100, reserved: 0 } }, { upsert: true });
});
afterAll(stopTestDb);

it('requires a complete count and refuses to overwrite stock sold after the count', async () => {
  const created = await api(app).post('/api/inventory/counts').set(auth()).send({ branchId: 'br-1', warehouseId, productIds: [pid] });
  expect(created.status).toBe(201);
  const url = `/api/inventory/counts/${created.body.id}`;
  expect((await api(app).post(`${url}/finish`).set(auth())).body.error.code).toBe('COUNT_INCOMPLETE');
  await api(app).patch(`${url}/items`).set(auth()).send({ productId: pid, counted: 98 });
  expect((await checkout()).status).toBe(201);
  const stale = await api(app).post(`${url}/finish`).set(auth());
  expect(stale.body.error.code).toBe('COUNT_STOCK_CHANGED');
  expect((await StockLevelModel.findById(stockLevelId(pid, warehouseId)).lean())?.quantity).toBe(99);
  expect((await StockCountModel.findById(created.body.id).lean())?.status).toBe('in_progress');
  await api(app).patch(`${url}/items`).set(auth()).send({ productId: pid, counted: 97 });
  expect((await api(app).post(`${url}/finish`).set(auth())).status).toBe(200);
  expect((await StockLevelModel.findById(stockLevelId(pid, warehouseId)).lean())?.quantity).toBe(97);
});

it('keeps a warehouse and its existing stock in the same branch', async () => {
  const wh = (await WarehouseModel.findById(warehouseId).lean())!;
  const result = await api(app).put(`/api/warehouses/${warehouseId}`).set(auth()).send({ ...wh, name: wh.name, branchId: 'br-2' });
  expect(result.body.error.code).toBe('WAREHOUSE_BRANCH_IMMUTABLE');
  expect((await WarehouseModel.findById(warehouseId).lean())?.branchId).toBe('br-1');
});

it('allows transfer dispatch only at its source and receipt only at its destination', async () => {
  const source = (await WarehouseModel.findOne({ branchId: 'br-2', isActive: true }).lean())!;
  await StockLevelModel.updateOne({ _id: stockLevelId(pid, source._id) }, { $set: { productId: pid, warehouseId: source._id, branchId: 'br-2', quantity: 10, reserved: 0 } }, { upsert: true });
  const created = await api(app).post('/api/transfers').set(auth()).send({ sourceBranchId: 'br-2', destinationBranchId: 'br-1', sourceWarehouseId: source._id, items: [{ productId: pid, requestedQty: 2 }] });
  expect(created.status).toBe(201);
  const url = `/api/transfers/${created.body.id}/advance`;
  for (const next of ['approved', 'sent']) {
    expect((await api(app).post(url).set(auth(manager)).send({ next })).status).toBe(403);
    expect((await api(app).post(url).set(auth()).send({ next })).status).toBe(200);
  }
  expect((await api(app).post(url).set(auth(manager)).send({ next: 'received' })).status).toBe(200);
  expect((await TransferModel.findById(created.body.id).lean())?.status).toBe('received');
  const outgoing = await api(app).post('/api/transfers').set(auth()).send({ sourceBranchId: 'br-1', destinationBranchId: 'br-2', sourceWarehouseId: warehouseId, items: [{ productId: pid, requestedQty: 2 }] });
  for (const next of ['approved', 'sent']) expect((await api(app).post(`/api/transfers/${outgoing.body.id}/advance`).set(auth(manager)).send({ next })).status).toBe(200);
  expect((await api(app).post(`/api/transfers/${outgoing.body.id}/advance`).set(auth(manager)).send({ next: 'received' })).status).toBe(403);
});

it('shows sale availability after excluding transfer reservations', async () => {
  await StockLevelModel.updateOne({ _id: stockLevelId(pid, warehouseId) }, { $set: { quantity: 10, reserved: 8 } });
  const product = await api(app).get(`/api/products/${pid}`).set(auth(cashier)).query({ branchId: 'br-1' });
  expect(product.status).toBe(200); expect(product.body.saleStock).toBe(2);
});

it('rejects combined discounts exceeding the configured allowance', async () => {
  const settings = await getSettings(); await updateSettingsSection('pos', { ...settings.pos, maxDiscountAmount: 20 });
  const result = await checkout(body({ items: [{ productId: pid, name: { ar: 'logic' }, quantity: 1, unitPrice: 100, discount: 15 }], invoiceDiscount: 15, payments: [{ method: 'cash', amount: 70 }] }), manager);
  expect(result.status).toBe(422); expect(result.body.error.code).toBe('DISCOUNT_EXCEEDS');
});

it('keeps new invoices tax-free despite attempts to enable or display tax', async () => {
  const settings = await getSettings();
  await updateSettingsSection('invoice', { ...settings.invoice, showTax: false, taxEnabled: true, taxRate: 14 });
  const result = await checkout(body({ payments: [{ method: 'cash', amount: 114 }] }));
  expect(result.status).toBe(201); expect(result.body).toMatchObject({ tax: 0, total: 100 });
  expect((await getSettings()).invoice).toMatchObject({ taxEnabled: false, showTax: false, taxRate: 0 });
  await updateSettingsSection('invoice', { ...(await getSettings()).invoice, showTax: true });
  const visible = await checkout(body({ payments: [{ method: 'cash', amount: 114 }] }));
  expect(visible.body.total).toBe(result.body.total);
});

it('reconciles a historical signed taxed invoice after tax is disabled and rejects altered signatures', async () => {
  const settings = await getSettings();
  const captured = signTaxSnapshot({ ...settings.invoice, taxEnabled: true, taxRate: 14 });
  await updateSettingsSection('invoice', { ...(await getSettings()).invoice, taxRate: 20 });
  const input = SaleCreateSchema.parse(body({ taxSnapshot: captured, payments: [{ method: 'cash', amount: 114 }] }));
  const ctx = { userId: admin.user.id, terminalId: 'logic-terminal', permissions: ROLE_PERMISSIONS.admin, saleAmounts: { tax: 14, total: 114 } };
  const sale = await createSale(input, ctx); expect(sale).toMatchObject({ tax: 14, total: 114 });
  await expect(createSale({ ...input, taxSnapshot: captured + 'x' }, ctx)).rejects.toMatchObject({ code: 'INVALID_TAX_SNAPSHOT' });
  await expect(createSale({ ...input, taxSnapshot: undefined }, ctx)).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
});

it('requires edit permission when POST targets an existing customer', async () => {
  const id = await customer('logic-customer-edit');
  const result = await api(app).post('/api/customers').set(auth(cashier)).send({ id, name: { ar: 'changed' }, branchId: 'br-1' });
  expect(result.status).toBe(403); expect((await CustomerModel.findById(id).lean())?.name.ar).toBe('logic');
});

it('does not grant price editing through debt collection permission', async () => {
  await UserModel.updateOne({ _id: cashier.user.id }, { $addToSet: { extraPermissions: 'customers.credit' } });
  const result = await api(app).post('/api/customers/special-prices').set(auth(cashier)).send({ customerId: 'unused', productId: pid, price: 1, validFrom: new Date().toISOString() });
  expect(result.status).toBe(403);
});

it('debits an approved pending expense exactly once and prevents silent reversal', async () => {
  const before = (await RegisterSessionModel.findById(sessions[0]).lean())!;
  const created = await api(app).post('/api/expenses').set(auth(cashier)).send({ categoryId, branchId: 'br-1', registerId: 'logic-register-0', amount: 1200, description: { ar: 'logic' } });
  expect(created.status).toBe(201); expect(created.body.status).toBe('pending');
  expect((await RegisterSessionModel.findById(sessions[0]).lean())?.expenses).toBe(before.expenses);
  for (let attempt = 0; attempt < 2; attempt++) expect((await api(app).patch(`/api/expenses/${created.body.id}/status`).set(auth()).send({ status: 'approved' })).status).toBe(200);
  const after = (await RegisterSessionModel.findById(sessions[0]).lean())!;
  expect(after.expenses).toBe(before.expenses + 1200); expect(after.expectedCash).toBe(before.expectedCash - 1200);
  expect(after.movements.filter(m => m.reference === created.body.code)).toHaveLength(1);
  expect((await api(app).patch(`/api/expenses/${created.body.id}/status`).set(auth()).send({ status: 'rejected' })).body.error.code).toBe('EXPENSE_FINALIZED');
});

it('rejects foreign branch expenses and registers belonging to a different branch', async () => {
  const input = { categoryId, branchId: 'br-2', amount: 100, description: { ar: 'logic' } };
  expect((await api(app).post('/api/expenses').set(auth(cashier)).send(input)).status).toBe(403);
  expect((await api(app).post('/api/expenses').set(auth()).send({ ...input, registerId: 'logic-register-0' })).body.error.code).toBe('BRANCH_DENIED');
});

it('applies a customer advance to a credit invoice without losing or double counting it', async () => {
  const id = await customer('logic-customer-advance');
  const payment = (amount: number) => api(app).post('/api/debts/payments').set(auth()).set('Idempotency-Key', randomUUID()).send({ customerId: id, branchId: 'br-1', amount, method: 'card' });
  expect((await payment(100)).status).toBe(201);
  await ProductModel.updateOne({ _id: pid }, { $set: { 'prices.retail1': 150 } });
  const result = await checkout(body({ customerId: id, type: 'credit', registerSessionId: null, items: [{ productId: pid, name: { ar: 'logic' }, quantity: 1, unitPrice: 150 }], payments: [] }));
  expect(result.status).toBe(201); expect(result.body).toMatchObject({ total: 150, paid: 100, remaining: 50 });
  expect((await CustomerModel.findById(id).lean())?.balance).toBe(50);
  expect((await payment(50)).status).toBe(201);
  expect((await CustomerModel.findById(id).lean())?.balance).toBe(0);
  expect((await CustomerDebtModel.findOne({ saleId: result.body.id }).lean())?.remaining).toBe(0);
  expect((await SaleModel.findById(result.body.id).lean())?.remaining).toBe(0);
  expect((await customerStatement(id))[0]?.balance).toBe(0);
});

it('refunds cash only from the selected open drawer and refuses ambiguous selection', async () => {
  const sold = await checkout(); expect(sold.status).toBe(201);
  const input = { saleId: sold.body.id, refundMethod: 'cash', items: [{ saleItemId: sold.body.items[0].id, productId: pid, quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] };
  const ambiguous = await api(app).post('/api/sales/returns').set(auth()).send(input);
  expect(ambiguous.body.error.code).toBe('REGISTER_SESSION_REQUIRED');
  const beforeA = (await RegisterSessionModel.findById(sessions[0]).lean())!;
  const beforeB = (await RegisterSessionModel.findById(sessions[1]).lean())!;
  const result = await api(app).post('/api/sales/returns').set(auth()).send({ ...input, registerSessionId: sessions[1] });
  expect(result.status).toBe(201); expect(result.body.registerSessionId).toBe(sessions[1]);
  expect((await RegisterSessionModel.findById(sessions[0]).lean())?.refunds).toBe(beforeA.refunds);
  expect((await RegisterSessionModel.findById(sessions[1]).lean())?.refunds).toBe(beforeB.refunds + 100);
});

it('includes purchase discount in the cost used for subsequent sale profit', async () => {
  const po = await api(app).post('/api/purchases').set(auth()).send({ supplierId: 'sup-1', branchId: 'br-1', warehouseId, items: [{ productId: pid, name: { ar: 'logic' }, quantity: 2, unitCost: 100 }], discount: 40 });
  expect(po.status).toBe(201);
  expect((await api(app).post(`/api/purchases/${po.body.id}/receive`).set(auth()).send({ quantities: { [po.body.items[0].id]: 2 } })).status).toBe(200);
  expect((await ProductModel.findById(pid).lean())?.lastPurchaseCost).toBe(80);
  const sold = await checkout(); expect(sold.body.items[0].unitCost).toBe(80);
});

it('scopes performance and cost fields, and accounts for returns consistently', async () => {
  const day = businessDay(Date.now()), from = day.slice(0, 7) + '-01';
  const before = await accounting({ from, to: day, branchId: 'br-1' });
  const sold = await checkout();
  const returned = await api(app).post('/api/sales/returns').set(auth()).send({ saleId: sold.body.id, registerSessionId: sessions[0], refundMethod: 'cash', items: [{ saleItemId: sold.body.items[0].id, productId: pid, quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] });
  expect(returned.status).toBe(201);
  const after = await accounting({ from, to: day, branchId: 'br-1' }); expect(after.grossProfit).toBeCloseTo(before.grossProfit, 2);
  const result = await api(app).get('/api/branches/performance').set(auth(manager));
  expect(result.status).toBe(200); expect(result.body).toHaveLength(1); expect(result.body[0].branch.id).toBe('br-1');
  expect(result.body[0].profit).toBe(after.grossProfit);
  await UserModel.updateOne({ _id: cashier.user.id }, { $addToSet: { extraPermissions: 'reports.view' } });
  const hidden = await api(app).get('/api/branches/performance').set(auth(cashier));
  expect(hidden.status).toBe(200); expect(hidden.body).toHaveLength(1); expect(hidden.body[0]).toMatchObject({ profit: 0, net: 0, inventory: 0 });
});

it('emits stock changes only after a successful transaction commit', async () => {
  await new Promise(resolve => setTimeout(resolve, 180));
  const spy = vi.spyOn(socket, 'emitToBranch');
  const movement = { productId: pid, warehouseId, branchId: 'br-1', delta: -1, type: 'sale' as const, userId: admin.user.id, reference: 'logic-rollback' };
  try {
    await expect(withTransaction(async session => { await applyMovement(movement, session); throw new Error('rollback'); })).rejects.toThrow('rollback');
    await new Promise(resolve => setTimeout(resolve, 180)); expect(spy).not.toHaveBeenCalled();
    await withTransaction(async session => { await applyMovement(movement, session); expect(spy).not.toHaveBeenCalled(); });
    await new Promise(resolve => setTimeout(resolve, 180)); expect(spy).toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
