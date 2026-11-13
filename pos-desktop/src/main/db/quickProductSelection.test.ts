import { describe, expect, it } from 'vitest';
import { emptyPull, memDb, product } from '../test/helpers';

describe('quick product selection sync', () => {
  it('stores changes to quick visibility without removing the product from lookup', () => {
    const db = memDb();
    try {
      const original = product({ isQuickProduct: true });
      db.applyPull(emptyPull({ products: [original] }), 'br-1', true);
      expect(db.products('br-1')[0]!.isQuickProduct).toBe(true);
      db.applyPull(emptyPull({ products: [{ ...original, isQuickProduct: false }] }), 'br-1', false);
      expect(db.products('br-1')[0]!.isQuickProduct).toBe(false);
      expect(db.lookup(original.internalBarcode, 'br-1').products[0]!.isQuickProduct).toBe(false);
      db.applyPull(emptyPull({ products: [{ ...original, isQuickProduct: true }] }), 'br-1', false);
      expect(db.product(original.id, 'br-1')!.isQuickProduct).toBe(true);
    } finally {
      db.close();
    }
  });
});
