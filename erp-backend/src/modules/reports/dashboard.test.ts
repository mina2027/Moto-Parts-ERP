import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { api, loginAs, startTestDb, stopTestDb } from '../../test/harness.js';
import { ProductModel, SaleModel } from '../../db/models.js';

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;
const date = '2020-01-03T12:00:00.000Z';
const query = { from: '2020-01-03', to: '2020-01-03' };

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  admin = await loginAs(app, 'admin');
  await SaleModel.create({
    _id: 'sale-dashboard-history', invoiceNumber: 'INV-DASHBOARD-HISTORY', date,
    branchId: 'br-1', cashierId: admin.user.id,
    items: [10, 20, 30, 40, 50, 60, 70, 80, 900, 1000].map((amount, index) => ({
      id: `history-line-${index}`, productId: `prod-${index + 1}`, name: { ar: 'Historical part' },
      quantity: 1, unitPrice: amount, unitCost: 1, listPrice: amount,
      priceTier: 'retail1', discount: 0, subtotal: amount, returnedQty: 0,
    })),
    subtotal: 2260, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 2260,
    paid: 2260, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 2260 }],
    type: 'cash', status: 'completed',
  });
  await ProductModel.updateOne({ _id: 'prod-9' }, { $set: { deletedAt: date } });
  await ProductModel.deleteOne({ _id: 'prod-10' });
});
afterAll(stopTestDb);

describe('dashboard with historical product references', () => {
  it('loads eight available top products while retaining sales of deleted and missing products in totals', async () => {
    const result = await api(app).get('/api/reports/dashboard').query(query)
      .set({ Authorization: `Bearer ${admin.token}` });

    expect(result.status).toBe(200);
    expect(result.body.kpis).toMatchObject({ todaySales: 2260, todayProfit: 2250, invoicesCount: 1 });
    expect(result.body.salesSeries).toMatchObject([{ sales: 2260, profit: 2250 }]);
    expect(result.body.topProducts.map((row: { product: { id: string } }) => row.product.id))
      .toEqual(['prod-8', 'prod-7', 'prod-6', 'prod-5', 'prod-4', 'prod-3', 'prod-2', 'prod-1']);
  });
});
