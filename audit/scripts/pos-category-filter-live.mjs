import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
const backendRequire = createRequire(path.join(root, 'erp-backend/package.json'));
const { MongoClient } = backendRequire('mongodb');
const jwt = backendRequire('jsonwebtoken');
const envPath = path.join(root, 'erp-backend/.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/moto?replicaSet=rs0&directConnection=true');
const evidence = path.join(root, 'audit/evidence/product-categories');
let browser;
try {
  await client.connect();
  const user = await client.db().collection('users').findOne({ status: 'active', role: 'admin' }, { projection: { role: 1, branchId: 1, authVersion: 1 } });
  assert(user, 'An active local admin is required for read-only diagnostics');
  const product = await client.db().collection('products').findOne({ deletedAt: null, 'categoryIds.1': { $exists: true } }, { projection: { name: 1, categoryIds: 1 } });
  assert(product, 'A saved product with multiple categories is required');
  const token = jwt.sign({ sub: user._id, role: user.role, branchId: user.branchId, typ: 'access', ver: user.authVersion ?? 0 }, process.env.JWT_SECRET || 'dev-only-secret-change-me-please-32chars', { expiresIn: '5m' });
  const response = await fetch('http://localhost:4000/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert(response.ok, 'Diagnostic session request failed');
  const session = await response.json();
  browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const modules = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (response.url().includes('catalogFilter')) modules.push({ path: new URL(response.url()).pathname, multipleCategories: (await response.text()).includes('productCategoryIds') });
  });
  await page.addInitScript(session => {
    localStorage.setItem('moto-auth', JSON.stringify({ state: { session }, version: 0 }));
  }, session);
  // Browsing only: block all business mutations, including inadvertent checkout.
  await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.goto('http://localhost:5173/pos');
  await page.waitForTimeout(2000);
  const skip = page.getByRole('button', { name: 'المتابعة بدون وردية', exact: true });
  if (await skip.count()) await skip.click();
  const categories = page.getByRole('combobox', { name: 'التصنيف', exact: true });
  await categories.waitFor();
  const results = [];
  for (const categoryId of product.categoryIds) {
    await categories.selectOption(categoryId);
    const quickProduct = page.locator('#pos-quick-products-grid').getByRole('button', { name: `إضافة منتج سريع: ${product.name.ar}`, exact: true });
    await quickProduct.waitFor();
    await page.getByRole('button', { name: 'اختر المنتج', exact: true }).click();
    const option = page.getByRole('listbox').getByRole('option', { name: new RegExp(product.name.ar) });
    await option.waitFor();
    results.push({ categoryId, quickProduct: await quickProduct.count(), chooserProduct: await option.count() });
    await page.keyboard.press('Escape');
    await page.screenshot({ path: path.join(evidence, `live-pos-${categoryId}.png`) });
  }
  assert.deepEqual(errors, []);
  // Use the running desktop renderer with a read-only snapshot of its actual SQLite cache.
  const sqlite = new DatabaseSync(path.join(process.env.APPDATA, 'moto-pos-desktop/pos.sqlite'), { readOnly: true });
  const documents = table => sqlite.prepare(`SELECT doc FROM ${table}`).all().map(row => JSON.parse(row.doc));
  const local = {
    products: documents('products').map(p => ({ ...p, available: 1 })),
    metadata: { categories: documents('categories'), brands: documents('brands'), models: documents('motorcycle_models') },
    settings: documents('settings')[0], branches: documents('branches'),
    session: { user: session.user, permissions: session.permissions },
    shift: documents('register_sessions').find(s => s.status === 'open') ?? null,
  };
  sqlite.close();
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const desktopErrors = [];
  desktop.on('pageerror', error => desktopErrors.push(error.message));
  await desktop.addInitScript(f => {
    const status = { online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null };
    window.pos = {
      app: { pairing: async () => ({ paired: true, branchId: f.session.user.branchId, terminal: { code: 'diagnostic' } }), version: async () => '2.0.1' },
      auth: { cachedSession: async () => f.session },
      sync: { status: async () => status, onStatus: () => () => {}, onDataChanged: () => () => {} },
      display: { push: () => {} },
      data: { products: async () => f.products, catalogMeta: async () => f.metadata, settings: async () => f.settings, branches: async () => f.branches, currentSession: async () => f.shift, customers: async () => [], specialPrices: async () => [] },
    };
  }, local);
  await desktop.goto('http://localhost:5174');
  await desktop.waitForTimeout(1500);
  const desktopSkip = desktop.getByRole('button', { name: 'المتابعة بدون وردية', exact: true });
  if (await desktopSkip.count()) await desktopSkip.click();
  const desktopResults = [];
  for (const categoryId of product.categoryIds) {
    await desktop.getByRole('combobox', { name: 'التصنيف', exact: true }).selectOption(categoryId);
    const quick = desktop.locator('#pos-quick-products-grid').getByRole('button', { name: `إضافة منتج سريع: ${product.name.ar}`, exact: true });
    await quick.waitFor();
    await desktop.getByRole('button', { name: 'اختر المنتج', exact: true }).click();
    const option = desktop.getByRole('listbox').getByRole('option', { name: new RegExp(product.name.ar) });
    await option.waitFor();
    desktopResults.push({ categoryId, quickProduct: await quick.count(), chooserProduct: await option.count() });
    await desktop.keyboard.press('Escape');
    await desktop.screenshot({ path: path.join(evidence, `desktop-pos-${categoryId}.png`) });
  }
  assert.deepEqual(desktopErrors, []);
  const result = { productId: product._id, web: { results, errors, modules }, desktop: { source: 'running renderer with read-only SQLite snapshot', results: desktopResults, errors: desktopErrors } };
  fs.writeFileSync(path.join(evidence, 'live-pos-filter-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (browser) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.log(JSON.stringify({ text: (await page.locator('body').innerText()).slice(0, 4500) }));
      await page.screenshot({ path: path.join(evidence, 'live-pos-filter-failure.png') });
    }
  }
  throw error;
} finally {
  await browser?.close();
  await client.close();
}
