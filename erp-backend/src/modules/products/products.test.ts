import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { Warehouse } from '@moto/shared';
import { api, loginAs, startTestDb, stopTestDb } from '../../test/harness.js';
import { AuditLogModel, CustomerModel, PriceHistoryModel, ProductModel, QuickProductModel, SaleModel, SpecialPriceModel, StockLevelModel, StockMovementModel, TombstoneModel, WarehouseModel } from '../../db/models.js';
import { withTransaction } from '../../db/connect.js';
import { applyMovement } from '../inventory/stock.js';
import { deleteProduct } from './service.js';

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;
let wh: Warehouse & { _id: string };

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  admin = await loginAs(app, 'admin');
  const all = (await WarehouseModel.find({ isActive: true }).lean()) as unknown as (Warehouse & { _id: string })[];
  wh = all.find((w) => w.locations.length > 1 && w.locations[1]!.shelves.length > 1)!;
});
afterAll(stopTestDb);

const auth = () => ({ Authorization: `Bearer ${admin.token}` });
const base = (sku: string) => ({
  name: { ar: 'منتج برف' },
  sku,
  partNumber: 'SHELF-1',
  brandId: 'brand-1',
  categoryId: 'cat-dep-2w-125-cat-2',
  supplierId: 'sup-1',
  purchasePrice: 10,
  prices: { retail1: 20, retail2: 18, wholesale: 15 },
  unit: { ar: 'قطعة' },
});

describe('quick product selection', () => {
  it('defaults to visible and preserves an explicit choice across unrelated edits', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-QUICK-DEFAULT'));
    expect(created.status).toBe(201);
    expect(created.body.isQuickProduct).toBe(true);
    const id = created.body.id;
    const disabled = await api(app).patch(`/api/products/${id}`).set(auth()).send({ isQuickProduct: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.isQuickProduct).toBe(false);
    const edited = await api(app).patch(`/api/products/${id}`).set(auth()).send({ partNumber: 'QUICK-EDIT' });
    expect(edited.status).toBe(200);
    expect(edited.body.isQuickProduct).toBe(false);
    expect((await ProductModel.findById(id).lean())!.isQuickProduct).toBe(false);
    const enabled = await api(app).patch(`/api/products/${id}`).set(auth()).send({ isQuickProduct: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.isQuickProduct).toBe(true);
  });

  it('keeps an excluded product searchable and sends its choice through desktop sync', async () => {
    const since = new Date(Date.now() - 1000).toISOString();
    const created = await api(app).post('/api/products').set(auth()).send({ ...base('SKU-QUICK-OFF'), isQuickProduct: false });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await ProductModel.findById(id).lean())!.isQuickProduct).toBe(false);
    const lookup = await api(app).get('/api/products/lookup').query({ term: created.body.internalBarcode }).set(auth());
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual(expect.arrayContaining([expect.objectContaining({ id, isQuickProduct: false })]));
    const catalog = await api(app).get('/api/products/all').set(auth());
    expect(catalog.status).toBe(200);
    expect(catalog.body).toEqual(expect.arrayContaining([expect.objectContaining({ id, isQuickProduct: false })]));
    const pull = await api(app).get('/api/sync/pull').query({ branchId: admin.user.branchId, since }).set(auth());
    expect(pull.status).toBe(200);
    expect(pull.body.products).toEqual(expect.arrayContaining([expect.objectContaining({ id, isQuickProduct: false })]));
  });
});

describe('product shelf placement', () => {
  it('stores the chosen shelf/bin on the warehouse stock level when creating', async () => {
    const loc = wh.locations[1]!;
    const shelf = loc.shelves[1]!;
    const bin = shelf.bins[0]!;
    const res = await api(app).post('/api/products').set(auth()).send({ ...base('SKU-SHELF-001'), placement: { warehouseId: wh._id, locationCode: loc.code, shelf: shelf.code, bin: bin.code } });
    expect(res.status).toBe(201);
    const level = await StockLevelModel.findOne({ productId: res.body.id, warehouseId: wh._id }).lean();
    expect(level).toMatchObject({ locationCode: loc.code, shelf: shelf.code, bin: bin.code, quantity: 0 });
    const others = await StockLevelModel.find({ productId: res.body.id, warehouseId: { $ne: wh._id } }).lean();
    expect(others.every((l) => l.shelf === 'A1')).toBe(true);
  });

  it('rejects a shelf that is not part of the warehouse structure without creating the product', async () => {
    const res = await api(app).post('/api/products').set(auth()).send({ ...base('SKU-SHELF-002'), placement: { warehouseId: wh._id, locationCode: wh.locations[0]!.code, shelf: 'NOPE-9' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PLACEMENT');
    expect(await ProductModel.exists({ sku: 'SKU-SHELF-002' })).toBeNull();
  });

  it('moves the product to another shelf on update', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-SHELF-003'));
    expect(created.status).toBe(201);
    const loc = wh.locations[0]!;
    const shelf = loc.shelves[loc.shelves.length - 1]!;
    const res = await api(app).patch(`/api/products/${created.body.id}`).set(auth()).send({ placement: { warehouseId: wh._id, locationCode: loc.code, shelf: shelf.code } });
    expect(res.status).toBe(200);
    const level = await StockLevelModel.findOne({ productId: created.body.id, warehouseId: wh._id }).lean();
    expect(level).toMatchObject({ locationCode: loc.code, shelf: shelf.code, bin: '' });
  });
});

describe('product deletion', () => {
  it('rejects stock in any warehouse even when positive and negative balances total zero, without changing anything', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-DELETE-BALANCE'));
    expect(created.status).toBe(201);
    const id = created.body.id;
    const levels = await StockLevelModel.find({ productId: id }).lean();
    await StockLevelModel.updateOne({ _id: levels[0]!._id }, { $set: { quantity: 5 } });
    await StockLevelModel.updateOne({ _id: levels[1]!._id }, { $set: { quantity: -5 } });
    await QuickProductModel.create({ _id: 'qp-delete-blocked', productId: id, updatedAt: new Date().toISOString() });
    const result = await api(app).delete(`/api/products/${id}`).set(auth());
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PRODUCT_HAS_STOCK');
    expect((await ProductModel.findById(id).lean())!.deletedAt).toBeNull();
    expect(await QuickProductModel.exists({ _id: 'qp-delete-blocked' })).toBeTruthy();
    expect(await AuditLogModel.countDocuments({ entityId: id, action: 'product_delete' })).toBe(0);
  });

  it('rejects reservations even when the physical quantity is zero', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-DELETE-RESERVED'));
    expect(created.status).toBe(201);
    const id = created.body.id;
    await StockLevelModel.updateOne({ productId: id }, { $set: { reserved: 1 } });
    const result = await api(app).delete(`/api/products/${id}`).set(auth());
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('PRODUCT_HAS_RESERVATIONS');
    expect((await ProductModel.findById(id).lean())!.deletedAt).toBeNull();
  });

  it('hides the product, retains historical data, records the actor and syncs the deletion to POS', async () => {
    const id = 'prod-6';
    await StockLevelModel.updateMany({ productId: id }, { $set: { quantity: 0, reserved: 0 } });
    await ProductModel.updateOne({ _id: id }, { $set: { alternativeProductIds: ['prod-7'], compatibleModelIds: ['model-1'] } });
    await ProductModel.updateOne({ _id: 'prod-7' }, { $addToSet: { alternativeProductIds: id } });
    await QuickProductModel.create([
      { _id: 'qp-delete-global', productId: id, branchId: null, updatedAt: new Date().toISOString() },
      { _id: 'qp-delete-branch', productId: id, branchId: wh.branchId, updatedAt: new Date().toISOString() },
      { _id: 'qp-delete-keep', productId: 'prod-7', updatedAt: new Date().toISOString() },
    ]);
    const customer = await CustomerModel.findOne().lean();
    await SpecialPriceModel.create([{ _id: 'sp-delete', productId: id, customerId: customer!._id, price: 12, validFrom: new Date().toISOString() }, { _id: 'sp-delete-keep', productId: 'prod-7', customerId: customer!._id, price: 13, validFrom: new Date().toISOString() }]);
    const before = await ProductModel.findById(id).lean();
    const levels = await StockLevelModel.find({ productId: id }).lean();
    const historyCount = await PriceHistoryModel.countDocuments({ productId: id });
    const movementCount = await StockMovementModel.countDocuments({ productId: id });
    const salesCount = await SaleModel.countDocuments({ 'items.productId': id });
    const since = new Date(Date.now() - 1000).toISOString();

    const deleted = await api(app).delete(`/api/products/${id}`).set(auth());
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ ok: true });
    const stored = await ProductModel.findById(id).lean();
    expect(stored).toMatchObject({ isActive: false, name: before!.name, sku: before!.sku });
    expect(stored!.deletedAt).toBeTruthy();
    expect(stored!.updatedAt).toBe(stored!.deletedAt);
    expect(stored!.alternativeProductIds).toEqual([]);
    expect(stored!.compatibleModelIds).toEqual([]);
    expect((await ProductModel.findById('prod-7').lean())!.alternativeProductIds).not.toContain(id);
    expect(await QuickProductModel.countDocuments({ productId: id })).toBe(0);
    expect(await SpecialPriceModel.countDocuments({ productId: id })).toBe(0);
    expect(await QuickProductModel.exists({ _id: 'qp-delete-keep' })).toBeTruthy();
    expect(await SpecialPriceModel.exists({ _id: 'sp-delete-keep' })).toBeTruthy();
    expect(await TombstoneModel.countDocuments({ entityId: { $in: ['qp-delete-global', 'qp-delete-branch'] }, coll: 'quickProducts' })).toBe(2);
    expect(await StockLevelModel.find({ productId: id }).lean()).toEqual(levels);
    expect(await PriceHistoryModel.countDocuments({ productId: id })).toBe(historyCount);
    expect(await StockMovementModel.countDocuments({ productId: id })).toBe(movementCount);
    expect(await SaleModel.countDocuments({ 'items.productId': id })).toBe(salesCount);
    expect(await AuditLogModel.findOne({ entityId: id, action: 'product_delete' }).lean()).toMatchObject({ userId: admin.user.id, branchId: admin.user.branchId });

    expect((await api(app).get(`/api/products/${id}`).set(auth())).status).toBe(404);
    expect((await api(app).get(`/api/products/${id}/stock`).set(auth())).status).toBe(404);
    const list = await api(app).get('/api/products').query({ search: before!.sku }).set(auth());
    expect(list.status).toBe(200);
    expect(list.body.data.some((p: { id: string }) => p.id === id)).toBe(false);
    const all = await api(app).get('/api/products/all').set(auth());
    expect(all.status).toBe(200);
    expect(all.body.some((p: { id: string }) => p.id === id)).toBe(false);
    const historical = await api(app).get('/api/products/all').query({ includeDeleted: true }).set(auth());
    expect(historical.status).toBe(200);
    expect(historical.body.find((p: { id: string }) => p.id === id)).toMatchObject({ name: before!.name, sku: before!.sku, isActive: false });
    const lookup = await api(app).get('/api/products/lookup').query({ term: before!.internalBarcode }).set(auth());
    expect(lookup.status).toBe(200);
    expect(lookup.body).toEqual([]);
    const pull = await api(app).get('/api/sync/pull').query({ branchId: admin.user.branchId, since }).set(auth());
    expect(pull.status).toBe(200);
    expect(pull.body.deleted.products).toContain(id);
    expect(pull.body.products.some((p: { id: string }) => p.id === id)).toBe(false);
    expect(pull.body.deleted.quickProducts).toEqual(expect.arrayContaining(['qp-delete-global', 'qp-delete-branch']));
    expect(pull.body.quickProducts.some((p: { productId: string }) => p.productId === id)).toBe(false);
    expect(pull.body.specialPrices.some((p: { productId: string }) => p.productId === id)).toBe(false);
    expect(pull.body.products.find((p: { id: string }) => p.id === 'prod-7').alternativeProductIds).not.toContain(id);
    const bootstrap = await api(app).get('/api/sync/bootstrap').query({ branchId: admin.user.branchId }).set(auth());
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body.stockLevels.some((level: { productId: string }) => level.productId === id)).toBe(false);
    const inventory = await api(app).get('/api/inventory/levels').query({ productId: id }).set(auth());
    expect(inventory.status).toBe(200);
    expect(inventory.body).toEqual([]);
  });

  it('rejects editing or reactivating a deleted product and does not delete it twice', async () => {
    expect((await api(app).patch('/api/products/prod-6').set(auth()).send({ isActive: true })).status).toBe(404);
    expect((await api(app).delete('/api/products/prod-6').set(auth())).status).toBe(404);
    expect((await api(app).delete('/api/products/missing-product').set(auth())).status).toBe(404);
    expect(await AuditLogModel.countDocuments({ entityId: 'prod-6', action: 'product_delete' })).toBe(1);
  });

  it('does not let stale requests recreate auxiliary references or new stock for a deleted product', async () => {
    const customer = await CustomerModel.findOne().lean();
    expect((await api(app).post('/api/quick-products').set(auth()).send({ productId: 'prod-6' })).status).toBe(404);
    expect((await api(app).post('/api/customers/special-prices').set(auth()).send({ productId: 'prod-6', customerId: customer!._id, price: 10, validFrom: new Date().toISOString() })).status).toBe(404);
    expect((await api(app).post('/api/products/prod-7/alternatives').set(auth()).send({ altId: 'prod-6', link: true })).status).toBe(404);
    expect((await api(app).post('/api/products/prod-6/compatibility').set(auth()).send({ modelId: 'model-1', compatible: true })).status).toBe(404);
    await expect(withTransaction((session) => applyMovement({ productId: 'prod-6', warehouseId: wh._id, branchId: wh.branchId, delta: 1, type: 'adjustment_in', userId: admin.user.id, reference: 'STALE-ADJUSTMENT' }, session))).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    expect(await QuickProductModel.countDocuments({ productId: 'prod-6' })).toBe(0);
    expect(await SpecialPriceModel.countDocuments({ productId: 'prod-6' })).toBe(0);
  });

  it('serializes deletion against concurrent stock changes', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-DELETE-RACE'));
    expect(created.status).toBe(201);
    const id = created.body.id;
    const results = await Promise.allSettled([
      deleteProduct(id, admin.user.id, admin.user.branchId, ''),
      withTransaction((session) => applyMovement({ productId: id, warehouseId: wh._id, branchId: wh.branchId, delta: 1, type: 'adjustment_in', userId: admin.user.id, reference: 'DELETE-RACE' }, session)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stored = await ProductModel.findById(id).lean();
    const level = await StockLevelModel.findOne({ productId: id, warehouseId: wh._id }).lean();
    if (stored!.deletedAt) expect(level!.quantity).toBe(0);
    else expect(level!.quantity).toBe(1);
  });

  it('restores a deleted product when a historical sale return puts real stock back', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(base('SKU-DELETE-RETURN'));
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await api(app).delete(`/api/products/${id}`).set(auth())).status).toBe(200);
    await withTransaction((session) => applyMovement({ productId: id, warehouseId: wh._id, branchId: wh.branchId, delta: 1, type: 'sale_return', userId: admin.user.id, reference: 'HISTORICAL-RETURN' }, session));
    expect((await ProductModel.findById(id).lean())).toMatchObject({ isActive: true, deletedAt: null });
    const current = await api(app).get(`/api/products/${id}`).set(auth());
    expect(current.status).toBe(200);
    expect(current.body.totalStock).toBe(1);
    expect((await api(app).delete(`/api/products/${id}`).set(auth())).body.error.code).toBe('PRODUCT_HAS_STOCK');
  });

  it('requires product editing permissions', async () => {
    const cashier = await loginAs(app, 'cashier1');
    expect((await api(app).delete('/api/products/prod-7')).status).toBe(401);
    expect((await api(app).delete('/api/products/prod-7').set({ Authorization: `Bearer ${cashier.token}` })).status).toBe(403);
    expect((await ProductModel.findById('prod-7').lean())!.deletedAt).toBeNull();
  });
});
