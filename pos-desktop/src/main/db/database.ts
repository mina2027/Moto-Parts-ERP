import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type {
  AppSettings, Branch, Brand, Category, Customer, ListQuery, MotorcycleModel, Paginated, PrintProfile, Product, QuickCategory, QuickProduct, RegisterSession, Sale, SaleReturn, SpecialPrice, StockLevel, SyncPullResponse,
} from '@moto/shared';
import { mergeAppSettings, projectCustomer, customerVisibleInBranch, normalizePrintProfile } from '@moto/shared';
import { MIGRATIONS, SCHEMA_SQL, SCHEMA_VERSION } from './schema';
import type { LocalProduct, OutboxRow } from '../../shared/ipc';

export type OutboxStatus = 'pending' | 'sent' | 'applied' | 'rejected';

/** Thin typed repository over better-sqlite3. All methods are synchronous (main process only). */
export class LocalDb {
  readonly db: Database.Database;
  constructor(file: string, opts: { nativeBinding?: string } = {}) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file, opts.nativeBinding ? { nativeBinding: opts.nativeBinding } : {});
    // SQLite's built-in lower() only folds ASCII characters.
    this.db.function('search_fold', { deterministic: true }, (value: string) => value.toLocaleLowerCase());
    this.db.exec(SCHEMA_SQL);
    this.migrate();
  }

  private migrate() {
    const current = Number(this.getMeta('schema_version') ?? '0');
    if (current >= SCHEMA_VERSION) return;
    const run = this.db.transaction(() => {
      for (let v = current + 1; v <= SCHEMA_VERSION; v++) {
        for (const sql of MIGRATIONS[v] ?? []) if (this.needsMigration(sql)) this.db.exec(sql);
        this.setMeta('schema_version', String(v));
      }
    });
    run();
  }

  /** SQLite has no ADD COLUMN IF NOT EXISTS, and SCHEMA_SQL already creates fresh databases up to date. */
  private needsMigration(sql: string): boolean {
    const add = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/i.exec(sql);
    if (!add) return true;
    const [, table, column] = add;
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return !cols.some((c) => c.name === column);
  }

  close() {
    this.db.close();
  }

  // ---- meta / state ----
  getMeta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }
  setMeta(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM meta WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  getState(key: string): string | null {
    return (this.db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }
  setState(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM sync_state WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  getPref(key: string): string | null {
    return (this.db.prepare('SELECT value FROM print_prefs WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }
  setPref(key: string, value: string | null) {
    if (value === null) this.db.prepare('DELETE FROM print_prefs WHERE key = ?').run(key);
    else this.db.prepare('INSERT INTO print_prefs(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }
  /** Monotonic per-terminal invoice sequence. */
  nextLocalSeq(): number {
    const cur = Number(this.getState('localInvoiceSeq') ?? '0') + 1;
    this.setState('localInvoiceSeq', String(cur));
    return cur;
  }

  // ---- catalog ----
  private upsertDoc(table: string, id: string, doc: unknown, extra: Record<string, unknown> = {}) {
    const cols = ['id', 'doc', ...Object.keys(extra)];
    const placeholders = cols.map(() => '?').join(', ');
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    this.db.prepare(`INSERT INTO ${table}(${cols.join(', ')}) VALUES(${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updates}`).run(id, JSON.stringify(doc), ...Object.values(extra));
  }
  private allDocs<T>(table: string, orderBy = 'rowid'): T[] {
    return (this.db.prepare(`SELECT doc FROM ${table} ORDER BY ${orderBy}`).all() as { doc: string }[]).map((r) => JSON.parse(r.doc) as T);
  }

  applyPull(pull: SyncPullResponse, branchId: string, full: boolean) {
    const tx = this.db.transaction(() => {
      const localCustomers = this.allDocs<Customer>('customers');
      if (full) {
        for (const t of ['products', 'stock_levels', 'customers', 'special_prices', 'quick_products', 'quick_categories', 'print_profiles', 'motorcycle_models', 'categories', 'brands', 'branches']) this.db.exec(`DELETE FROM ${t}`);
      }
      const upP = this.db.prepare(`INSERT INTO products(id, internal_barcode, legacy_barcode, sku, part_number, name_ar, name_en, category_id, is_active, updated_at, doc)
        VALUES(@id, @internal_barcode, @legacy_barcode, @sku, @part_number, @name_ar, @name_en, @category_id, @is_active, @updated_at, @doc)
        ON CONFLICT(id) DO UPDATE SET internal_barcode = excluded.internal_barcode, legacy_barcode = excluded.legacy_barcode, sku = excluded.sku, part_number = excluded.part_number, name_ar = excluded.name_ar, name_en = excluded.name_en, category_id = excluded.category_id, is_active = excluded.is_active, updated_at = excluded.updated_at, doc = excluded.doc`);
      for (const p of pull.products) upP.run({ id: p.id, internal_barcode: p.internalBarcode, legacy_barcode: p.legacyBarcode ?? null, sku: p.sku, part_number: p.partNumber ?? null, name_ar: p.name.ar, name_en: p.name.en ?? null, category_id: p.categoryId, is_active: p.isActive ? 1 : 0, updated_at: p.updatedAt, doc: JSON.stringify(p) });
      const upS = this.db.prepare(`INSERT INTO stock_levels(product_id, warehouse_id, branch_id, quantity, reserved, location_code, shelf, bin, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(product_id, warehouse_id) DO UPDATE SET quantity = excluded.quantity, reserved = excluded.reserved, branch_id = excluded.branch_id, location_code = excluded.location_code, shelf = excluded.shelf, bin = excluded.bin, updated_at = excluded.updated_at`);
      for (const l of pull.stockLevels) if (l.branchId === branchId) upS.run(l.productId, l.warehouseId, l.branchId, l.quantity, l.reserved, l.locationCode ?? '', l.shelf ?? '', l.bin ?? '', l.updatedAt ?? null);
      for (const c of pull.customers) {
        if (c.isActive && customerVisibleInBranch(c, branchId)) this.upsertDoc('customers', c.id, projectCustomer(c, branchId), { updated_at: c.updatedAt ?? c.createdAt });
        else this.db.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
      }
      // Old installations may retain rows omitted by a safer delta. Scrub their projection too.
      for (const c of this.customers()) {
        if (!customerVisibleInBranch(c, branchId)) this.db.prepare('DELETE FROM customers WHERE id = ?').run(c.id);
        else if (c.branchId !== branchId) this.upsertCustomer(projectCustomer(c, branchId));
      }
      // Only touched snapshot rows need their outstanding local effects reapplied. A delta that
      // omits a product/customer already contains those effects in the local row.
      const acknowledged = new Set((pull.acknowledgedOps ?? []).map(o => o.opId));
      for (const value of pull.refundHistory ?? []) {
        if (value.branchId !== branchId) continue;
        const localSale = this.saleByInvoice(value.invoiceNumber);
        if (!localSale) continue;
        const receipt = pull.acknowledgedOps?.find(op => op.serverId === value.id);
        const existing = this.db.prepare('SELECT id FROM sale_returns WHERE server_id = ? OR id = ? OR op_id = ?').get(value.id, value.id, receipt?.opId ?? null) as { id: string } | undefined;
        const doc = { ...value, saleId: localSale.id };
        if (existing) this.db.prepare("UPDATE sale_returns SET status = 'applied', server_id = ?, doc = ? WHERE id = ?").run(value.id, JSON.stringify(doc), existing.id);
        else this.db.prepare("INSERT INTO sale_returns(id, sale_id, status, server_id, doc) VALUES(?, ?, 'applied', ?, ?)").run(value.id, localSale.id, value.id, JSON.stringify(doc));
      }
      for (const authoritative of pull.returnSales ?? []) {
        const local = this.saleByInvoice(authoritative.invoiceNumber);
        if (!local || authoritative.branchId !== branchId || this.returnsForSale(local.id).some(r => r.status !== 'applied' && !acknowledged.has((this.db.prepare('SELECT op_id FROM sale_returns WHERE id = ?').get(r.value.id) as { op_id: string } | undefined)?.op_id ?? ''))) continue;
        if (local.items.length !== authoritative.items.length || local.items.some((line, i) => line.productId !== authoritative.items[i]?.productId)) continue;
        this.updateSale({ ...local, paid: authoritative.paid, remaining: authoritative.remaining, status: authoritative.status, items: local.items.map((line, i) => ({ ...line, returnedQty: authoritative.items[i]!.returnedQty })) });
      }
      const stockTouched = new Set(pull.stockLevels.filter(l => l.branchId === branchId).map(l => `${l.productId}/${l.warehouseId}`));
      const customerTouched = new Set(pull.customers.map(c => c.id));
      const customerDeltas = new Map<string, number>();
      const outstanding = this.db.prepare("SELECT op_id, type, payload FROM outbox WHERE status IN ('pending','sent','rejected') ORDER BY rowid").all() as { op_id: string; type: string; payload: string }[];
      for (const op of outstanding) {
        if (acknowledged.has(op.op_id)) continue;
        const p = JSON.parse(op.payload) as { localId?: string; saleId?: string; id?: string; customerId?: string; amount?: number; customerBalanceDelta?: number; type?: string; payments?: { method: string; amount: number }[]; items?: { productId: string; quantity: number }[] };
        if (op.type === 'customer_create' && p.id) {
          const local = localCustomers.find(c => c.id === p.id);
          if (local && local.branchId === branchId && !this.customers().some(c => c.id === p.id)) this.upsertCustomer({ ...local, balance: 0 });
        }
        const sale = op.type === 'sale' && p.localId ? this.sale(p.localId) : op.type === 'sale_return' && p.saleId ? this.sale(p.saleId) : null;
        if (sale?.status === 'cancelled') continue;
        if (op.type === 'sale' || op.type === 'sale_return') {
          const warehouse = this.salesWarehouse(branchId);
          for (const item of p.items ?? []) if (full || stockTouched.has(`${item.productId}/${warehouse}`)) this.adjustLocalStock(item.productId, branchId, (op.type === 'sale' ? -1 : 1) * item.quantity);
        }
        const customerId = p.customerId ?? sale?.customerId;
        const initialDebt = sale ? Math.max(0, sale.total - Math.min(sale.total, (p.payments ?? []).filter(payment => payment.method !== 'credit').reduce((sum, payment) => sum + payment.amount, 0))) : 0;
        const delta = op.type === 'sale' && sale?.type === 'credit' ? initialDebt : op.type === 'customer_payment' ? -(p.amount ?? 0) : op.type === 'sale_return' ? p.customerBalanceDelta ?? 0 : 0;
        if (customerId && (full || customerTouched.has(customerId))) customerDeltas.set(customerId, (customerDeltas.get(customerId) ?? 0) + delta);
      }
      for (const [customerId, delta] of customerDeltas) {
        const c = this.customers().find(c => c.id === customerId);
        if (c && c.branchId === branchId) this.upsertCustomer({ ...c, balance: Math.round((c.balance + delta) * 100) / 100 });
      }
      // The server sends the complete special-price set, including an authoritative empty set.
      this.db.exec('DELETE FROM special_prices');
      for (const s of pull.specialPrices) if (this.customers().some(c => c.id === s.customerId && c.branchId === branchId)) this.upsertDoc('special_prices', s.id, s, { customer_id: s.customerId, product_id: s.productId });
      this.db.prepare("DELETE FROM special_prices WHERE customer_id NOT IN (SELECT id FROM customers WHERE json_extract(doc, '$.branchId') = ?)").run(branchId);
      for (const qp of pull.quickProducts) this.upsertDoc('quick_products', qp.id, qp, { sort_order: qp.order });
      for (const qc of pull.quickCategories) this.upsertDoc('quick_categories', qc.id, qc, { sort_order: qc.order });
      for (const pp of pull.printProfiles) this.upsertDoc('print_profiles', pp.id, pp);
      for (const m of pull.motorcycleModels) this.upsertDoc('motorcycle_models', m.id, m);
      for (const c of pull.categories) this.upsertDoc('categories', c.id, c);
      for (const b of pull.brands) this.upsertDoc('brands', b.id, b);
      for (const b of pull.branches ?? []) this.upsertDoc('branches', b.id, b);
      // A shift opened from the ERP must be visible here, but never clobber one this terminal still holds locally.
      if (pull.openSession && !this.openSession()) this.upsertSession(pull.openSession);
      if (pull.salesWarehouseId !== undefined) this.setState('salesWarehouseId', pull.salesWarehouseId ?? '');
      if (pull.settings) this.upsertDoc('settings', 'app', pull.settings);
      for (const id of pull.deleted.products) {
        this.db.prepare('DELETE FROM products WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM stock_levels WHERE product_id = ?').run(id);
        this.db.prepare('DELETE FROM special_prices WHERE product_id = ?').run(id);
        this.db.prepare("DELETE FROM quick_products WHERE json_extract(doc, '$.productId') = ?").run(id);
      }
      for (const id of pull.deleted.customers) this.db.prepare('DELETE FROM customers WHERE id = ?').run(id);
      for (const id of pull.deleted.quickProducts) this.db.prepare('DELETE FROM quick_products WHERE id = ?').run(id);
      for (const id of pull.deleted.quickCategories) this.db.prepare('DELETE FROM quick_categories WHERE id = ?').run(id);
      this.setState('lastPullAt', pull.serverTime);
    });
    tx();
  }

  /** Merged with the defaults: the cached document can be older than the app that reads it. */
  settings(): AppSettings | null {
    const r = this.db.prepare("SELECT doc FROM settings WHERE id = 'app'").get() as { doc: string } | undefined;
    return r ? mergeAppSettings(JSON.parse(r.doc) as Partial<AppSettings>) : null;
  }

  private salesWarehouse(branchId: string): string | null {
    const configured = this.getState('salesWarehouseId');
    if (configured !== null) return configured || null;
    // Old caches with a single warehouse are unambiguous. Multi-warehouse caches must refresh first.
    const rows = this.db.prepare('SELECT DISTINCT warehouse_id FROM stock_levels WHERE branch_id = ?').all(branchId) as { warehouse_id: string }[];
    return rows.length === 1 ? rows[0]!.warehouse_id : null;
  }
  private availability(branchId: string): Map<string, number> {
    const rows = this.db.prepare('SELECT product_id, quantity - reserved AS q FROM stock_levels WHERE branch_id = ? AND warehouse_id = ?').all(branchId, this.salesWarehouse(branchId)) as { product_id: string; q: number }[];
    return new Map(rows.map((r) => [r.product_id, r.q]));
  }
  /** Stock, shelf and deductions all use the same checkout warehouse. */
  private locations(branchId: string): Map<string, string> {
    const rows = this.db
      .prepare('SELECT product_id, location_code, shelf, bin FROM stock_levels WHERE branch_id = ? AND warehouse_id = ?')
      .all(branchId, this.salesWarehouse(branchId)) as { product_id: string; location_code: string; shelf: string; bin: string }[];
    const map = new Map<string, string>();
    for (const r of rows) {
      if (map.has(r.product_id)) continue;
      const label = [r.location_code, r.shelf, r.bin].filter(Boolean).join(' · ');
      if (label) map.set(r.product_id, label);
    }
    return map;
  }
  private withAvail(docs: Product[], branchId: string): LocalProduct[] {
    const av = this.availability(branchId);
    const loc = this.locations(branchId);
    return docs.map((p) => ({ ...p, available: av.get(p.id) ?? 0, location: loc.get(p.id) }));
  }
  products(branchId: string): LocalProduct[] {
    return this.withAvail(this.allDocs<Product>('products', 'name_ar'), branchId);
  }
  product(id: string, branchId: string): LocalProduct | null {
    const r = this.db.prepare('SELECT doc FROM products WHERE id = ?').get(id) as { doc: string } | undefined;
    return r ? this.withAvail([JSON.parse(r.doc) as Product], branchId)[0]! : null;
  }
  lookup(term: string, branchId: string, limit = 12): { products: LocalProduct[]; legacyHit: boolean } {
    const t = term.trim();
    if (!t) return { products: [], legacyHit: false };
    const exact = this.db.prepare('SELECT doc FROM products WHERE internal_barcode = ? OR sku = ? COLLATE NOCASE LIMIT 1').get(t, t) as { doc: string } | undefined;
    if (exact) return { products: this.withAvail([JSON.parse(exact.doc) as Product], branchId), legacyHit: false };
    const legacy = this.db.prepare('SELECT doc FROM products WHERE legacy_barcode = ? LIMIT 1').get(t) as { doc: string } | undefined;
    if (legacy) return { products: this.withAvail([JSON.parse(legacy.doc) as Product], branchId), legacyHit: true };
    const like = `%${t}%`;
    const rows = this.db.prepare('SELECT doc FROM products WHERE is_active = 1 AND (name_ar LIKE ? OR name_en LIKE ? COLLATE NOCASE OR sku LIKE ? COLLATE NOCASE OR part_number LIKE ? COLLATE NOCASE OR internal_barcode LIKE ?) LIMIT ?').all(like, like, like, like, like, limit) as { doc: string }[];
    return { products: this.withAvail(rows.map((r) => JSON.parse(r.doc) as Product), branchId), legacyHit: false };
  }
  /** Use the exact warehouse selected by server checkout. */
  adjustLocalStock(productId: string, branchId: string, delta: number) {
    const warehouseId = this.salesWarehouse(branchId);
    if (!warehouseId) throw new Error('NO_WAREHOUSE');
    if (delta >= 0) {
      this.db.prepare('INSERT OR IGNORE INTO stock_levels (product_id, warehouse_id, branch_id, quantity, reserved) VALUES (?, ?, ?, 0, 0)').run(productId, warehouseId, branchId);
    }
    const changed = this.db.prepare('UPDATE stock_levels SET quantity = quantity + ? WHERE product_id = ? AND warehouse_id = ? AND branch_id = ? AND (? >= 0 OR quantity - reserved >= -?)').run(delta, productId, warehouseId, branchId, delta, delta);
    if (!changed.changes) throw new Error('INSUFFICIENT_STOCK');
  }
  stockLevels(branchId: string): StockLevel[] {
    return (this.db.prepare('SELECT * FROM stock_levels WHERE branch_id = ?').all(branchId) as { product_id: string; warehouse_id: string; branch_id: string; quantity: number; reserved: number; location_code: string; shelf: string; bin: string; updated_at: string | null }[]).map((r) => ({ productId: r.product_id, warehouseId: r.warehouse_id, branchId: r.branch_id, quantity: r.quantity, reserved: r.reserved, locationCode: r.location_code, shelf: r.shelf, bin: r.bin, updatedAt: r.updated_at ?? undefined }));
  }

  customers(): Customer[] {
    return this.allDocs<Customer>('customers');
  }
  upsertCustomer(c: Customer) {
    this.upsertDoc('customers', c.id, c, { updated_at: c.updatedAt ?? c.createdAt });
  }
  specialPrices(): SpecialPrice[] {
    return this.allDocs<SpecialPrice>('special_prices');
  }
  quickProducts(): QuickProduct[] {
    return this.allDocs<QuickProduct>('quick_products', 'sort_order');
  }
  quickCategories(): QuickCategory[] {
    return this.allDocs<QuickCategory>('quick_categories', 'sort_order');
  }
  upsertQuickProduct(q: QuickProduct) {
    this.upsertDoc('quick_products', q.id, q, { sort_order: q.order });
  }
  deleteQuickProduct(id: string) {
    this.db.prepare('DELETE FROM quick_products WHERE id = ?').run(id);
  }
  printProfiles(): PrintProfile[] {
    return this.allDocs<PrintProfile>('print_profiles').map(normalizePrintProfile);
  }
  models(): MotorcycleModel[] {
    return this.allDocs<MotorcycleModel>('motorcycle_models');
  }
  categories(): Category[] {
    return this.allDocs<Category>('categories');
  }
  brands(): Brand[] {
    return this.allDocs<Brand>('brands');
  }
  branches(): Branch[] {
    return this.allDocs<Branch>('branches');
  }

  // ---- sales / sessions ----
  returnsForSale(saleId: string): { value: SaleReturn; status: string }[] {
    return (this.db.prepare('SELECT doc, status FROM sale_returns WHERE sale_id = ? ORDER BY rowid').all(saleId) as { doc: string; status: string }[]).map(r => ({ value: JSON.parse(r.doc) as SaleReturn, status: r.status }));
  }
  insertReturn(value: SaleReturn, opId: string) {
    this.db.prepare("INSERT INTO sale_returns(id, sale_id, op_id, status, doc) VALUES(?, ?, ?, 'pending', ?)").run(value.id, value.saleId, opId, JSON.stringify(value));
  }
  insertSale(s: Sale, syncStatus: 'pending' | 'synced') {
    this.db.prepare('INSERT INTO sales(id, invoice_number, date, customer_id, total, status, sync_status, server_id, doc) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)').run(s.id, s.invoiceNumber, s.date, s.customerId, s.total, s.status, syncStatus, syncStatus === 'synced' ? s.id : null, JSON.stringify(s));
  }
  markSaleSynced(localId: string, serverId: string) {
    const r = this.db.prepare('SELECT doc FROM sales WHERE id = ?').get(localId) as { doc: string } | undefined;
    if (!r) return;
    const doc = JSON.parse(r.doc) as Sale;
    doc.syncStatus = 'synced';
    this.db.prepare("UPDATE sales SET sync_status = 'synced', server_id = ?, doc = ? WHERE id = ?").run(serverId, JSON.stringify(doc), localId);
  }
  markSaleFailed(localId: string) {
    const r = this.db.prepare('SELECT doc FROM sales WHERE id = ?').get(localId) as { doc: string } | undefined;
    if (!r) return;
    const doc = JSON.parse(r.doc) as Sale;
    doc.syncStatus = 'failed';
    this.db.prepare("UPDATE sales SET sync_status = 'failed', doc = ? WHERE id = ?").run(JSON.stringify(doc), localId);
  }
  markSalePending(localId: string) {
    const r = this.db.prepare('SELECT doc FROM sales WHERE id = ?').get(localId) as { doc: string } | undefined;
    if (!r) return;
    const doc = JSON.parse(r.doc) as Sale;
    doc.syncStatus = 'pending';
    this.db.prepare("UPDATE sales SET sync_status = 'pending', doc = ? WHERE id = ?").run(JSON.stringify(doc), localId);
  }
  /** A voided offline sale never reached the server: keep the row for audit but exclude it from totals/reprints. */
  cancelLocalSale(localId: string) {
    const r = this.db.prepare('SELECT doc FROM sales WHERE id = ?').get(localId) as { doc: string } | undefined;
    if (!r) return;
    const doc = JSON.parse(r.doc) as Sale;
    doc.status = 'cancelled';
    doc.syncStatus = 'failed';
    this.db.prepare("UPDATE sales SET status = 'cancelled', sync_status = 'failed', doc = ? WHERE id = ?").run(JSON.stringify(doc), localId);
  }
  sale(id: string): Sale | null {
    const r = this.db.prepare('SELECT doc FROM sales WHERE id = ? OR server_id = ?').get(id, id) as { doc: string } | undefined;
    return r ? (JSON.parse(r.doc) as Sale) : null;
  }
  saleByInvoice(invoiceNumber: string): Sale | null {
    const r = this.db.prepare('SELECT doc FROM sales WHERE invoice_number = ?').get(invoiceNumber.trim()) as { doc: string } | undefined;
    return r ? (JSON.parse(r.doc) as Sale) : null;
  }
  /** Replaces a cached sale in place (e.g. after a return bumped returnedQty). */
  updateSale(s: Sale) {
    this.db.prepare('UPDATE sales SET total = ?, status = ?, doc = ? WHERE id = ?').run(s.total, s.status, JSON.stringify(s), s.id);
  }
  recentSales(limit = 50): Sale[] {
    return (this.db.prepare('SELECT doc FROM sales ORDER BY date DESC LIMIT ?').all(limit) as { doc: string }[]).map((r) => JSON.parse(r.doc) as Sale);
  }
  salesHistory(branchId: string, query: Pick<ListQuery, 'page' | 'pageSize' | 'search'>): Paginated<Sale> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const search = (query.search ?? '').trim().toLocaleLowerCase();
    const from = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
      WHERE json_extract(s.doc, '$.branchId') = ?${search ? ` AND instr(search_fold(
        s.invoice_number || ' ' || coalesce(json_extract(c.doc, '$.name.ar'), '') || ' ' || coalesce(json_extract(c.doc, '$.name.en'), '') || ' ' ||
        coalesce((SELECT group_concat(coalesce(json_extract(item.value, '$.name.ar'), '') || ' ' || coalesce(json_extract(item.value, '$.name.en'), ''), ' ')
          FROM json_each(s.doc, '$.items') item), '')
      ), ?) > 0` : ''}`;
    const args = search ? [branchId, search] : [branchId];
    const total = (this.db.prepare(`SELECT count(*) AS total ${from}`).get(...args) as { total: number }).total;
    const rows = this.db.prepare(`SELECT s.doc ${from} ORDER BY s.date DESC, s.rowid DESC LIMIT ? OFFSET ?`).all(...args, pageSize, (page - 1) * pageSize) as { doc: string }[];
    return { data: rows.map(r => JSON.parse(r.doc) as Sale), total, page, pageSize };
  }
  salesForSession(sessionId: string): Sale[] {
    return (this.db.prepare("SELECT doc FROM sales WHERE json_extract(doc, '$.registerSessionId') = ?").all(sessionId) as { doc: string }[]).map((r) => JSON.parse(r.doc) as Sale);
  }
  openSession(): RegisterSession | null {
    const r = this.db.prepare("SELECT doc FROM register_sessions WHERE status = 'open' ORDER BY opened_at DESC LIMIT 1").get() as { doc: string } | undefined;
    return r ? (JSON.parse(r.doc) as RegisterSession) : null;
  }
  upsertSession(s: RegisterSession) {
    this.db.prepare('INSERT INTO register_sessions(id, status, opened_at, doc) VALUES(?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, doc = excluded.doc').run(s.id, s.status, s.openedAt, JSON.stringify(s));
  }
  /** Server adopted/created a different session id: rename locally and patch pending ops that still reference the old one. */
  remapSession(localId: string, serverId: string) {
    if (localId === serverId) return;
    const tx = this.db.transaction(() => {
      const r = this.db.prepare('SELECT doc FROM register_sessions WHERE id = ?').get(localId) as { doc: string } | undefined;
      if (r) {
        const doc = { ...(JSON.parse(r.doc) as RegisterSession), id: serverId };
        this.db.prepare('DELETE FROM register_sessions WHERE id = ?').run(localId);
        this.upsertSession(doc);
      }
      const ops = this.db.prepare("SELECT op_id, payload FROM outbox WHERE status IN ('pending','sent','rejected')").all() as { op_id: string; payload: string }[];
      const upd = this.db.prepare('UPDATE outbox SET payload = ? WHERE op_id = ?');
      for (const o of ops) {
        if (!o.payload.includes(localId)) continue;
        const p = JSON.parse(o.payload) as Record<string, unknown>;
        if (p.registerSessionId === localId) p.registerSessionId = serverId;
        if (p.sessionId === localId) p.sessionId = serverId;
        upd.run(JSON.stringify(p), o.op_id);
      }
      const sales = this.db.prepare('SELECT id, doc FROM sales WHERE doc LIKE ?').all(`%${localId}%`) as { id: string; doc: string }[];
      const updSale = this.db.prepare('UPDATE sales SET doc = ? WHERE id = ?');
      for (const s of sales) {
        const doc = JSON.parse(s.doc) as Sale;
        if (doc.registerSessionId === localId) updSale.run(JSON.stringify({ ...doc, registerSessionId: serverId }), s.id);
      }
    });
    tx();
  }
  closeLocalSession(id: string) {
    const r = this.db.prepare('SELECT doc FROM register_sessions WHERE id = ?').get(id) as { doc: string } | undefined;
    if (!r) return;
    const doc = JSON.parse(r.doc) as RegisterSession;
    if (doc.status !== 'closed') this.upsertSession({ ...doc, status: 'closed', closedAt: doc.closedAt ?? new Date().toISOString() });
  }

  // ---- outbox ----
  enqueue(op: { opId: string; type: string; payload: unknown; createdAt: string; summary: string }) {
    this.db.prepare('INSERT INTO outbox(op_id, type, payload, created_at, summary) VALUES(?, ?, ?, ?, ?)').run(op.opId, op.type, JSON.stringify(op.payload), op.createdAt, op.summary);
  }
  pendingOps(limit = 50): { opId: string; type: string; payload: unknown; createdAt: string; attempts: number }[] {
    return (this.db.prepare("SELECT op_id, type, payload, created_at, attempts FROM outbox WHERE status IN ('pending','sent') ORDER BY created_at ASC, rowid ASC LIMIT ?").all(limit) as { op_id: string; type: string; payload: string; created_at: string; attempts: number }[]).map((r) => {
      const payload = JSON.parse(r.payload) as Record<string, unknown>;
      if (r.type === 'sale_return' && typeof payload.saleId === 'string') {
        const sale = this.sale(payload.saleId);
        if (sale) {
          payload.invoiceNumber = sale.invoiceNumber;
          payload.lineIndexes = (payload.items as { saleItemId: string }[]).map(item => sale.items.findIndex(line => line.id === item.saleItemId));
        }
      }
      return { opId: r.op_id, type: r.type, payload, createdAt: r.created_at, attempts: r.attempts };
    });
  }
  markOp(opId: string, status: OutboxStatus, extra: { error?: string | null; serverId?: string | null; bumpAttempts?: boolean } = {}) {
    this.db.prepare('UPDATE sale_returns SET status = ?, server_id = COALESCE(?, server_id) WHERE op_id = ?').run(status, extra.serverId ?? null, opId);
    this.db.prepare(`UPDATE outbox SET status = ?, error = COALESCE(?, error), server_id = COALESCE(?, server_id), attempts = attempts + ? WHERE op_id = ?`).run(status, extra.error ?? null, extra.serverId ?? null, extra.bumpAttempts ? 1 : 0, opId);
    if (status === 'applied') this.db.prepare('DELETE FROM outbox WHERE op_id = ? AND status = ?').run(opId, 'applied');
  }
  setOpError(opId: string, error: string | null) {
    this.db.prepare('UPDATE outbox SET error = ? WHERE op_id = ?').run(error, opId);
  }
  counts(): { pending: number; rejected: number } {
    const r = this.db.prepare("SELECT SUM(CASE WHEN status IN ('pending','sent') THEN 1 ELSE 0 END) AS pending, SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected FROM outbox").get() as { pending: number | null; rejected: number | null };
    return { pending: r.pending ?? 0, rejected: r.rejected ?? 0 };
  }
  outbox(): OutboxRow[] {
    return (this.db.prepare('SELECT op_id, type, created_at, attempts, status, error, summary FROM outbox ORDER BY created_at DESC LIMIT 200').all() as { op_id: string; type: string; created_at: string; attempts: number; status: OutboxStatus; error: string | null; summary: string }[]).map((r) => ({ opId: r.op_id, type: r.type, createdAt: r.created_at, attempts: r.attempts, status: r.status, error: r.error, summary: r.summary }));
  }
  opPayload(opId: string): { type: string; payload: unknown } | null {
    const r = this.db.prepare('SELECT type, payload FROM outbox WHERE op_id = ?').get(opId) as { type: string; payload: string } | undefined;
    return r ? { type: r.type, payload: JSON.parse(r.payload) as unknown } : null;
  }
  deleteOp(opId: string) {
    this.db.prepare('DELETE FROM outbox WHERE op_id = ?').run(opId);
  }
  /**
   * Re-queue a rejected op under a fresh opId. The server remembers rejections by opId and would just replay
   * the stored rejection, so a retry must look like a new op (same payload / localId).
   */
  retryOp(opId: string, newOpId: string): string | null {
    const failure = this.db.prepare('SELECT error FROM outbox WHERE op_id = ?').get(opId) as { error: string | null } | undefined;
    if (failure?.error?.startsWith('SYNC_RECOVERY_REQUIRED')) throw new Error('RECONCILIATION_REQUIRED');
    const r = this.db.prepare('SELECT type, payload, created_at, summary FROM outbox WHERE op_id = ?').get(opId) as { type: string; payload: string; created_at: string; summary: string } | undefined;
    if (!r) return null;
    const tx = this.db.transaction(() => {
      this.db.prepare('DELETE FROM outbox WHERE op_id = ?').run(opId);
      this.db.prepare('INSERT INTO outbox(op_id, type, payload, created_at, summary) VALUES(?, ?, ?, ?, ?)').run(newOpId, r.type, r.payload, r.created_at, r.summary);
      this.db.prepare("UPDATE sale_returns SET op_id = ?, status = 'pending' WHERE op_id = ?").run(newOpId, opId);
      if (r.type === 'sale') {
        const localId = (JSON.parse(r.payload) as { localId?: string }).localId;
        if (localId) this.markSalePending(localId);
      }
    });
    tx();
    return newOpId;
  }

  assertCanWipe() {
    const unresolved = this.db.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status != 'applied'").get() as { n: number };
    if (unresolved.n > 0) throw new Error('UNSYNCED_OPERATIONS');
    const settlements = this.db.prepare('SELECT COUNT(*) AS n FROM rejected_settlements').get() as { n: number };
    if (settlements.n > 0) throw new Error('SETTLEMENT_ARCHIVE_REQUIRED');
  }

  wipe() {
    const tables = ['meta', 'sync_state', 'print_prefs', 'products', 'stock_levels', 'customers', 'special_prices', 'quick_products', 'quick_categories', 'print_profiles', 'motorcycle_models', 'categories', 'brands', 'settings', 'sales', 'sale_returns', 'register_sessions', 'outbox'];
    const tx = this.db.transaction(() => {
      this.assertCanWipe();
      tables.forEach((t) => this.db.exec(`DELETE FROM ${t}`));
    });
    tx();
  }
}
