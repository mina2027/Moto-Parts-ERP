import { afterEach, expect, it } from 'vitest';
import { memDb, emptyPull, product } from '../test/helpers';
import type { LocalDb } from '../db/database';
import { localAlternatives } from './alternatives';

const open: LocalDb[] = [];
afterEach(() => { for (const db of open.splice(0)) db.close(); });

it('keeps every category in the offline catalog and matches alternatives by a shared secondary category', () => {
  const db = memDb(); open.push(db);
  const first = product({ id: 'p1', categoryId: 'c1', categoryIds: ['c1', 'shared'], partNumber: 'ENGINE-SET-A', compatibleModelIds: [], alternativeProductIds: [] });
  const second = product({ id: 'p2', internalBarcode: '2000000000024', sku: 'SKU-2', categoryId: 'c2', categoryIds: ['c2', 'shared'], partNumber: 'ENGINE-SET-B', compatibleModelIds: [], alternativeProductIds: [] });
  const pull = emptyPull({ products: [first, second], salesWarehouseId: 'w1', stockLevels: [first, second].map(p => ({ productId: p.id, warehouseId: 'w1', branchId: 'br-1', quantity: 10, reserved: 0 })) });
  db.applyPull(pull, 'br-1', true);
  expect(db.product('p1', 'br-1')?.categoryIds).toEqual(['c1', 'shared']);
  expect(localAlternatives(db, 'p1', 'br-1').map(alt => alt.product.id)).toEqual(['p2']);
  db.applyPull({ ...pull, products: [{ ...second, categoryIds: ['c2'] }] }, 'br-1', false);
  expect(localAlternatives(db, 'p1', 'br-1')).toEqual([]);
});
