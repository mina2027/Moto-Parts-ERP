/**
 * The outbox only earns its keep if it survives the terminal dying. Every case here uses a real
 * file-backed database, closes it, and reopens it the way a crash-then-restart would.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ApiClient } from '@moto/api-client';
import type { SaleCreateInput } from '@moto/shared';
import { LocalDb } from '../db/database';
import { createLocalOps } from './localOps';
import { NODE_SQLITE, emptyPull, fakeApi, makeWorker, product, recordedCreditSale } from '../test/helpers';

let dir: string;
let file: string;
let open: LocalDb[] = [];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'moto-pos-'));
  file = path.join(dir, 'pos.db');
  open = [];
});
afterEach(() => {
  // Windows will not unlink a sqlite file that still has a handle, even on a failed test.
  for (const db of open) try { db.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});

const saleInput = (over: Partial<SaleCreateInput> = {}): SaleCreateInput => ({
  branchId: 'br-1',
  customerId: null,
  registerSessionId: null,
  items: [{ productId: 'p1', name: { ar: 'فلتر زيت' }, barcode: '2000000000017', sku: 'SKU-1', quantity: 2, listPrice: 100, unitPrice: 100, unitCost: 50, priceTier: 'retail1', discount: 0, discountPercent: 0 }],
  invoiceDiscount: 0,
  payments: [{ method: 'cash', amount: 200 }],
  type: 'cash',
  ...over,
});

/** Opens the on-disk terminal database, seeding the catalogue only on first boot. */
function boot(apiRef: { current: ApiClient | null }, seed = false) {
  const db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
  open.push(db);
  if (seed) db.applyPull(emptyPull({ products: [product()], stockLevels: [{ productId: 'p1', warehouseId: 'w1', branchId: 'br-1', quantity: 10, reserved: 0 }] }), 'br-1', true);
  const { worker, timers } = makeWorker(db, () => apiRef.current);
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', publicUrl: () => 'http://erp.local' });
  return { db, worker, timers, ops };
}

describe('terminal restart', () => {
  it('keeps unsynced sales, their stock effect and the outbox across a crash', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    await first.ops.createSale(saleInput());
    await first.ops.createSale(saleInput());
    expect(first.db.counts()).toEqual({ pending: 2, rejected: 0 });
    expect(first.db.product('p1', 'br-1')?.available).toBe(6);
    first.db.close();

    const second = boot(apiRef);
    expect(second.db.counts()).toEqual({ pending: 2, rejected: 0 });
    expect(second.db.recentSales().map((s) => s.invoiceNumber)).toEqual(['INV-T001-00002', 'INV-T001-00001']);
    expect(second.db.recentSales().every((s) => s.syncStatus === 'pending')).toBe(true);
    expect(second.db.product('p1', 'br-1')?.available).toBe(6);
    second.db.close();
  });

  it('never reissues an invoice number a dead process already used', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    await first.ops.createSale(saleInput());
    await first.ops.createSale(saleInput());
    first.db.close();

    const second = boot(apiRef);
    const third = await second.ops.createSale(saleInput());
    expect(third.invoiceNumber).toBe('INV-T001-00003');
    const numbers = second.db.recentSales().map((s) => s.invoiceNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
    second.db.close();
  });

  it('drains the outbox after the restart and does not resurrect it on the next boot', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    await first.ops.createSale(saleInput());
    await first.ops.createSale(saleInput());
    first.db.close();

    const { api, pushes } = fakeApi();
    apiRef.current = api;
    const second = boot(apiRef);
    await second.worker.syncNow();
    expect(pushes.flatMap((p) => p.ops)).toHaveLength(2);
    expect(second.db.counts()).toEqual({ pending: 0, rejected: 0 });
    expect(second.db.recentSales().every((s) => s.syncStatus === 'synced')).toBe(true);
    second.db.close();

    const third = boot(apiRef);
    expect(third.db.counts()).toEqual({ pending: 0, rejected: 0 });
    expect(third.db.recentSales().every((s) => s.syncStatus === 'synced')).toBe(true);
    await third.worker.syncNow();
    expect(pushes.flatMap((p) => p.ops)).toHaveLength(2);
    third.db.close();
  });

  it('remembers that an op was rejected instead of retrying it forever', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    await first.ops.createSale(saleInput());
    const { api } = fakeApi({ onPush: (req) => req.ops.map((o) => ({ opId: o.opId, status: 'rejected' as const, error: { code: 'INSUFFICIENT_STOCK', message: 'no stock' } })) });
    apiRef.current = api;
    await first.worker.syncNow();
    expect(first.db.counts()).toEqual({ pending: 0, rejected: 1 });
    first.db.close();

    const { api: freshApi, pushes } = fakeApi();
    apiRef.current = freshApi;
    const second = boot(apiRef);
    expect(second.db.counts()).toEqual({ pending: 0, rejected: 1 });
    await second.worker.syncNow();
    expect(pushes).toHaveLength(0);
    expect(second.db.recentSales()[0]!.syncStatus).toBe('failed');
    second.db.close();
  });

  it('survives a close in the middle of a batch with the unsent half still queued', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    await first.ops.createSale(saleInput());
    await first.ops.createSale(saleInput());
    await first.ops.createSale(saleInput({ items: [{ productId: 'p1', name: { ar: 'فلتر زيت' }, barcode: '2000000000017', sku: 'SKU-1', quantity: 1, listPrice: 100, unitPrice: 100, unitCost: 50, priceTier: 'retail1', discount: 0, discountPercent: 0 }], payments: [{ method: 'cash', amount: 100 }] }));

    // The server accepted the first op, then the terminal lost power before the rest went out.
    const firstOp = first.db.pendingOps()[0]!;
    first.db.markOp(firstOp.opId, 'applied', { serverId: 'srv-1' });
    first.db.close();

    const second = boot(apiRef);
    expect(second.db.counts().pending).toBe(2);
    const { api, pushes } = fakeApi();
    apiRef.current = api;
    await second.worker.syncNow();
    expect(pushes.flatMap((p) => p.ops)).toHaveLength(2);
    expect(second.db.counts()).toEqual({ pending: 0, rejected: 0 });
    second.db.close();
  });
});

describe('drawer movements', () => {
  it('survive a restart, keep expectedCash truthful, and drain as cash_movement ops', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    const sess = await first.ops.openSession({ registerId: 'reg-1', openingBalance: 500 });
    await first.ops.createSale(saleInput({ registerSessionId: sess.id })); // 200 cash in
    await first.ops.addCashMovement({ type: 'withdrawal', amount: 150, notes: 'bank run' });
    await first.ops.addCashMovement({ type: 'expense', amount: 50 });
    await first.ops.addCashMovement({ type: 'deposit', amount: 100 });
    // 500 opening + 200 sales + 100 in - 150 out - 50 expenses
    expect(first.ops.projectSession(first.db.openSession()!).expectedCash).toBe(600);
    first.db.close();

    const second = boot(apiRef);
    const reopened = second.ops.projectSession(second.db.openSession()!);
    expect(reopened.expectedCash).toBe(600);
    expect(reopened.movements).toHaveLength(3);
    expect(second.db.counts().pending).toBe(5);

    const { api, pushes } = fakeApi();
    apiRef.current = api;
    await second.worker.syncNow();
    const types = pushes.flatMap((p) => p.ops).map((o) => o.type);
    expect(types.filter((t) => t === 'cash_movement')).toHaveLength(3);
    expect(second.db.counts()).toEqual({ pending: 0, rejected: 0 });
    second.db.close();
  });

  it('closes the shift against the projected cash, not the stale session row', async () => {
    const apiRef = { current: null as ApiClient | null };
    const t = boot(apiRef, true);
    const sess = await t.ops.openSession({ registerId: 'reg-1', openingBalance: 100 });
    await t.ops.createSale(saleInput({ registerSessionId: sess.id })); // +200
    await t.ops.addCashMovement({ type: 'expense', amount: 30 });
    const closed = await t.ops.closeSession({ sessionId: sess.id, actualCash: 250 });
    expect(closed.expectedCash).toBe(270);
    expect(closed.difference).toBe(-20);
    expect(closed.status).toBe('closed');
    t.db.close();
  });

  it('a cash collection reduces the customer balance and lands in the drawer once', async () => {
    const apiRef = { current: null as ApiClient | null };
    const t = boot(apiRef, true);
    await t.ops.openSession({ registerId: 'reg-1', openingBalance: 0 });
    t.db.upsertCustomer({ id: 'c1', code: 'C1', name: { ar: 'عميل' }, phone: '0100', whatsapp: '0100', address: { ar: '' }, type: 'retail', creditLimit: 1000, balance: 400, branchId: 'br-1', isActive: true, createdAt: '', updatedAt: '' });
    await t.ops.recordCustomerPayment({ customerId: 'c1', amount: 150, method: 'cash' });
    expect(t.db.customers().find((c) => c.id === 'c1')!.balance).toBe(250);
    expect(t.ops.projectSession(t.db.openSession()!).expectedCash).toBe(150);
    // One op, not two: the server books the payment_in movement itself.
    expect(t.db.pendingOps().filter((o) => o.type === 'cash_movement')).toHaveLength(0);
    expect(t.db.pendingOps().filter((o) => o.type === 'customer_payment')).toHaveLength(1);
    t.db.close();
  });
});

describe('offline returns', () => {
  it('caps the quantity, puts stock back, refunds the drawer and survives a restart', async () => {
    const apiRef = { current: null as ApiClient | null };
    const first = boot(apiRef, true);
    const sess = await first.ops.openSession({ registerId: 'reg-1', openingBalance: 0 });
    const sale = await first.ops.createSale(saleInput({ registerSessionId: sess.id })); // 2 × 100
    expect(first.db.product('p1', 'br-1')?.available).toBe(8);

    const item = sale.items[0]!;
    await first.ops.createSaleReturn({ saleId: sale.id, items: [{ saleItemId: item.id, productId: 'p1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }], refundMethod: 'cash' });
    expect(first.db.product('p1', 'br-1')?.available).toBe(9);
    expect(first.db.sale(sale.id)!.status).toBe('partially_returned');
    expect(first.ops.projectSession(first.db.openSession()!).expectedCash).toBe(100); // 200 taken − 100 refunded

    await expect(
      first.ops.createSaleReturn({ saleId: sale.id, items: [{ saleItemId: item.id, productId: 'p1', quantity: 2, unitPrice: 100, refund: 0, reason: 'defective' }], refundMethod: 'cash' }),
    ).rejects.toThrow('RETURN_QTY_EXCEEDED');
    first.db.close();

    const second = boot(apiRef);
    expect(second.db.sale(sale.id)!.items[0]!.returnedQty).toBe(1);
    expect(second.db.product('p1', 'br-1')?.available).toBe(9);
    const { api, pushes } = fakeApi();
    apiRef.current = api;
    await second.worker.syncNow();
    expect(pushes.flatMap((p) => p.ops).filter((o) => o.type === 'sale_return')).toHaveLength(1);
    second.db.close();
  });

  it('marks the invoice returned once every line is back and refunds a credit sale to the debt', async () => {
    const apiRef = { current: null as ApiClient | null };
    const t = boot(apiRef, true);
    t.db.upsertCustomer({ id: 'c1', code: 'C1', name: { ar: 'عميل' }, phone: '0100', whatsapp: '0100', address: { ar: '' }, type: 'retail', creditLimit: 1000, balance: 200, branchId: 'br-1', isActive: true, createdAt: '', updatedAt: '' });
    const sale = await recordedCreditSale(t.db, saleInput({ type: 'credit', customerId: 'c1', payments: [] }));
    const item = sale.items[0]!;
    await t.ops.createSaleReturn({ saleId: sale.id, items: [{ saleItemId: item.id, productId: 'p1', quantity: 2, unitPrice: 100, refund: 0, reason: 'wrong_item' }], refundMethod: 'credit' });
    expect(t.db.sale(sale.id)!.status).toBe('returned');
    // The existing debt remains; this sale first added 200 and its return removed those 200.
    expect(t.db.customers().find((c) => c.id === 'c1')!.balance).toBe(200);
    t.db.close();
  });
});
