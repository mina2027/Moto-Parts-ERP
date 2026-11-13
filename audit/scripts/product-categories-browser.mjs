import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../../erp-frontend/node_modules/vite/dist/node/index.js';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
process.chdir(path.join(root, 'erp-frontend'));
const evidence = path.join(root, 'audit/evidence/product-categories');
fs.mkdirSync(evidence, { recursive: true });
const harness = path.join(evidence, 'product-form.tsx');
fs.writeFileSync(harness, `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductFormDialog } from '@/features/products/ProductFormDialog';
import '@/index.css';
ReactDOM.createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ProductFormDialog open onOpenChange={() => {}} product={window.__fixture.product} /></QueryClientProvider>);
`);
const server = await createServer({
  root: path.join(root, 'erp-frontend'), configFile: path.join(root, 'erp-frontend/vite.config.ts'),
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'], alias: [
    { find: /^@moto\/ui\/(.+)$/, replacement: path.join(root, 'erp-frontend/packages/ui/src/$1') },
    ...['ui', 'shared', 'pos-core', 'api-client'].map(name => ({ find: new RegExp(`^@moto/${name}$`), replacement: path.join(root, 'erp-frontend/packages', name, 'src/index.ts') })),
  ] },
  server: { host: '127.0.0.1', port: 5383, strictPort: true, fs: { allow: [root] } },
  plugins: [{ name: 'product-categories-fixture', configureServer(vite) {
    vite.middlewares.use('/product-categories-test', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/product-categories-test', '<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/@fs/' + harness.replaceAll('\\', '/') + '"></script></body></html>'));
    });
  } }],
});
await server.listen();
const shared = await server.ssrLoadModule('/packages/shared/src/index.ts');
const fixture = {
  session: { token: 'isolated-category-fixture', user: { id: 'test-user', username: 'test', fullName: { ar: 'اختبار' }, role: 'admin', branchId: 'br1', status: 'active' }, permissions: shared.ALL_PERMISSIONS },
  product: { id: 'p1', name: { ar: 'فلتر زيت' }, internalBarcode: 'MP1', sku: 'SKU-1', partNumber: '', brandId: 'b1', categoryId: 'c1', purchasePrice: 10, lastPurchaseCost: 10, prices: { retail1: 20, retail2: 18, wholesale: 15 }, minStock: 2, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true },
  categories: [{ id: 'root', name: { ar: 'الفئات المتاحة' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true },
    ...[{ id: 'c1', ar: 'المحرك' }, { id: 'c2', ar: 'الفرامل' }, { id: 'c3', ar: 'الفلاتر' }].map(c => ({ id: c.id, name: { ar: c.ar }, parentId: 'root', ancestors: ['root'], sortOrder: 0, isActive: true }))],
};
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const writes = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(f => {
      window.__fixture = f;
      localStorage.clear();
      localStorage.setItem('moto-auth', JSON.stringify({ state: { session: f.session }, version: 0 }));
    }, fixture);
    await page.route('**/api/**', async route => {
      const pathname = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      let json = [];
      if (route.request().method() === 'PATCH' && pathname === '/products/p1') {
        const payload = route.request().postDataJSON();
        writes.push(payload);
        json = { ...fixture.product, ...payload };
      } else if (pathname === '/settings') json = shared.DEFAULT_SETTINGS;
      else if (pathname === '/catalog/categories') json = fixture.categories;
      else if (pathname === '/catalog/brands') json = [{ id: 'b1', name: { ar: 'ماركة' } }];
      else if (pathname === '/products/all') json = [fixture.product];
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(json) });
    });
    await page.goto('http://127.0.0.1:5383/product-categories-test');
    await page.getByRole('button', { name: /حذف:.*المحرك/ }).waitFor();
    await page.getByRole('combobox', { name: 'الفئات' }).click();
    await page.getByRole('button', { name: /الفرامل/ }).click();
    await page.getByRole('combobox', { name: 'الفئات' }).click();
    await page.getByRole('button', { name: /الفلاتر/ }).click();
    await page.screenshot({ path: path.join(evidence, 'selected-categories-' + width + '.png'), animations: 'disabled' });
    let saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/products/p1'));
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await saved;
    assert.deepEqual(writes[0].categoryIds, ['c1', 'c2', 'c3']);
    await page.getByRole('button', { name: /حذف:.*المحرك/ }).click();
    saved = page.waitForResponse(response => response.request().method() === 'PATCH' && response.url().includes('/products/p1'));
    await page.getByRole('button', { name: 'حفظ', exact: true }).click();
    await saved;
    assert.deepEqual(writes[1].categoryIds, ['c2', 'c3']);
    assert.equal(writes[1].categoryId, 'c2');
    assert.deepEqual(errors, []);
    results.push({ width, selected: writes[0].categoryIds, afterRemoval: writes[1].categoryIds, pageErrors: errors });
    await page.close();
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await server.close();
}
