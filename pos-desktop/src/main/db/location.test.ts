import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LocalDb } from './database';
import { NODE_SQLITE, emptyPull, memDb, product } from '../test/helpers';

const level = (over: Partial<{ productId: string; warehouseId: string; branchId: string; quantity: number; reserved: number; locationCode: string; shelf: string; bin: string }> = {}) => ({
  productId: 'p1',
  warehouseId: 'w1',
  branchId: 'br-1',
  quantity: 10,
  reserved: 0,
  locationCode: 'A',
  shelf: 'A3',
  bin: 'A3-04',
  ...over,
});

describe('offline product location', () => {
  it('keeps the shelf from the sync pull so POS works without the server', () => {
    const db = memDb();
    db.applyPull(emptyPull({ products: [product()], stockLevels: [level()] }), 'br-1', true);
    expect(db.product('p1', 'br-1')?.location).toBe('A · A3 · A3-04');
  });

  it('returns the shelf on a barcode lookup', () => {
    const db = memDb();
    db.applyPull(emptyPull({ products: [product()], stockLevels: [level()] }), 'br-1', true);
    const hit = db.lookup('2000000000017', 'br-1');
    expect(hit.products[0]?.location).toBe('A · A3 · A3-04');
  });

  it('uses the checkout warehouse even when another warehouse holds more stock', () => {
    const db = memDb();
    db.applyPull(
      emptyPull({
        products: [product()],
        salesWarehouseId: 'w1',
        stockLevels: [level({ warehouseId: 'w1', quantity: 2, shelf: 'A1', bin: '' }), level({ warehouseId: 'w2', quantity: 30, locationCode: 'B', shelf: 'B7', bin: 'B7-02' })],
      }),
      'br-1',
      true,
    );
    expect(db.product('p1', 'br-1')?.location).toBe('A · A1');
    expect(db.product('p1', 'br-1')?.available).toBe(2);
    db.adjustLocalStock('p1', 'br-1', -1);
    expect(db.stockLevels('br-1').find((l) => l.warehouseId === 'w1')?.quantity).toBe(1);
    expect(db.stockLevels('br-1').find((l) => l.warehouseId === 'w2')?.quantity).toBe(30);
    expect(() => db.adjustLocalStock('p1', 'br-1', -2)).toThrow('INSUFFICIENT_STOCK');
  });

  it('leaves the location undefined when no shelf is assigned', () => {
    const db = memDb();
    db.applyPull(emptyPull({ products: [product()], stockLevels: [level({ locationCode: '', shelf: '', bin: '' })] }), 'br-1', true);
    expect(db.product('p1', 'br-1')?.location).toBeUndefined();
  });

  it('round-trips the shelf through stockLevels()', () => {
    const db = memDb();
    db.applyPull(emptyPull({ products: [product()], stockLevels: [level()] }), 'br-1', true);
    expect(db.stockLevels('br-1')[0]).toMatchObject({ locationCode: 'A', shelf: 'A3', bin: 'A3-04' });
  });
});

describe('schema migration', () => {
  it('adds the location columns to a database created before they existed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'moto-mig-')), 'pos.db');
    // Build a v1 database: stock_levels without the location columns.
    const v1 = new Database(file, { nativeBinding: NODE_SQLITE });
    v1.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
    v1.exec(`CREATE TABLE stock_levels (product_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, branch_id TEXT NOT NULL, quantity REAL NOT NULL DEFAULT 0, reserved REAL NOT NULL DEFAULT 0, updated_at TEXT, PRIMARY KEY (product_id, warehouse_id))`);
    v1.prepare('INSERT INTO stock_levels(product_id, warehouse_id, branch_id, quantity, reserved) VALUES(?,?,?,?,?)').run('p1', 'w1', 'br-1', 7, 0);
    v1.prepare("INSERT INTO meta(key, value) VALUES('schema_version', '1')").run();
    v1.close();

    const upgraded = new LocalDb(file, { nativeBinding: NODE_SQLITE });
    const cols = (upgraded.db.prepare('PRAGMA table_info(stock_levels)').all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(['location_code', 'shelf', 'bin']));
    // Existing rows survive and default to no shelf.
    expect(upgraded.db.prepare('SELECT quantity, shelf FROM stock_levels WHERE product_id = ?').get('p1')).toEqual({ quantity: 7, shelf: '' });
    upgraded.close();
  });

  it('is a no-op on a freshly created database', () => {
    expect(() => {
      const db = memDb();
      db.close();
    }).not.toThrow();
  });
});
