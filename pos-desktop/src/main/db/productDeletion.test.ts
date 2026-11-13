import { describe, expect, it } from 'vitest';
import type { Customer } from '@moto/shared';
import { emptyPull, makeWorker, memDb, product } from '../test/helpers';
import { createLocalOps } from '../sync/localOps';

const customer = { id: 'c1', name: { ar: 'عميل' }, branchId: 'br-1', type: 'retail', isActive: true, balance: 0 } as Customer;
const special = { id: 'sp1', customerId: 'c1', productId: 'p1', price: 90, validFrom: '2026-01-01T00:00:00Z', validTo: null };
const quick = { id: 'qp1', productId: 'p1', categoryId: null, branchId: null, order: 0 };

describe('product deletion sync', () => {
  it('removes the deleted product and its operational references while retaining the local invoice', async () => {
    const db = memDb();
    try {
      db.applyPull(emptyPull({ products: [product()], customers: [customer], salesWarehouseId: 'w1', stockLevels: [{ productId: 'p1', warehouseId: 'w1', branchId: 'br-1', quantity: 1, reserved: 0 }], quickProducts: [quick], specialPrices: [special] }), 'br-1', true);
      const { worker } = makeWorker(db, () => null);
      const ops = createLocalOps({ db, worker, terminalCode: () => 'T001', terminalId: () => 't1', branchId: () => 'br-1', userId: () => 'cashier', publicUrl: () => 'http://erp.local' });
      const sale = await ops.createSale({ branchId: 'br-1', items: [{ productId: 'p1', quantity: 1, unitPrice: 100, unitCost: 50, priceTier: 'retail1' }], payments: [{ method: 'cash', amount: 100 }], type: 'cash' });
      const invoice = db.sale(sale.id);
      db.applyPull(emptyPull({ deleted: { products: ['p1'], customers: [], quickProducts: ['qp1'], quickCategories: [] } }), 'br-1', false);
      expect(db.product('p1', 'br-1')).toBeNull();
      expect(db.stockLevels('br-1')).toEqual([]);
      expect(db.quickProducts()).toEqual([]);
      expect(db.specialPrices()).toEqual([]);
      expect(db.sale(sale.id)).toEqual(invoice);
    } finally { db.close(); }
  });

  it('clears the last special price when a delta sends an empty authoritative set', () => {
    const db = memDb();
    try {
      db.applyPull(emptyPull({ products: [product()], customers: [customer], specialPrices: [special], quickProducts: [quick] }), 'br-1', true);
      expect(db.specialPrices()).toHaveLength(1);
      db.applyPull(emptyPull(), 'br-1', false);
      expect(db.specialPrices()).toEqual([]);
      expect(db.product('p1', 'br-1')).not.toBeNull();
      expect(db.quickProducts()).toHaveLength(1);
    } finally { db.close(); }
  });
});
