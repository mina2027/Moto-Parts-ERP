import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Customer } from '@moto/shared';
import { LocalDb } from './db/database';
import { createLocalOps } from './sync/localOps';
import { emptyPull, makeWorker, NODE_SQLITE, product, recordedCreditSale } from './test/helpers';
import { settleRejectedSale } from './rejectedSettlement';

function setup(db: LocalDb) {
  db.applyPull(emptyPull({ products: [product()], customers: [{ id: 'c1', name: { ar: 'synthetic' }, branchId: 'br-1', balance: 0, creditLimit: 1000, type: 'retail', isActive: true } as Customer], stockLevels: [{ productId: 'p1', branchId: 'br-1', warehouseId: 'wh-1', quantity: 10, reserved: 0 }] }), 'br-1', true);
  return createLocalOps({ db, worker: makeWorker(db, () => null).worker, terminalCode: () => 'A', terminalId: () => 'term-A', branchId: () => 'br-1', userId: () => 'user', publicUrl: () => 'http://127.0.0.1' });
}
const input = { branchId: 'br-1', customerId: 'c1', items: [{ productId: 'p1', name: { ar: 'synthetic' }, quantity: 1, unitPrice: 100 }], type: 'credit' as const, payments: [{ method: 'cash' as const, amount: 50 }] };

it('requires explicit rejected-sale payout evidence and retains it atomically across restart', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'moto-settlement-')), 'terminal.sqlite');
  let db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
  try {
    const ops = setup(db); const session = await ops.openSession({ registerId: 'reg-1', openingBalance: 20 });
    const sale = await recordedCreditSale(db, { ...input, registerSessionId: session.id });
    db.db.prepare("DELETE FROM outbox WHERE type = 'register_open'").run();
    const op = db.pendingOps()[0]; db.markSaleFailed(sale.id); db.markOp(op.opId, 'rejected', { error: 'STOCK_CONFLICT' });
    expect(ops.projectSession(session).expectedCash).toBe(70);
    expect(() => settleRejectedSale(db, op.opId, 'user', 'br-1', { method: 'bank_transfer', reference: 'fixture-refund' })).toThrow('RECONCILIATION_REQUIRED');
    expect(() => settleRejectedSale(db, op.opId, 'user', 'br-1')).toThrow('REFUND_METHOD_REQUIRED');
    expect(db.sale(sale.id)!.status).toBe('completed'); expect(db.pendingOps()).toHaveLength(0); expect(db.outbox()).toHaveLength(1);
    expect(() => settleRejectedSale(db, op.opId, 'user', 'br-2', { method: 'cash', reference: 'fixture-refund' })).toThrow('RECONCILIATION_REQUIRED');
    settleRejectedSale(db, op.opId, 'user', 'br-1', { method: 'cash', reference: 'fixture-refund' });
    expect(ops.projectSession(session).expectedCash).toBe(20); expect(ops.projectSession(session).expectedCash).toBe(20);
    expect(db.product('p1', 'br-1')!.available).toBe(10);
    expect(db.sale(sale.id)).toMatchObject({ status: 'cancelled', remaining: 0, paid: 50, total: 100 }); expect(db.customers()[0].balance).toBe(0); expect(db.outbox()).toHaveLength(0);
    expect(() => settleRejectedSale(db, op.opId, 'user', 'br-1', { method: 'cash', reference: 'fixture-refund' })).toThrow('OP_NOT_REJECTED');
    db.close(); db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
    const row = db.db.prepare('SELECT doc FROM rejected_settlements').get() as { doc: string };
    expect(JSON.parse(row.doc)).toMatchObject({ paid: 50, payoutAmount: 50, debtReduction: 50, method: 'cash', reference: 'fixture-refund', serverRejection: 'STOCK_CONFLICT' });
    expect(db.sale(sale.id)!.status).toBe('cancelled'); expect(db.customers()[0].balance).toBe(0);
    expect(() => db.wipe()).toThrow('SETTLEMENT_ARCHIVE_REQUIRED'); expect(db.db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); }
});
it('persists the mixed offline refund, exact debt reduction and source tender after restart', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'moto-mixed-return-')), 'terminal.sqlite');
  let db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
  try {
    const ops = setup(db);
    const session = await ops.openSession({ registerId: 'reg-1', openingBalance: 100 });
    const sale = await recordedCreditSale(db, { ...input, registerSessionId: session.id });
    const ret = await ops.createSaleReturn({ saleId: sale.id, settlement: 'debt_first', refundMethod: 'cash', items: [{ saleItemId: sale.items[0].id, productId: 'p1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] });
    expect(ret).toMatchObject({ refundAmount: 100, debtReduction: 50, payoutAmount: 50 });
    expect(db.sale(sale.id)).toMatchObject({ paid: 50, remaining: 0, total: 100 });
    db.close(); db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
    expect(db.returnsForSale(sale.id)[0].value).toMatchObject({ debtReduction: 50, payoutAmount: 50 });
    expect(db.customers()[0].balance).toBe(0); expect(db.sale(sale.id)!.payments).toEqual(sale.payments);
    expect(db.pendingOps().find(op => op.type === 'sale_return')!.payload).toMatchObject({ settlement: 'debt_first' });
  } finally { db.close(); }
});
