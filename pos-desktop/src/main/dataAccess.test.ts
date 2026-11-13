import { expect, it, vi } from 'vitest';
import type { Customer, Session } from '@moto/shared';
import { invokeData } from './dataAccess';
import { emptyPull, memDb } from './test/helpers';
import { makeWorker } from './test/helpers';
import { createLocalOps } from './sync/localOps';
const session = { permissions: ['sales.create'], user: { branchId: 'br-1' } } as Session;
const customer = (type: Customer['type']): Customer => ({ id: `foreign-${type}`, code: 'SYNTHETIC', name: { ar: 'contact' }, phone: '000', whatsapp: '', address: { ar: 'private' }, type, creditLimit: 98765, balance: 12345, branchId: 'br-2', isActive: true, createdAt: '', notes: 'private note' });
it('blocks direct IPC data calls without a session before reading data', async () => {
  const read = vi.fn(() => [customer('retail')]);
  await expect(invokeData({ customers: read }, null, 'br-1', 'customers', null)).rejects.toThrow('AUTH_REQUIRED');
  expect(read).not.toHaveBeenCalled();
});
it('projects shared contacts and removes foreign retail customers at IPC dispatch', async () => {
  const r = await invokeData({ customers: () => [customer('retail'), customer('wholesale')] }, session, 'br-1', 'customers', null) as Customer[];
  expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ balance: 0, creditLimit: 0, financialRestricted: true });
  expect(r[0].notes).toBeUndefined(); expect(r[0].address.ar).toBe('');
});
it('rejects foreign sales and unknown inherited IPC methods', async () => {
  await expect(invokeData({ sale: () => ({ branchId: 'br-2' }) }, session, 'br-1', 'sale', 'id')).rejects.toThrow('BRANCH_DENIED');
  await expect(invokeData({}, session, 'br-1', 'toString', null)).rejects.toThrow('UNKNOWN_DATA_METHOD');
});
it('scrubs foreign financial cache and prices even when a delta omits the stale customer', () => {
  const db = memDb();
  try {
    db.upsertCustomer(customer('retail')); db.upsertCustomer(customer('wholesale'));
    db.applyPull(emptyPull(), 'br-1', false);
    expect(db.customers()).toHaveLength(1);
    expect(db.customers()[0]).toMatchObject({ financialRestricted: true, balance: 0 });
  } finally { db.close(); }
});
it('rejects foreign customer financial writes through the dispatched IPC handler', async () => {
  const db = memDb();
  try {
    db.upsertCustomer(customer('wholesale'));
    const ops = createLocalOps({ db, worker: makeWorker(db, () => null).worker, branchId: () => 'br-1', userId: () => 'synthetic', terminalId: () => null, terminalCode: () => 'audit', publicUrl: () => 'http://127.0.0.1' });
    await expect(invokeData({ recordCustomerPayment: ops.recordCustomerPayment }, session, 'br-1', 'recordCustomerPayment', { customerId: 'foreign-wholesale', amount: 1, method: 'cash' })).rejects.toThrow('BRANCH_DENIED');
    expect(db.counts()).toEqual({ pending: 0, rejected: 0 });
  } finally { db.close(); }
});
