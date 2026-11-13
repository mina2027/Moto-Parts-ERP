/// <reference lib="dom" />
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { api, loginAs, startTestDb, stopTestDb } from '../src/test/harness.js';
import { ProductModel, SaleModel, SaleReturnModel, StockLevelModel } from '../src/db/models.js';
import { signTaxSnapshot } from '../src/modules/settings/taxSnapshot.js';
import { LocalDb } from '../../pos-desktop/src/main/db/database';
import { SyncWorker } from '../../pos-desktop/src/main/sync/worker';
import { createLocalOps } from '../../pos-desktop/src/main/sync/localOps';
import { createApiClient } from '../../pos-desktop/packages/api-client/src/client';
import type { SaleCreateInput, SyncPushRequest } from '@moto/shared';
import { SaleCreateSchema, DEFAULT_SETTINGS } from '@moto/shared';
import { getSettings, replaceSettings, updateSettingsSection } from '../src/modules/settings/service.js';
let server: Server; let url: string; let token: string;
const folder = mkdtempSync(path.join(tmpdir(), 'moto-two-terminals-'));
const binding = path.resolve(import.meta.dirname, '../../pos-desktop/native/better_sqlite3.node');
beforeAll(async () => {
  const app = await startTestDb({ seed: true }); token = (await loginAs(app, 'admin')).token;
  await ProductModel.updateOne({ _id: 'prod-1' }, { $set: { 'prices.retail1': 100 } });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  await StockLevelModel.updateMany({ productId: 'prod-1', branchId: 'br-1' }, { $set: { quantity: 0, reserved: 0 } });
  await StockLevelModel.updateOne({ productId: 'prod-1', warehouseId: 'wh-2' }, { $set: { quantity: 1 } });
  expect((await api(app).get('/api/sync/bootstrap').set('Authorization', `Bearer ${token}`).query({ branchId: 'br-1' })).body.salesWarehouseId).toBe('wh-2');
});

it('creates tax-free offline sales and reconciles a stored historical taxed invoice without changing printed amounts', async () => {
  const adminApi = createApiClient({ baseUrl: url, getToken: () => token });
  const terminal = await adminApi.sync.registerTerminal({ name: 'tax-snapshot-terminal', branchId: 'br-1', registerId: 'reg-2', appVersion: 'logic-fixes' });
  const client = createApiClient({ baseUrl: url, getToken: () => token, headers: { 'X-Terminal-Id': terminal.id } });
  const db = new LocalDb(path.join(folder, 'tax.sqlite'), { nativeBinding: binding });
  const worker = new SyncWorker({ db, api: () => client, terminalId: () => terminal.id, branchId: () => 'br-1', setTimer: () => null, clearTimer: () => undefined });
  try {
    await StockLevelModel.updateOne({ productId: 'prod-1', warehouseId: 'wh-2' }, { $set: { quantity: 10 } });
    await updateSettingsSection('invoice', { ...(await getSettings()).invoice, taxEnabled: true, showTax: false, taxRate: 14 });
    await worker.bootstrap(client, 'br-1');
    expect(db.settings()?.invoice).toMatchObject({ taxEnabled: false, taxRate: 0 });
    const ops = createLocalOps({ db, worker, terminalCode: () => terminal.code, terminalId: () => terminal.id, branchId: () => 'br-1', userId: () => 'usr-1', publicUrl: () => url });
    const input = SaleCreateSchema.parse({ branchId: 'br-1', registerSessionId: db.openSession()?.id, items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100, name: { ar: 'tax' } }], type: 'cash', payments: [{ method: 'cash', amount: 100 }] });
    const local = await ops.createSale(input); expect(local).toMatchObject({ total: 100, tax: 0 });
    await updateSettingsSection('invoice', { ...(await getSettings()).invoice, taxRate: 20 });
    await worker.syncNow(); expect(db.counts()).toEqual({ pending: 0, rejected: 0 });
    const posted = await SaleModel.findOne({ invoiceNumber: local.invoiceNumber }).lean();
    expect(posted).toMatchObject({ total: local.total, tax: local.tax });
    // A previous version already printed this invoice. Reproduce its durable SQLite sale and outbox,
    // rather than asking today's zero-tax checkout to create a historical taxed invoice.
    const historicalInvoice = { ...(await getSettings()).invoice, taxEnabled: true, taxRate: 14, showTax: false };
    const legacyInput = { ...input, taxSnapshot: signTaxSnapshot(historicalInvoice), invoiceNumber: `LEGACY-VALID-${randomUUID()}`, localId: `legacy-local-${randomUUID()}`, payments: [{ method: 'cash' as const, amount: 114 }] };
    const historicalSale = { ...local, id: legacyInput.localId, invoiceNumber: legacyInput.invoiceNumber, tax: 14, total: 114, paid: 114, change: 0, payments: legacyInput.payments };
    db.db.transaction(() => {
      db.insertSale(historicalSale, 'pending');
      db.adjustLocalStock('prod-1', 'br-1', -1);
      db.enqueue({ opId: randomUUID(), type: 'sale', createdAt: new Date().toISOString(), summary: legacyInput.invoiceNumber, payload: legacyInput });
    })();
    await worker.syncNow(); expect(db.counts()).toEqual({ pending: 0, rejected: 0 });
    expect(await SaleModel.findOne({ invoiceNumber: legacyInput.invoiceNumber }).lean()).toMatchObject({ total: 114, tax: 14 });
    const legacy = await client.sync.push({ terminalId: terminal.id, ops: [{ opId: randomUUID(), type: 'sale', clientCreatedAt: new Date().toISOString(), payload: { ...input, invoiceNumber: `LEGACY-${randomUUID()}` }, saleAmounts: { tax: 14, total: 114 } }] });
    expect(legacy.results[0]).toMatchObject({ status: 'rejected', error: { code: 'RECONCILIATION_REQUIRED' } });
  } finally { worker.stop(); db.close(); await replaceSettings(DEFAULT_SETTINGS); await StockLevelModel.updateOne({ productId: 'prod-1', warehouseId: 'wh-2' }, { $set: { quantity: 1 } }); }
});
afterAll(async () => { await new Promise<void>(resolve => server?.close(() => resolve())); await stopTestDb(); });
it('reconciles two offline terminals, a lost response, rejection, retry, return and file restart against the real API', async () => {
  const adminApi = createApiClient({ baseUrl: url, getToken: () => token });
  const terminals = await Promise.all(['A', 'B'].map(name => adminApi.sync.registerTerminal({ name: `audit-${name}`, branchId: 'br-1', registerId: name === 'A' ? 'reg-2' : null, appVersion: 'audit-pass2' })));
  const refundDrawer = await adminApi.cash.openSession('reg-2', 1000);
  let online = false; let loseResponse = false;
  const seen: { request: SyncPushRequest; statuses: string[] }[] = [];
  const devices = terminals.map((terminal, i) => {
    const file = path.join(folder, `${i}.sqlite`); let db = new LocalDb(file, { nativeBinding: binding });
    const client = createApiClient({ baseUrl: url, getToken: () => token, headers: { 'X-Terminal-Id': terminal.id }, fetchImpl: async (input, init) => {
      if (!online) throw new Error('synthetic disconnected network');
      const response = await fetch(input, init);
      if (String(input).endsWith('/sync/push')) {
        const result = await response.clone().json() as { results: { status: string }[] }; seen.push({ request: JSON.parse(String(init?.body)), statuses: result.results.map(r => r.status) });
        if (loseResponse) { loseResponse = false; throw new Error('synthetic lost response after server commit'); }
      }
      return response;
    } });
    const workerFor = () => new SyncWorker({ db, api: () => client, terminalId: () => terminal.id, branchId: () => 'br-1', setTimer: () => null, clearTimer: () => undefined });
    let worker = workerFor();
    const ops = () => createLocalOps({ db, worker, terminalCode: () => terminal.code, terminalId: () => terminal.id, branchId: () => 'br-1', userId: () => 'u-admin', publicUrl: () => url });
    return { get db() { return db; }, get worker() { return worker; }, client, ops, restart() { worker.stop(); db.close(); db = new LocalDb(file, { nativeBinding: binding }); worker = workerFor(); }, close() { worker.stop(); db.close(); } };
  });
  const [a, b] = devices;
  try {
    online = true; await a.worker.bootstrap(a.client, 'br-1'); await b.worker.bootstrap(b.client, 'br-1'); online = false;
    const body: SaleCreateInput = SaleCreateSchema.parse({ branchId: 'br-1', items: [{ productId: 'prod-1', quantity: 1, unitPrice: 100, name: { ar: 'synthetic' } }], type: 'cash', payments: [{ method: 'cash', amount: 100 }] });
    const saleA = await a.ops().createSale({ ...body, registerSessionId: refundDrawer.id }); const saleB = await b.ops().createSale(body);
    expect(a.db.product('prod-1', 'br-1')!.available).toBe(0); expect(b.db.product('prod-1', 'br-1')!.available).toBe(0);
    a.restart(); b.restart(); expect(a.db.counts().pending).toBe(1); expect(b.db.counts().pending).toBe(1);
    online = true; loseResponse = true; await a.worker.syncNow(); expect(a.db.counts().pending).toBe(1);
    a.restart(); await a.worker.syncNow(); expect(a.db.counts().pending).toBe(0);
    expect(seen.some(r => r.statuses.includes('duplicate'))).toBe(true);
    expect(await SaleModel.countDocuments({ invoiceNumber: saleA.invoiceNumber })).toBe(1);
    await b.worker.syncNow(); expect(b.db.counts().rejected).toBe(1); expect(b.db.sale(saleB.id)!.syncStatus).toBe('failed');
    expect(await SaleModel.countDocuments({ invoiceNumber: saleB.invoiceNumber })).toBe(0);
    await expect(b.ops().createSaleReturn({ saleId: saleB.id, refundMethod: 'cash', items: [{ saleItemId: saleB.items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] })).rejects.toThrow('RECONCILIATION_REQUIRED');
    // Disconnect to enqueue a return, then restart before pushing it.
    online = false;
    await a.ops().createSaleReturn({ saleId: saleA.id, refundMethod: 'cash', items: [{ saleItemId: saleA.items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] });
    a.restart(); online = true; loseResponse = true; await a.worker.syncNow();
    expect(a.db.counts().pending).toBe(1); a.restart(); await a.worker.syncNow();
    const authoritative = (await SaleModel.findOne({ invoiceNumber: saleA.invoiceNumber }).lean())!;
    expect(await SaleReturnModel.countDocuments({ saleId: authoritative._id })).toBe(1);
    expect(authoritative.status).toBe('returned'); expect(authoritative.items[0].returnedQty).toBe(1); expect(a.db.returnsForSale(saleA.id)).toHaveLength(1);
    expect(a.db.returnsForSale(saleA.id)[0].status).toBe('applied');
    const rejected = b.db.outbox().find(op => op.status === 'rejected')!; b.db.retryOp(rejected.opId, randomUUID());
    b.restart(); await b.worker.syncNow(); expect(b.db.counts()).toEqual({ pending: 0, rejected: 0 });
    expect(await SaleModel.countDocuments({ invoiceNumber: saleB.invoiceNumber })).toBe(1);
    expect((await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean())!.quantity).toBe(0);
    await a.worker.syncNow(); expect(a.db.product('prod-1', 'br-1')!.available).toBe(0); expect(b.db.product('prod-1', 'br-1')!.available).toBe(0);
    a.restart(); b.restart(); expect(a.db.counts().pending + b.db.counts().pending).toBe(0); expect(a.db.returnsForSale(saleA.id)).toHaveLength(1);
    const rejectedReturnOp = randomUUID();
    a.db.enqueue({ opId: rejectedReturnOp, type: 'sale_return', createdAt: new Date().toISOString(), summary: 'synthetic excess return', payload: { saleId: authoritative._id, refundMethod: 'cash', items: [{ saleItemId: authoritative.items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 100, refund: 0, reason: 'defective' }] } });
    await a.worker.syncNow(); expect(a.db.outbox().find(op => op.opId === rejectedReturnOp)).toMatchObject({ status: 'rejected' });
    a.restart(); expect(a.db.counts().rejected).toBe(1); expect(() => a.db.assertCanWipe()).toThrow('UNSYNCED_OPERATIONS');
    expect(await SaleReturnModel.countDocuments({ saleId: authoritative._id })).toBe(1);
    expect((await StockLevelModel.findOne({ productId: 'prod-1', warehouseId: 'wh-2' }).lean())!.quantity).toBe(0);
  } finally { devices.forEach(d => d.close()); }
});
