import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Customer, Sale, Session } from '@moto/shared';
import type { LocalDb } from './database';
import { memDb } from '../test/helpers';
import { invokeData } from '../dataAccess';

let db: LocalDb;
function sale(index: number, branchId = 'br-1'): Sale {
  return {
    id: `sale-${branchId}-${index}`, invoiceNumber: `INV-${branchId}-${index}`, date: '2026-10-12T08:00:00.000Z',
    branchId, cashierId: 'u1', customerId: index === 0 ? 'customer-1' : null, registerSessionId: null,
    items: [{ id: `item-${index}`, productId: 'p1', name: index === 0 ? { ar: 'فلتر زيت 100%', en: 'Élite oil filter 100%' } : { ar: 'منتج آخر' }, barcode: '', sku: '', quantity: 1, listPrice: 10, unitPrice: 10, unitCost: 5, priceTier: 'retail1', discount: 0, discountPercent: 0, subtotal: 10, returnedQty: 0 }],
    subtotal: 10, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 10, paid: 10, remaining: 0, change: 0,
    payments: [{ method: 'cash', amount: 10 }], type: 'cash', status: 'completed', syncStatus: 'pending',
  };
}
beforeEach(() => {
  db = memDb();
  db.db.transaction(() => {
    for (let index = 0; index < 605; index++) db.insertSale(sale(index), 'pending');
    // Newer foreign rows must not consume page slots or enter the total.
    for (let index = 0; index < 120; index++) db.insertSale(sale(index, 'br-2'), 'pending');
    db.upsertCustomer({ id: 'customer-1', name: { ar: 'أحمد', en: 'Émile' }, branchId: 'br-1' } as Customer);
  })();
});
afterEach(() => db.close());

it('keeps and pages all 605 invoices with deterministic order, filtering branches before pagination', () => {
  const ids: string[] = [];
  for (let page = 1; page <= 7; page++) {
    const result = db.salesHistory('br-1', { page, pageSize: 100 });
    expect(result).toMatchObject({ total: 605, page, pageSize: 100 });
    expect(result.data).toHaveLength(page === 7 ? 5 : 100);
    expect(result.data.every(s => s.branchId === 'br-1')).toBe(true);
    ids.push(...result.data.map(s => s.id));
  }
  expect(new Set(ids).size).toBe(605);
  expect(ids[0]).toBe(sale(604).id);
  expect(ids.at(-1)).toBe(sale(0).id);
  expect(db.saleByInvoice(sale(0).invoiceNumber)).toMatchObject({ id: sale(0).id });
});

it('searches old invoice numbers and bilingual customer and product names before paging', () => {
  for (const search of ['INV-br-1-0', 'أحمد', 'émILE', 'فلتر زيت', 'élite', '100%', '  فلتر زيت  ']) {
    const result = db.salesHistory('br-1', { search, pageSize: 100 });
    expect(result.total).toBe(1);
    expect(result.data.map(s => s.id)).toEqual([sale(0).id]);
  }
  expect(db.salesHistory('br-1', { search: 'INV-br-2' })).toMatchObject({ data: [], total: 0 });
  expect(db.salesHistory('br-1', { search: 'not found' })).toMatchObject({ data: [], total: 0 });
});

it('validates paginated IPC requests and applies sales permissions and cost projection', async () => {
  const read = vi.fn((query: Parameters<LocalDb['salesHistory']>[1]) => db.salesHistory('br-1', query));
  const viewer = { permissions: ['sales.view'] } as Session;
  await expect(invokeData({ salesHistory: read }, { permissions: [] } as unknown as Session, 'br-1', 'salesHistory', {})).rejects.toThrow('PERMISSION_DENIED');
  for (const query of [{ page: 0 }, { page: 1.5 }, { pageSize: 501 }, { search: 'a'.repeat(257) }, { branchId: 'br-2' }]) {
    await expect(invokeData({ salesHistory: read }, viewer, 'br-1', 'salesHistory', query)).rejects.toThrow('INVALID_IPC_ARGUMENT');
  }
  expect(read).not.toHaveBeenCalled();
  const result = await invokeData({ salesHistory: read }, viewer, 'br-1', 'salesHistory', { search: 'فلتر زيت' }) as { data: Sale[]; total: number };
  expect(result.total).toBe(1);
  expect(result.data[0]!.items[0]!.unitCost).toBe(0);
});
