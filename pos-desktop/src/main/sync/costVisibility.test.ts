import { describe, expect, it } from 'vitest';
import { visibleCosts } from '@moto/shared';
import { emptyPull, makeWorker, memDb, product } from '../test/helpers';
import { createLocalOps } from './localOps';

describe('cashier cost visibility with a manager-populated cache', () => {
  it('uses stored costs internally after the UI cost has been redacted', async () => {
    const db = memDb();
    try {
      db.applyPull(emptyPull({
        products: [product({ purchasePrice: 35, lastPurchaseCost: 40 })],
        salesWarehouseId: 'w1',
        stockLevels: [{ productId: 'p1', warehouseId: 'w1', branchId: 'br-1', quantity: 10, reserved: 0 }],
      }), 'br-1', true);
      const visible = visibleCosts(db.product('p1', 'br-1'), ['sales.create'])!;
      expect(visible.lastPurchaseCost).toBe(0);
      const { worker } = makeWorker(db, () => null);
      const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 't1', branchId: () => 'br-1', userId: () => 'cashier', publicUrl: () => 'http://erp.local' });
      const sale = await ops.createSale({ branchId: 'br-1', items: [{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: visible.lastPurchaseCost, priceTier: 'retail1' }], payments: [{ method: 'cash', amount: 100 }], type: 'cash' });
      expect(db.sale(sale.id)!.items[0]!.unitCost).toBe(40);
      expect(visibleCosts(sale, ['sales.create']).items[0]!.unitCost).toBe(0);
      expect(db.product('p1', 'br-1')!.lastPurchaseCost).toBe(40);
    } finally { db.close(); }
  });
});
