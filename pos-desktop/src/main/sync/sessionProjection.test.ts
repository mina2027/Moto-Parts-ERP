import { afterEach, expect, it } from 'vitest';
import type { Sale } from '@moto/shared';
import { memDb, makeWorker } from '../test/helpers';
import { createLocalOps } from './localOps';
import type { LocalDb } from '../db/database';

const databases: LocalDb[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
async function boot() {
  const db = memDb(); databases.push(db);
  const { worker } = makeWorker(db, () => null);
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', publicUrl: () => 'http://erp.local' });
  const session = await ops.openSession({ registerId: 'reg-1', openingBalance: 50 });
  return { db, ops, session };
}
function sale(id: string, sessionId: string, over: Partial<Sale> = {}): Sale {
  return { id, invoiceNumber: `AUDIT-${id}`, date: '2026-10-12T08:00:00.000Z', branchId: 'br-1', cashierId: 'u1', customerId: null, registerSessionId: sessionId, items: [], subtotal: 10, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 10, paid: 10, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 10 }], type: 'cash', status: 'completed', syncStatus: 'pending', ...over };
}

it('includes every shift sale even when more than 5000 cached sales exist', async () => {
  const { db, ops, session } = await boot();
  db.db.transaction(() => { for (let i = 0; i < 5001; i++) db.insertSale(sale(`s${i}`, session.id), 'pending'); })();
  expect(ops.projectSession(session)).toMatchObject({ cashSales: 50010, expectedCash: 50060 });
});

it('projects cash change and each electronic payment bucket independently', async () => {
  const { db, ops, session } = await boot();
  db.insertSale(sale('split', session.id, { total: 100, paid: 100, change: 30, payments: [{ method: 'cash', amount: 50 }, { method: 'card', amount: 60 }, { method: 'bank_transfer', amount: 20 }] }), 'pending');
  expect(ops.projectSession(session)).toMatchObject({ cashSales: 20, cardSales: 60, transferSales: 20, expectedCash: 70 });
});

it('excludes foreign, cancelled and held sales while retaining failed collected and returned tender', async () => {
  const { db, ops, session } = await boot();
  db.insertSale(sale('foreign', 'other-session'), 'pending');
  db.insertSale(sale('cancelled', session.id, { status: 'cancelled' }), 'pending');
  db.insertSale(sale('held', session.id, { status: 'held' }), 'pending');
  db.insertSale(sale('failed', session.id, { syncStatus: 'failed' }), 'pending');
  db.insertSale(sale('returned', session.id, { status: 'returned' }), 'pending');
  expect(ops.projectSession({ ...session, refunds: 10 })).toMatchObject({ cashSales: 20, expectedCash: 60 });
});

it('refuses wiping a terminal that has an unsynced operation', async () => {
  const { db, session } = await boot();
  expect(() => db.wipe()).toThrow('UNSYNCED_OPERATIONS');
  expect(db.counts().pending).toBe(1);
  expect(db.openSession()?.id).toBe(session.id);
});

it('refuses wiping rejected operations that still need reconciliation', async () => {
  const { db } = await boot();
  db.db.prepare("UPDATE outbox SET status = 'rejected'").run();
  expect(() => db.wipe()).toThrow('UNSYNCED_OPERATIONS');
  expect(db.counts().rejected).toBe(1);
});

it('allows wiping a terminal after all queued operations have been reconciled', async () => {
  const { db } = await boot();
  db.db.prepare('DELETE FROM outbox').run();
  expect(() => db.wipe()).not.toThrow();
  expect(db.openSession()).toBeNull();
});
