// Fixture-only browser checks for the barcode queue and designer print paths.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';

const output = path.resolve(import.meta.dirname, '../evidence/barcode-print');
fs.mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const results = [];
try {
  for (const [widthMm, heightMm, dpi] of [[50, 25, 203], [50, 25, 300], [50, 25, 600], [40, 30, 203], [58, 40, 300]]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.routeWebSocket('**/socket.io/**', socket => socket.close());
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://localhost:5173/login');
    const { settings, template } = await page.evaluate(async ({ widthMm, heightMm, dpi }) => {
      const shared = await import('/packages/shared/src/constants.ts');
      const permissions = (await import('/packages/shared/src/permissions.ts')).ALL_PERMISSIONS;
      const settings = structuredClone(shared.DEFAULT_SETTINGS);
      settings.company.name = { ar: 'قطع غيار موتوسيكلات', en: 'MotoParts' };
      const template = { ...shared.defaultLabelTemplate(), widthMm, heightMm, dpi, elements: shared.defaultLabelElements(widthMm, heightMm) };
      const session = { token: 'isolated-label-check', permissions, user: { id: 'label-check', username: 'cashier', fullName: { ar: 'كاشير', en: 'Cashier' }, role: 'admin', branchId: 'br1', status: 'active' } };
      localStorage.setItem('moto-auth', JSON.stringify({ state: { session }, version: 0 }));
      localStorage.setItem('moto-ui', JSON.stringify({ state: { locale: 'ar', theme: 'light' }, version: 0 }));
      return { settings, template };
    }, { widthMm, heightMm, dpi });
    const product = { id: 'p1', name: { ar: 'تيل فرامل', en: 'Brake pads' }, internalBarcode: 'MP000000000001', sku: 'S1', partNumber: 'P1', brandId: 'b1', categoryId: 'c1', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '', prices: { retail1: 100, retail2: 90, wholesale: 80 }, branchStock: { br1: 10 } };
    const products = [product, { ...product, id: 'p2', name: { ar: 'فلتر زيت', en: 'Oil filter' }, internalBarcode: 'MP000000000002' }];
    await page.route('**/api/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/api/notifications') return route.fulfill({ json: [] });
      if (pathname === '/api/alerts/summary') return route.fulfill({ json: { unread: 0, critical: 0, latest: [] } });
      const responses = { '/api/settings': settings, '/api/products/all': products, '/api/inventory/levels': [], '/api/labels/templates': [template], '/api/branches': [], '/api/users/all': [], '/api/catalog/brands': [], '/api/catalog/categories': [], '/api/catalog/models': [], '/api/suppliers/all': [], '/api/warehouses/all': [], '/api/customers/all': [], '/api/expenses/categories': [], '/api/cash/registers': [], '/api/products/p1/stock': [] };
      return route.fulfill({ json: pathname in responses ? responses[pathname] : [] });
    });
    await page.goto('http://localhost:5173/products/barcodes');
    try { await page.getByRole('button', { name: 'إضافة لقائمة الطباعة', exact: true }).first().waitFor(); }
    catch (error) { console.log(JSON.stringify({ url: page.url(), errors, text: await page.locator('body').innerText() })); await page.screenshot({ path: path.join(output, 'failure.png') }); throw error; }
    const add = page.getByRole('button', { name: 'إضافة لقائمة الطباعة', exact: true });
    await add.nth(0).click(); await add.nth(0).click(); await add.nth(1).click();
    await page.getByRole('tab', { name: /طباعة الملصقات/ }).click();
    await page.evaluate(() => {
      window.print = () => {
        const source = document.querySelector('.barcode-print-document');
        const style = document.body.lastElementChild;
        // Retain the synchronous browser print snapshot for PDF inspection after cleanup.
        const copy = source.cloneNode(true); const css = style.cloneNode(true);
        document.body.append(copy, css);
        window.__labelSnapshot = { labels: copy.children.length, codes: [...copy.querySelectorAll('svg')].map(svg => svg.getAttribute('aria-label')) };
      };
    });
    await page.getByRole('button', { name: 'طباعة الآن', exact: true }).click();
    await page.waitForFunction(() => Boolean(window.__labelSnapshot));
    await page.emulateMedia({ media: 'print' });
    const snapshot = await page.evaluate(() => {
      const root = document.querySelector('.barcode-print-document');
      const label = root.firstElementChild.firstElementChild;
      const rect = label.getBoundingClientRect();
      return { ...window.__labelSnapshot, widthMm: rect.width * 25.4 / 96, heightMm: rect.height * 25.4 / 96, appHidden: getComputedStyle(document.getElementById('root')).display === 'none' };
    });
    if (snapshot.labels !== 3 || !snapshot.appHidden || Math.abs(snapshot.widthMm - widthMm) > 0.05 || Math.abs(snapshot.heightMm - heightMm) > 0.05) throw new Error('Invalid label print layout: ' + JSON.stringify(snapshot));
    const filename = `${widthMm}x${heightMm}-${dpi}`;
    await page.pdf({ path: path.join(output, `${filename}.pdf`), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
    if (widthMm === 50 && dpi === 203) await page.locator('.barcode-print-document > .label-page').first().screenshot({ path: path.join(output, 'label-preview.png') });
    results.push({ type: 'queue', widthMm, heightMm, dpi, ...snapshot, errors });
    // Verify the designer prints one label at physical size despite a zoomed editing canvas.
    if (widthMm === 50 && dpi === 203) {
      await page.emulateMedia({ media: 'screen' });
      await page.goto('http://localhost:5173/products/labels/designer');
      await page.getByRole('button', { name: 'طباعة', exact: true }).waitFor();
      await page.evaluate(() => { window.print = () => { const copy = document.querySelector('.barcode-print-document').cloneNode(true); const css = document.body.lastElementChild.cloneNode(true); document.body.append(copy, css); window.__labelSnapshot = { labels: copy.children.length }; }; });
      await page.getByRole('button', { name: 'طباعة', exact: true }).click();
      await page.waitForFunction(() => Boolean(window.__labelSnapshot));
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(output, 'designer.pdf'), preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false });
      const count = await page.evaluate(() => document.querySelector('.barcode-print-document').children.length);
      if (count !== 1) throw new Error('Designer must print one label');
      results.push({ type: 'designer', labels: count, widthMm, heightMm, dpi, errors });
    }
    await context.close();
  }
  fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
  if (results.some(result => result.errors.length)) process.exitCode = 1;
} finally { await browser.close(); }
