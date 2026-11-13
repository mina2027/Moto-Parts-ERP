export const SCHEMA_VERSION = 5;

/** Stepwise migrations keyed by the version they upgrade *to*; run in order after SCHEMA_SQL. */
export const MIGRATIONS: Record<number, string[]> = {
  // Shelf location so the cashier can find the part without going online.
  2: [
    `ALTER TABLE stock_levels ADD COLUMN location_code TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE stock_levels ADD COLUMN shelf TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE stock_levels ADD COLUMN bin TEXT NOT NULL DEFAULT ''`,
  ],
  // Branch names, so stock in other branches is never shown as a raw id.
  3: [`CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, doc TEXT NOT NULL)`],
  4: [`CREATE TABLE IF NOT EXISTS sale_returns (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, op_id TEXT UNIQUE, status TEXT NOT NULL, server_id TEXT, doc TEXT NOT NULL)`, `CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_server ON sale_returns(server_id) WHERE server_id IS NOT NULL`],
  5: [`CREATE TABLE IF NOT EXISTS rejected_settlements (op_id TEXT PRIMARY KEY, sale_id TEXT NOT NULL, doc TEXT NOT NULL)`],
};

/** JSON-document tables keep the local model identical to the server model; indexed columns are extracted. */
export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS print_prefs (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  internal_barcode TEXT NOT NULL,
  legacy_barcode TEXT,
  sku TEXT NOT NULL,
  part_number TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  category_id TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(internal_barcode);
CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_legacy ON products(legacy_barcode);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name_ar);

CREATE TABLE IF NOT EXISTS stock_levels (
  product_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  reserved REAL NOT NULL DEFAULT 0,
  location_code TEXT NOT NULL DEFAULT '',
  shelf TEXT NOT NULL DEFAULT '',
  bin TEXT NOT NULL DEFAULT '',
  updated_at TEXT,
  PRIMARY KEY (product_id, warehouse_id)
);

CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, updated_at TEXT, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS special_prices (id TEXT PRIMARY KEY, customer_id TEXT, product_id TEXT, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quick_products (id TEXT PRIMARY KEY, sort_order INTEGER, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS quick_categories (id TEXT PRIMARY KEY, sort_order INTEGER, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS print_profiles (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS motorcycle_models (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS brands (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS branches (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, doc TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  customer_id TEXT,
  total REAL NOT NULL,
  status TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  server_id TEXT,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(date);

CREATE TABLE IF NOT EXISTS register_sessions (id TEXT PRIMARY KEY, status TEXT NOT NULL, opened_at TEXT NOT NULL, doc TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS outbox (
  op_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  server_id TEXT,
  summary TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);
`;
