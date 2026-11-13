import { describe, expect, it } from 'vitest';
import type { ApiClient } from '@moto/api-client';
import type { SaleCreateInput } from '@moto/shared';
import { createLocalOps } from './localOps';
import { emptyPull, fakeApi, makeWorker, memDb, product } from '../test/helpers';

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

function setup(apiRef: { current: ApiClient | null }) {
  const db = memDb();
  db.applyPull(emptyPull({ products: [product()], stockLevels: [{ productId: 'p1', warehouseId: 'w1', branchId: 'br-1', quantity: 10, reserved: 0 }] }), 'br-1', true);
  const { worker, timers } = makeWorker(db, () => apiRef.current);
  const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 'term-1', branchId: () => 'br-1', userId: () => 'u1', publicUrl: () => 'http://erp.local' });
  return { db, worker, timers, ops };
}

describe('offline sale → outbox → push → applied', () => {
  it('stores the sale locally with an offline invoice number, decrements stock, and enqueues one op', async () => {
    const apiRef = { current: null as ApiClient | null };
    const { db, ops } = setup(apiRef);

    const sale = await ops.createSale(saleInput());

    expect(sale.invoiceNumber).toBe('INV-T001-00001');
    expect(sale.total).toBe(200);
    expect(sale.syncStatus).toBe('pending');
    expect(sale.qrPayload).toBeTruthy();
    expect(db.product('p1', 'br-1')?.available).toBe(8);
    expect(db.counts()).toEqual({ pending: 1, rejected: 0 });
    const op = db.pendingOps()[0]!;
    expect(op.type).toBe('sale');
    expect((op.payload as { invoiceNumber: string; localId: string }).invoiceNumber).toBe('INV-T001-00001');
    expect((op.payload as { localId: string }).localId).toBe(sale.id);
  });

  it('invoice sequence is monotonic per terminal across sales', async () => {
    const { ops } = setup({ current: null });
    const a = await ops.createSale(saleInput());
    const b = await ops.createSale(saleInput());
    const c = await ops.createSale(saleInput());
    expect([a, b, c].map((s) => s.invoiceNumber)).toEqual(['INV-T001-00001', 'INV-T001-00002', 'INV-T001-00003']);
  });

  it('pushes pending ops in order once online, marks the sale synced with the server id and drains the outbox', async () => {
    const { api, pushes } = fakeApi();
    const apiRef = { current: null as ApiClient | null };
    const { db, worker, ops } = setup(apiRef);

    const s1 = await ops.createSale(saleInput());
    const s2 = await ops.createSale(saleInput());
    expect(db.counts().pending).toBe(2);

    apiRef.current = api; // network comes back
    const status = await worker.syncNow();

    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.terminalId).toBe('term-1');
    expect(pushes[0]!.ops.map((o) => (o.payload as { localId: string }).localId)).toEqual([s1.id, s2.id]);
    expect(status.pending).toBe(0);
    expect(status.online).toBe(true);
    expect(status.lastSyncAt).toBeTruthy();
    expect(db.sale(s1.id)?.syncStatus).toBe('synced');
    // Local record resolvable by server id too (for receipt reprint after sync).
    const firstOp = pushes[0]!.ops[0]!.opId;
    expect(db.sale(`srv-${firstOp.slice(0, 6)}`)?.id).toBe(s1.id);
    expect(db.outbox()).toHaveLength(0);
  });

  it('duplicate results (server already has the op) are treated as applied', async () => {
    const { api } = fakeApi({ onPush: (req) => req.ops.map((o) => ({ opId: o.opId, status: 'duplicate' as const, serverId: 'srv-dup' })) });
    const apiRef = { current: api };
    const { db, worker, ops } = setup(apiRef);
    const s = await ops.createSale(saleInput());
    await worker.syncNow();
    expect(db.counts()).toEqual({ pending: 0, rejected: 0 });
    expect(db.sale(s.id)?.syncStatus).toBe('synced');
  });

  it('rejected ops stop retrying, mark the sale failed, and emit "rejected"', async () => {
    const { api, pushes } = fakeApi({ onPush: (req) => req.ops.map((o) => ({ opId: o.opId, status: 'rejected' as const, error: { code: 'INSUFFICIENT_STOCK', message: 'no stock' } })) });
    const apiRef = { current: null as ApiClient | null };
    const { db, worker, ops } = setup(apiRef);
    const rejected: unknown[] = [];
    worker.on('rejected', (r) => rejected.push(r));

    const s = await ops.createSale(saleInput());
    apiRef.current = api;
    await worker.syncNow();
    await worker.syncNow();

    expect(pushes).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(db.counts()).toEqual({ pending: 0, rejected: 1 });
    expect(db.sale(s.id)?.syncStatus).toBe('failed');
    expect(db.outbox()[0]!.error).toContain('INSUFFICIENT_STOCK');

    // Operator retry re-queues under a fresh opId (server remembers rejections by opId) and un-fails the sale.
    const oldId = db.outbox()[0]!.opId;
    db.retryOp(oldId, 'new-op-id');
    expect(db.counts()).toEqual({ pending: 1, rejected: 0 });
    expect(db.pendingOps()[0]!.opId).toBe('new-op-id');
    expect(db.opPayload(oldId)).toBeNull();
    expect(db.sale(s.id)?.syncStatus).toBe('pending');
  });

  it('pushOne treats TRANSIENT like pushAll (back to pending, not rejected) and skips while a sync is running', async () => {
    let calls = 0;
    const { api, pushes } = fakeApi({
      onPush: (req) => {
        calls++;
        return req.ops.map((o) => (calls === 1 ? { opId: o.opId, status: 'rejected' as const, error: { code: 'TRANSIENT', message: 'db busy' } } : { opId: o.opId, status: 'applied' as const, serverId: 'srv-ok' }));
      },
    });
    const apiRef = { current: api };
    const { db, worker, ops } = setup(apiRef);
    await worker.heartbeat(); // online
    const s = await ops.createSale(saleInput()); // afterEnqueue → pushOne → TRANSIENT
    expect(pushes).toHaveLength(1);
    expect(db.counts()).toEqual({ pending: 1, rejected: 0 });
    expect(db.sale(s.id)?.syncStatus).toBe('pending');

    const st = await worker.syncNow();
    expect(st.pending).toBe(0);
    expect(db.sale(s.id)?.syncStatus).toBe('synced');
  });

  it('voided offline sale is cancelled locally and excluded from the register close totals', async () => {
    const { ops, db } = setup({ current: null });
    const sess = await ops.openSession({ registerId: 'reg-1', openingBalance: 100 });
    const s = await ops.createSale(saleInput({ registerSessionId: sess.id }));
    db.cancelLocalSale(s.id);
    expect(db.sale(s.id)?.status).toBe('cancelled');
    const closed = await ops.closeSession({ sessionId: sess.id, actualCash: 100 });
    expect(closed.cashSales).toBe(0);
    expect(closed.expectedCash).toBe(100);
  });

  it('transient rejections are reset to pending and retried with exponential backoff', async () => {
    let calls = 0;
    const { api, pushes } = fakeApi({
      onPush: (req) => {
        calls++;
        return req.ops.map((o) => (calls < 3 ? { opId: o.opId, status: 'rejected' as const, error: { code: 'TRANSIENT', message: 'db busy' } } : { opId: o.opId, status: 'applied' as const, serverId: 'srv-ok' }));
      },
    });
    const apiRef = { current: api };
    const { db, worker, timers, ops } = setup(apiRef);
    await ops.createSale(saleInput());

    const s1 = await worker.syncNow();
    expect(s1.pending).toBe(1);
    expect(s1.error).toContain('transiently');
    expect(timers.at(-1)!.ms).toBe(2_000);

    const s2 = await worker.syncNow();
    expect(s2.pending).toBe(1);
    expect(timers.at(-1)!.ms).toBe(4_000);

    const s3 = await worker.syncNow();
    expect(s3.pending).toBe(0);
    expect(s3.error).toBeNull();
    expect(timers.at(-1)!.ms).toBe(30_000);
    expect(pushes).toHaveLength(3);
    expect(db.outbox()[0]?.attempts ?? 0).toBe(0); // drained
  });

  it('network failure during push flips to offline, keeps ops pending, and backs off', async () => {
    const { api } = fakeApi();
    const apiRef = { current: api };
    const { db, worker, timers, ops } = setup(apiRef);
    await ops.createSale(saleInput());
    const { ApiError } = await import('@moto/api-client');
    (api.sync.push as unknown as { mockImplementationOnce: (f: () => Promise<never>) => void }).mockImplementationOnce(async () => {
      throw new ApiError('fetch failed', 0, 'NETWORK');
    });

    const st = await worker.syncNow();
    expect(st.online).toBe(false);
    expect(st.pending).toBe(1);
    expect(timers.at(-1)!.ms).toBe(2_000);
    expect(db.pendingOps()[0]!.attempts).toBe(1);
  });

  it('heartbeat toggles online state and triggers a sync when connectivity returns', async () => {
    let healthy = false;
    const { api } = fakeApi({ healthy: () => healthy });
    const { worker, timers } = makeWorker(memDb(), () => api);
    const statuses: boolean[] = [];
    worker.on('status', (s: { online: boolean }) => statuses.push(s.online));

    await worker.heartbeat();
    expect(worker.isOnline()).toBe(false);
    healthy = true;
    await worker.heartbeat();
    expect(worker.isOnline()).toBe(true);
    expect(statuses).toEqual([true]);
    expect(timers.some((t) => t.ms === 100)).toBe(true); // immediate sync scheduled
  });

  it('explicit reconnect verifies the server before syncing', async () => {
    let healthy = false;
    const { api } = fakeApi({ healthy: () => healthy });
    const apiRef = { current: api };
    const { worker } = setup(apiRef);

    expect((await worker.reconnect()).online).toBe(false);
    expect((await worker.reconnect()).error).toBe('down');

    healthy = true;
    const status = await worker.reconnect();
    expect(status.online).toBe(true);
    expect(status.error).toBeNull();
  });

  it('a terminal deleted server-side pauses pushes, keeps the ops pending, and resumes after re-registering', async () => {
    const { ApiError } = await import('@moto/api-client');
    let gone = true;
    const { api, pushes, mock } = fakeApi({
      onPush: (req) => {
        if (gone) throw new ApiError('Terminal not registered', 404, 'TERMINAL_NOT_FOUND');
        return req.ops.map((o) => ({ opId: o.opId, status: 'applied' as const, serverId: 'srv-ok' }));
      },
    });
    const apiRef = { current: api };
    const { db, worker, ops } = setup(apiRef);
    const s = await ops.createSale(saleInput());

    const st = await worker.syncNow();
    expect(st.unregistered).toBe(true);
    expect(st.online).toBe(true); // the server is reachable; only this device is unknown
    expect(st.error).toContain('لم يعد مسجّلاً');
    expect(st.pending).toBe(1);
    expect(db.outbox()[0]!.status).toBe('pending'); // not stuck on `sent`
    expect(db.sale(s.id)?.syncStatus).toBe('pending'); // never marked failed

    // Further cycles stop re-pushing but still pull the catalog.
    await worker.syncNow();
    expect(pushes).toHaveLength(1);
    expect(mock.sync.pull).toHaveBeenCalled();

    gone = false;
    worker.markRegistered();
    const after = await worker.syncNow();
    expect(after.unregistered).toBe(false);
    expect(after.error).toBeNull();
    expect(after.pending).toBe(0);
    expect(db.sale(s.id)?.syncStatus).toBe('synced');
  });
});

describe('pull / bootstrap', () => {
  it('full bootstrap replaces the catalog; delta pull upserts and applies deletions', async () => {
    const db = memDb();
    const { api, mock } = fakeApi();
    const { worker } = makeWorker(db, () => api);
    await worker.bootstrap(api, 'br-1');
    expect(mock.sync.bootstrap).toHaveBeenCalledTimes(1);

    mock.sync.pull.mockResolvedValueOnce(emptyPull({ products: [product({ id: 'p9', sku: 'SKU-9', internalBarcode: '2000000000093' })] }));
    await worker.syncNow();
    expect(db.product('p9', 'br-1')?.sku).toBe('SKU-9');

    mock.sync.pull.mockResolvedValueOnce(emptyPull({ deleted: { products: ['p9'], customers: [], quickProducts: [], quickCategories: [] } }));
    await worker.syncNow();
    expect(db.product('p9', 'br-1')).toBeNull();
    expect(mock.sync.pull).toHaveBeenCalledTimes(2);
  });

  it('lookup resolves internal barcode, sku and legacy barcode (flagged)', () => {
    const db = memDb();
    db.applyPull(emptyPull({ products: [product({ legacyBarcode: '6221001234567' })] }), 'br-1', true);
    expect(db.lookup('2000000000017', 'br-1').products[0]?.id).toBe('p1');
    expect(db.lookup('sku-1', 'br-1').products[0]?.id).toBe('p1');
    const legacy = db.lookup('6221001234567', 'br-1');
    expect(legacy.products[0]?.id).toBe('p1');
    expect(legacy.legacyHit).toBe(true);
  });
});
