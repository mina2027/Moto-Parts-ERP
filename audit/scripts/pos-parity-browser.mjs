// Compare the ERP terminal with the actual desktop renderer using isolated fixture data.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from '../../erp-frontend/node_modules/vite/dist/node/index.js';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';

const root = path.resolve(import.meta.dirname, '../..');
process.chdir(path.join(root, 'erp-frontend'));
const evidence = path.join(root, 'audit/evidence/pos-parity');
fs.mkdirSync(evidence, { recursive: true });
const harness = path.join(evidence, 'desktop.tsx');
fs.writeFileSync(harness, `
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@moto/ui';
import { App } from '/@fs/${root.replaceAll('\\', '/')}/pos-desktop/src/renderer/src/App.tsx';
import '/@fs/${root.replaceAll('\\', '/')}/pos-desktop/src/renderer/src/index.css';
const f = window.__fixture;
window.pos = {
  app: { pairing: async () => ({ paired: true, branchId: 'br1', terminal: { code: 'WEB' }, serverUrl: location.origin }), version: async () => '2.0.0', openCustomerDisplay: async () => {}, openDrawer: async () => {} },
  auth: { cachedSession: async () => f.session, lock: async () => {}, logout: async () => {} },
  sync: { status: async () => ({ online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null }), onStatus: (fn) => { const timer = setTimeout(() => fn({ online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null }), 20); return () => clearTimeout(timer); }, onDataChanged: () => () => {}, outbox: async () => [] },
  display: { push: () => {} },
  data: { currentSession: async () => f.shift, settings: async () => f.settings, branches: async () => f.branches,
    products: async () => f.products, product: async (id) => f.products.find(p => p.id === id), lookup: async () => ({ products: f.products, legacyHit: false }),
    customers: async () => f.customers, specialPrices: async () => [], catalogMeta: async () => f.metadata, alternatives: async () => [] }
};
ReactDOM.createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><TooltipProvider><App /></TooltipProvider></QueryClientProvider>);
`);
const server = await createServer({
  root: path.join(root, 'erp-frontend'), configFile: path.join(root, 'erp-frontend/vite.config.ts'),
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'], alias: [
    { find: /^@moto\/ui\/(.+)$/, replacement: path.join(root, 'erp-frontend/packages/ui/src/$1') },
    ...['ui', 'shared', 'pos-core', 'api-client'].map(name => ({ find: new RegExp(`^@moto/${name}$`), replacement: path.join(root, 'erp-frontend/packages', name, 'src/index.ts') })),
  ] },
  server: { host: '127.0.0.1', port: 5381, strictPort: true, fs: { allow: [root] } },
  plugins: [{ name: 'desktop-parity-fixture', configureServer(vite) {
    vite.middlewares.use('/desktop-parity', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(await vite.transformIndexHtml('/desktop-parity', '<!doctype html><html><body><div id="root"></div><script type="module" src="/@fs/' + harness.replaceAll('\\', '/') + '"></script></body></html>'));
    });
  } }],
});
await server.listen();
const shared = await server.ssrLoadModule('/packages/shared/src/index.ts');
const settings = structuredClone(shared.DEFAULT_SETTINGS);
settings.pos.idleLockMinutes = 0;
settings.pos.showTierChooserOnScan = false;
const product = { id: 'p1', name: { ar: 'تيل فرامل', en: 'Brake pads' }, internalBarcode: 'MP1', sku: 'S1', partNumber: 'P1', brandId: 'b1', categoryId: 'c1', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2, unit: { ar: 'قطعة', en: 'Piece' }, compatibleModelIds: ['m1'], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '', prices: { retail1: 100, retail2: 90, wholesale: 80 }, available: 10, saleStock: 10, branchStock: { br1: 10 }, location: 'رف 3', saleLocation: 'رف 3' };
const fixture = {
  session: { token: 'isolated-test-session', permissions: shared.ALL_PERMISSIONS, user: { id: 'u1', username: 'cashier', fullName: { ar: 'كاشير', en: 'Cashier' }, email: '', phone: '', role: 'cashier', branchId: 'br1', status: 'active', avatarColor: '#000', lastLogin: null, createdAt: '' } },
  shift: { id: 'sess1', registerId: 'r1', branchId: 'br1', userId: 'u1', openedAt: '2026-01-01T00:00:00.000Z', closedAt: null, openingBalance: 0, cashSales: 0, cardSales: 0, transferSales: 0, paymentsIn: 0, paymentsOut: 0, expenses: 0, refunds: 0, expectedCash: 0, actualCash: null, difference: null, status: 'open', movements: [] },
  settings, products: [product, { ...product, id: 'p2', internalBarcode: 'MP2', sku: 'S2', name: { ar: 'فلتر زيت', en: 'Oil filter' }, prices: { retail1: 60, retail2: 50, wholesale: 45 } }],
  branches: [{ id: 'br1', name: { ar: 'الفرع الرئيسي', en: 'Main branch' } }],
  customers: [{ id: 'c1', code: 'C1', name: { ar: 'عميل آجل', en: 'Credit customer' }, phone: '', whatsapp: '', address: { ar: '' }, type: 'retail', creditLimit: 500, balance: 0, branchId: 'br1', isActive: true, createdAt: '' }],
  metadata: { categories: [{ id: 'c1', name: { ar: 'قطع غيار', en: 'Spare parts' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true }], brands: [{ id: 'b1', name: { ar: 'ماركة 1', en: 'Brand 1' }, country: { ar: '' } }], models: [{ id: 'm1', name: { ar: 'موديل 1', en: 'Model 1' }, code: 'M1', manufacturer: '', engineCc: 125, years: '' }] },
};
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const results = [];
async function comparePixels(page, images) {
  return page.evaluate(async (sources) => {
    const decoded = await Promise.all(sources.map(src => new Promise(resolve => { const img = new Image(); img.onload = () => resolve(img); img.src = src; })));
    const pixels = decoded.map(img => { const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); return ctx.getImageData(0, 0, img.width, img.height).data; });
    let changed = 0;
    const bounds = [decoded[0].width, decoded[0].height, 0, 0];
    for (let i = 0; i < pixels[0].length; i += 4) if (pixels[0].slice(i, i + 4).some((value, j) => value !== pixels[1][i + j])) { changed++; const x = i / 4 % decoded[0].width; const y = Math.floor(i / 4 / decoded[0].width); bounds[0] = Math.min(bounds[0], x); bounds[1] = Math.min(bounds[1], y); bounds[2] = Math.max(bounds[2], x); bounds[3] = Math.max(bounds[3], y); }
    return { changedPixels: changed, bounds: changed ? bounds : null };
  }, images.map(bytes => 'data:image/png;base64,' + bytes.toString('base64')));
}
try {
  for (const locale of ['ar', 'en']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    await context.addInitScript(({ fixture, locale }) => {
      window.__fixture = fixture;
      localStorage.setItem('moto-auth', JSON.stringify({ state: { session: fixture.session }, version: 0 }));
      localStorage.setItem('moto-ui', JSON.stringify({ state: { locale, theme: 'light' }, version: 0 }));
      localStorage.setItem('locale', locale);
    }, { fixture, locale });
    const pages = await Promise.all([context.newPage(), context.newPage()]);
    const errors = [];
    for (const page of pages) { page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message)); }
    await pages[0].route('**/api/**', route => {
      const url = new URL(route.request().url());
      const responses = { '/api/settings': fixture.settings, '/api/branches': fixture.branches, '/api/products/all': fixture.products, '/api/customers/all': fixture.customers, '/api/customers/special-prices': [], '/api/cash/sessions/current': fixture.shift, '/api/catalog/categories': fixture.metadata.categories, '/api/catalog/brands': fixture.metadata.brands, '/api/catalog/models': fixture.metadata.models, '/api/products/p1': fixture.products[0], '/api/products/p2': fixture.products[1] };
      if (!(url.pathname in responses)) throw new Error('Unexpected API request: ' + url.pathname);
      return route.fulfill({ json: responses[url.pathname] });
    });
    await Promise.all([pages[0].goto('http://127.0.0.1:5381/pos'), pages[1].goto('http://127.0.0.1:5381/desktop-parity')]);
    const complete = locale === 'ar' ? 'إتمام البيع' : 'Complete sale';
    const quick = locale === 'ar' ? 'إضافة منتج سريع: تيل فرامل' : 'Add quick product: Brake pads';
    for (const page of pages) {
      await page.getByRole('button', { name: complete, exact: false }).first().waitFor();
      await page.getByRole('button', { name: quick, exact: true }).click();
      await page.locator('#pos-invoice-notes').fill('Test invoice note');
      await page.mouse.move(0, 0);
    }
    await new Promise(resolve => setTimeout(resolve, 350));
    const images = await Promise.all(pages.map((page, index) => page.screenshot({ path: path.join(evidence, `${locale}-${index === 0 ? 'erp' : 'desktop'}.png`), animations: 'disabled' })));
    results.push({ locale, state: 'cart-with-notes', ...await comparePixels(pages[0], images), errors });
    const terminals = await Promise.all(pages.map(page => page.locator('main').screenshot({ animations: 'disabled' })));
    results.push({ locale, state: 'terminal-with-notes', ...await comparePixels(pages[0], terminals), errors });
    for (const page of pages) {
      await page.getByRole('button', { name: complete, exact: false }).first().click();
      await page.getByRole('dialog').waitFor();
    }
    const payments = await Promise.all(pages.map((page, index) => page.getByRole('dialog').screenshot({ path: path.join(evidence, `${locale}-${index === 0 ? 'erp' : 'desktop'}-payment.png`), animations: 'disabled' })));
    results.push({ locale, state: 'payment-dialog', ...await comparePixels(pages[0], payments), errors });
    await pages[0].keyboard.press('Escape');
    await pages[0].locator('header').getByRole('button', { name: locale === 'ar' ? 'متصل' : 'Online', exact: true }).click();
    await pages[0].getByRole('dialog').getByText(locale === 'ar' ? 'لا توجد عمليات معلقة' : 'No queued operations', { exact: true }).waitFor();
    await pages[0].getByRole('dialog').screenshot({ path: path.join(evidence, `${locale}-erp-status.png`), animations: 'disabled' });
    await context.close();
  }
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.some(result => result.errors.length || (result.state !== 'cart-with-notes' && result.changedPixels !== 0))) process.exitCode = 1;
} finally {
  await browser.close();
  await server.close();
  fs.unlinkSync(harness);
}
