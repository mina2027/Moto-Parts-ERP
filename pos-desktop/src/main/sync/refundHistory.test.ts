import { expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalDb } from '../db/database';
import { createLocalOps } from './localOps';
import { emptyPull, makeWorker, NODE_SQLITE, product } from '../test/helpers';
it('caps refunds across invoice lines and retains applied refund history after a restart', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'moto-refund-audit-')), 'terminal.sqlite');
  let db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
  const ops = () => createLocalOps({ db, worker: makeWorker(db, () => null).worker, terminalCode: () => 'A', terminalId: () => 'term-A', branchId: () => 'br-1', userId: () => 'user', publicUrl: () => 'http://127.0.0.1' });
  try {
    db.applyPull(emptyPull({ products: [product({ prices: { retail1: 0.05, retail2: 0.05, wholesale: 0.05 } })], stockLevels: [{ productId: 'p1', branchId: 'br-1', warehouseId: 'wh-1', quantity: 10, reserved: 0 }] }), 'br-1', true);
    db.upsertSession({ id: 'sess-refund', registerId: 'reg-1', branchId: 'br-1', userId: 'user', openedAt: new Date().toISOString(), closedAt: null, openingBalance: 100, cashSales: 0, cardSales: 0, transferSales: 0, paymentsIn: 0, paymentsOut: 0, expenses: 0, refunds: 0, expectedCash: 100, actualCash: null, difference: null, status: 'open', movements: [] });
    const sale = await ops().createSale({ branchId: 'br-1', items: Array.from({ length: 3 }, () => ({ productId: 'p1', name: { ar: 'synthetic' }, quantity: 1, unitPrice: 0.05 })), type: 'cash', payments: [{ method: 'cash', amount: 0.15 }], invoiceDiscount: 0 });
    sale.invoiceDiscount = 0.01; sale.total = 0.14; sale.paid = 0.14;
    db.updateSale(sale);
    const refunds = [];
    for (const line of sale.items) {
      const ret = await ops().createSaleReturn({ saleId: sale.id, refundMethod: 'cash', items: [{ saleItemId: line.id, productId: 'p1', quantity: 1, unitPrice: 0.05, refund: 0, reason: 'defective' }] });
      refunds.push(ret.refundAmount);
      const pending = db.pendingOps().find(op => op.type === 'sale_return')!;
      db.markOp(pending.opId, 'applied', { serverId: `server-${ret.id}` });
    }
    expect(Math.round(refunds.reduce((sum, r) => sum + r, 0) * 100)).toBe(14);
    db.close(); db = new LocalDb(file, { nativeBinding: NODE_SQLITE });
    const rows = db.db.prepare('SELECT doc, status, server_id FROM sale_returns ORDER BY rowid').all() as { doc: string; status: string; server_id: string }[];
    expect(rows).toHaveLength(3); expect(rows.every(r => r.status === 'applied' && r.server_id)).toBe(true);
    expect(rows.reduce((sum, r) => sum + JSON.parse(r.doc).refundAmount, 0)).toBeCloseTo(0.14, 2);
  } finally { db.close(); }
});
