import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import type { CategoryNode } from '@moto/shared';
import { api, loginAs, startTestDb, stopTestDb } from '../../test/harness.js';
import { CategoryModel, ProductModel } from '../../db/models.js';

let app: Express;
let admin: Awaited<ReturnType<typeof loginAs>>;
const auth = () => ({ Authorization: `Bearer ${admin.token}` });
const root = 'multi-root';
const first = 'multi-first';
const second = 'multi-second';
const third = 'multi-third';
const payload = (sku: string) => ({ name: { ar: 'منتج متعدد الفئات' }, sku, brandId: 'brand-1', categoryId: first, categoryIds: [first, second, second], purchasePrice: 10, prices: { retail1: 20 }, compatibleModelIds: [], unit: { ar: 'قطعة' } });

beforeAll(async () => {
  app = await startTestDb({ seed: true });
  admin = await loginAs(app, 'admin');
  await CategoryModel.insertMany([
    { _id: root, name: { ar: 'قسم متعدد' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true },
    ...[first, second, third].map((id, index) => ({ _id: id, name: { ar: `فئة ${index + 1}` }, parentId: root, ancestors: [root], sortOrder: index, isActive: true })),
  ]);
});
afterAll(stopTestDb);

describe('products assigned to multiple categories', () => {
  it('saves and retrieves all categories and deduplicates repeated selections', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(payload('MULTI-CREATE'));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ categoryId: first, categoryIds: [first, second] });
    const loaded = await api(app).get(`/api/products/${created.body.id}`).set(auth());
    expect(loaded.body.categoryIds).toEqual([first, second]);
    const snapshot = await api(app).get('/api/sync/bootstrap').set(auth()).query({ branchId: 'br-1' });
    expect(snapshot.body.products.find((p: { id: string }) => p.id === created.body.id)?.categoryIds).toEqual([first, second]);
    for (const categoryId of [first, second, root]) {
      const list = await api(app).get('/api/products').set(auth()).query({ categoryId, includeDescendants: true, search: 'MULTI-CREATE' });
      expect(list.status).toBe(200);
      expect(list.body.data.map((p: { id: string }) => p.id)).toEqual([created.body.id]);
    }
    const excluded = await api(app).get('/api/products').set(auth()).query({ categoryId: third, search: 'MULTI-CREATE' });
    expect(excluded.body.data).toEqual([]);
  });

  it('counts a product in every selected category and once in their shared parent', async () => {
    const before = await ProductModel.countDocuments({ categoryId: first, deletedAt: null });
    const tree = await api(app).get('/api/catalog/categories/tree').set(auth());
    const department = (tree.body as CategoryNode[]).find(c => c.id === root)!;
    expect(department.totalProductCount).toBe(before);
    expect(department.children.find(c => c.id === first)?.productCount).toBe(before);
    expect(department.children.find(c => c.id === second)?.productCount).toBe(before);
    const deletion = await api(app).delete(`/api/catalog/categories/${second}`).set(auth());
    expect(deletion.status).toBe(409);
    expect(deletion.body.error.code).toBe('CATEGORY_NOT_EMPTY');
  });

  it('replaces selections, changes the primary when removed, and preserves categories on unrelated edits', async () => {
    const created = await api(app).post('/api/products').set(auth()).send(payload('MULTI-UPDATE'));
    const changed = await api(app).patch(`/api/products/${created.body.id}`).set(auth()).send({ categoryIds: [second, third] });
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ categoryId: second, categoryIds: [second, third] });
    const renamed = await api(app).patch(`/api/products/${created.body.id}`).set(auth()).send({ name: { ar: 'اسم جديد' } });
    expect(renamed.body.categoryIds).toEqual([second, third]);
    const list = await api(app).get('/api/products').set(auth()).query({ categoryId: first, search: 'MULTI-UPDATE' });
    expect(list.body.data).toEqual([]);
  });

  it('rejects empty or missing categories before saving', async () => {
    const before = await ProductModel.countDocuments();
    const invalid = await api(app).post('/api/products').set(auth()).send({ ...payload('MULTI-BAD'), categoryIds: [first, 'missing-category'] });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error.code).toBe('INVALID_CATEGORY');
    const empty = await api(app).post('/api/products').set(auth()).send({ ...payload('MULTI-EMPTY'), categoryIds: [] });
    expect(empty.status).toBe(400);
    expect(await ProductModel.countDocuments()).toBe(before);
  });

  it('accepts legacy requests and replaces all categories during a bulk move', async () => {
    const { categoryIds: _categories, ...legacy } = payload('MULTI-LEGACY');
    const created = await api(app).post('/api/products').set(auth()).send(legacy);
    expect(created.status).toBe(201);
    expect(created.body.categoryIds).toEqual([first]);
    const assigned = await api(app).patch(`/api/products/${created.body.id}`).set(auth()).send({ categoryIds: [first, second] });
    expect(assigned.status).toBe(200);
    const moved = await api(app).post('/api/products/move').set(auth()).send({ ids: [created.body.id], categoryId: third });
    expect(moved.status).toBe(200);
    const saved = await ProductModel.findById(created.body.id).lean();
    expect(saved).toMatchObject({ categoryId: third, categoryIds: [third] });
  });
});
