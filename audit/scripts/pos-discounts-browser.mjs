import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createServer } from '../../erp-frontend/node_modules/vite/dist/node/index.js';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
process.chdir(path.join(root, 'erp-frontend'));
const evidence = path.join(root, 'audit/evidence/pos-discounts');
fs.mkdirSync(evidence, { recursive: true });
const harness = path.join(evidence, 'terminal.tsx');
fs.writeFileSync(harness, `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@moto/ui';
import { createPosStore, PosTerminal, cartTotals } from '@moto/pos-core';
import { saleLineDiscount } from '@moto/shared';
import '${path.join(root, 'erp-frontend/src/index.css').replaceAll('\\', '/')}';
const f = window.__fixture;
const store = createPosStore(undefined, 'discount-browser');
window.__discountStore = store;
const adapter = {
  user: f.user, permissions: f.permissions, branchId: 'br1', locale: 'ar',
  settings: async () => f.settings, catalog: async () => [f.product],
  product: async () => f.product, lookup: async () => ({ products: [], legacyHit: false }),
  customers: async () => [], specialPrices: async () => [], currentSession: async () => f.shift,
  createCustomer: async () => { throw new Error('unused'); }, lastSale: async () => null,
  alternatives: async () => [], print: async () => {}, navigate: () => {},
  connectivity: () => ({ online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null }),
  subscribeConnectivity: () => () => {},
  createSale: async input => {
    window.__discountSale = input;
    const totals = cartTotals(store.getState().lines, input.invoiceDiscount);
    return { ...input, ...totals, id: 'test-sale', invoiceNumber: 'TEST-1', date: new Date().toISOString(),
      cashierId: f.user.id, paid: totals.total, remaining: 0, change: 0, status: 'completed',
      items: input.items.map((item, index) => ({ ...item, id: 'i'+index, subtotal: item.unitPrice * item.quantity - saleLineDiscount(item), returnedQty: 0 })) };
  }
};
ReactDOM.createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><div className="h-dvh" dir="rtl"><PosTerminal adapter={adapter} store={store} printOnComplete={false} /></div></TooltipProvider></QueryClientProvider>);
`);
const server = await createServer({
  root: path.join(root, 'erp-frontend'), configFile: path.join(root, 'erp-frontend/vite.config.ts'),
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'], alias: [
    { find: /^@moto\/ui\/(.+)$/, replacement: path.join(root, 'erp-frontend/packages/ui/src/$1') },
    ...['ui', 'shared', 'pos-core', 'api-client'].map(name => ({ find: new RegExp(`^@moto/${name}$`), replacement: path.join(root, 'erp-frontend/packages', name, 'src/index.ts') })),
  ] },
  server: { host: '127.0.0.1', port: 5382, strictPort: true, fs: { allow: [root] } },
  plugins: [{ name: 'discount-fixture', configureServer(vite) {
    vite.middlewares.use('/discounts-test', async (_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(await vite.transformIndexHtml('/discounts-test', '<!doctype html><html lang="ar" dir="rtl"><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/@fs/' + harness.replaceAll('\\', '/') + '"></script></body></html>'));
    });
  } }],
});
await server.listen();
const shared = await server.ssrLoadModule('/packages/shared/src/index.ts');
const settings = structuredClone(shared.DEFAULT_SETTINGS);
settings.pos.autoPrint = false;
settings.pos.showTierChooserOnScan = false;
const product = { id: 'p1', name: { ar: 'تيل فرامل', en: 'Brake pads' }, internalBarcode: 'MP1', sku: 'S1', partNumber: 'P1', brandId: '', categoryId: '', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '', prices: { retail1: 100, retail2: 90, wholesale: 80 }, available: 10, isQuickProduct: true };
const fixture = { product, settings, permissions: shared.ALL_PERMISSIONS,
  user: { id: 'test-user', username: 'test', fullName: { ar: 'اختبار' }, role: 'admin', branchId: 'br1', status: 'active' },
  shift: { id: 'test-session', registerId: 'r1', branchId: 'br1', userId: 'test-user', status: 'open' },
};
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const results = [];
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(f => { window.__fixture = f; localStorage.clear(); }, fixture);
    await page.goto('http://127.0.0.1:5382/discounts-test');
    await page.getByRole('button', { name: 'إضافة منتج سريع: تيل فرامل' }).click();
    await page.getByRole('button', { name: 'خصم المنتج: تيل فرامل' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'مبلغ', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: 'قيمة الخصم' }).fill('15');
    await dialog.getByRole('button', { name: 'تطبيق الخصم' }).click();
    await page.getByRole('button', { name: /خصم الفاتورة/ }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: /نسبة مئوية/ }).click();
    await dialog.getByRole('spinbutton', { name: 'قيمة الخصم' }).fill('10');
    await page.screenshot({ path: path.join(evidence, 'discount-editor-' + width + '.png'), animations: 'disabled' });
    await dialog.getByRole('button', { name: 'تطبيق الخصم' }).click();
    assert.equal(await page.evaluate(() => window.__discountStore.getState().invoiceDiscount), 8.5);
    await page.getByRole('region', { name: 'تفاصيل الفاتورة' }).getByText('76.50 ج.م', { exact: true }).waitFor();
    await page.screenshot({ path: path.join(evidence, 'discount-total-' + width + '.png'), animations: 'disabled' });
    await page.getByRole('button', { name: /إتمام البيع/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /إتمام البيع/ }).click();
    await page.waitForFunction(() => Boolean(window.__discountSale));
    const input = await page.evaluate(() => window.__discountSale);
    assert.equal(input.items[0].discount, 15);
    assert.equal(input.invoiceDiscount, 8.5);
    assert.equal(input.payments[0].amount, 76.5);
    assert.deepEqual(errors, []);
    results.push({ width, itemDiscount: 15, invoiceDiscount: 8.5, payment: 76.5, pageErrors: errors });
    await page.close();
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
} finally {
  await browser.close();
  await server.close();
}
