import path from 'node:path';
import { vi } from 'vitest';
import type { ApiClient } from '@moto/api-client';
import type { Product, Sale, SaleCreateInput, SyncOpResult, SyncPullResponse, SyncPushRequest } from '@moto/shared';
import { DEFAULT_SETTINGS, round2, uuid } from '@moto/shared';
import { LocalDb } from '../db/database';
import { SyncWorker } from '../sync/worker';

/** Node-ABI binary fetched by scripts/rebuild-native.mjs (the hoisted one is built for Electron). */
export const NODE_SQLITE = path.resolve(__dirname, '../../../native/better_sqlite3.node');

export function memDb() {
  return new LocalDb(':memory:', { nativeBinding: NODE_SQLITE });
}

/** Seed an invoice recorded before credit sales were removed, including its pending sync record. */
export function recordedCreditSale(db: LocalDb, input: Pick<SaleCreateInput, 'branchId' | 'items' | 'payments'> & Partial<SaleCreateInput>): Sale {
  const id = uuid();
  const date = new Date().toISOString();
  const customer = db.customers().find(c => c.id === input.customerId)!;
  const items = input.items.map(i => ({ ...i, id: uuid(), name: i.name ?? { ar: 'legacy' }, barcode: i.barcode ?? '', sku: i.sku ?? '', unitCost: i.unitCost ?? 0, listPrice: i.unitPrice, priceTier: i.priceTier ?? 'retail1' as const, discount: 0, discountPercent: 0, subtotal: round2(i.unitPrice * i.quantity), returnedQty: 0 }));
  const total = round2(items.reduce((sum, i) => sum + i.subtotal, 0));
  const tendered = round2(input.payments.reduce((sum, p) => sum + p.amount, 0));
  const accountIncrease = round2(total - tendered);
  const advance = round2(Math.min(accountIncrease, Math.max(0, -customer.balance)));
  const sale: Sale = { id, invoiceNumber: `LEGACY-${id}`, date, branchId: input.branchId, cashierId: 'u1', customerId: customer.id, registerSessionId: input.registerSessionId ?? null, terminalId: 'legacy-terminal', items, subtotal: total, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total, paid: round2(tendered + advance), remaining: round2(accountIncrease - advance), change: 0, payments: input.payments, type: 'credit', status: 'completed', syncStatus: 'pending' };
  db.db.transaction(() => {
    db.insertSale(sale, 'pending');
    for (const item of items) db.adjustLocalStock(item.productId, sale.branchId, -item.quantity);
    db.upsertCustomer({ ...customer, balance: round2(customer.balance + accountIncrease), updatedAt: date });
    db.enqueue({ opId: uuid(), type: 'sale', createdAt: date, summary: sale.invoiceNumber, payload: { ...input, type: 'credit', invoiceDiscount: 0, invoiceNumber: sale.invoiceNumber, date, branchId: sale.branchId, cashierId: sale.cashierId, terminalId: sale.terminalId, localId: id } });
  })();
  return sale;
}

export function product(over: Partial<Product> = {}): Product {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    sku: 'SKU-1',
    internalBarcode: '2000000000017',
    name: { ar: 'فلتر زيت' },
    categoryId: 'c1',
    brandId: 'b1',
    unit: 'piece',
    cost: 50,
    prices: { retail1: 100, retail2: 90, wholesale: 80 },
    minStock: 2,
    isActive: true,
    compatibleModels: [],
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Product;
}

export function emptyPull(over: Partial<SyncPullResponse> = {}): SyncPullResponse {
  return {
    products: [],
    stockLevels: [],
    customers: [],
    specialPrices: [],
    quickProducts: [],
    quickCategories: [],
    printProfiles: [],
    motorcycleModels: [],
    categories: [],
    brands: [],
    branches: [],
    openSession: null,
    settings: DEFAULT_SETTINGS,
    deleted: { products: [], customers: [], quickProducts: [], quickCategories: [] },
    serverTime: new Date().toISOString(),
    ...over,
  };
}

/** Minimal fake of the API surface the sync worker touches. */
export function fakeApi(opts: { onPush?: (req: SyncPushRequest) => SyncOpResult[] | Promise<SyncOpResult[]>; healthy?: () => boolean } = {}) {
  const pushes: SyncPushRequest[] = [];
  const api = {
    sync: {
      health: vi.fn(async () => {
        if (opts.healthy && !opts.healthy()) throw new Error('down');
        return { ok: true };
      }),
      push: vi.fn(async (req: SyncPushRequest) => {
        pushes.push(req);
        const results = opts.onPush ? await opts.onPush(req) : req.ops.map((o) => ({ opId: o.opId, status: 'applied' as const, serverId: `srv-${o.opId.slice(0, 6)}` }));
        return { results, serverTime: new Date().toISOString() };
      }),
      pull: vi.fn(async () => emptyPull()),
      bootstrap: vi.fn(async () => emptyPull()),
    },
  };
  return { api: api as unknown as ApiClient, pushes, mock: api };
}

/** Worker with manual timers so tests stay deterministic. */
export function makeWorker(db: LocalDb, api: () => ApiClient | null) {
  const timers: { fn: () => void; ms: number }[] = [];
  const worker = new SyncWorker({
    db,
    api,
    terminalId: () => 'term-1',
    branchId: () => 'br-1',
    setTimer: (fn, ms) => {
      const h = { fn, ms };
      timers.push(h);
      return h;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  return { worker, timers };
}
