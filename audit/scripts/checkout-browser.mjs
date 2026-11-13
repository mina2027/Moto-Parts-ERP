import { writeFileSync } from 'node:fs';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/cg-shots/node_modules/playwright-core/index.mjs';
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const origin = 'http://127.0.0.1:5373';
const cases = [];
try {
  const login = await context.request.post(origin + '/api/auth/login', { data: { username: 'admin', password: '123456' } });
  const session = await login.json();
  await page.goto(origin + '/login');
  await page.evaluate(session => {
    localStorage.setItem('moto-auth', JSON.stringify({ state: { session, status: 'authenticated' }, version: 0 }));
    localStorage.setItem('moto-ui', JSON.stringify({ state: { locale: 'en', theme: 'light', sidebarCollapsed: false }, version: 0 }));
  }, session);
  await page.goto(origin + '/pos');
  await page.waitForLoadState('networkidle');
  const lookup = await context.request.get(origin + '/api/products/prod-1', { headers: { Authorization: `Bearer ${session.token}` } });
  const product = await lookup.json();
  const search = page.getByPlaceholder(/Scan barcode/i);
  const lookupResponse = page.waitForResponse(response => response.url().includes('/products/lookup'));
  await search.fill(product.internalBarcode);
  await lookupResponse;
  await page.getByText(product.internalBarcode, { exact: false }).first().waitFor();
  await search.press('Enter');
  await page.getByRole('button', { name: /Complete sale/i }).waitFor();
  await page.screenshot({ path: 'audit/evidence/checkout-cart.png', fullPage: true });
  await page.getByRole('button', { name: /Complete sale/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/sales'));
  await dialog.getByRole('button', { name: /Complete|Confirm/i }).click();
  const response = await responsePromise;
  const sale = await response.json();
  if (response.status() !== 201 || sale.total <= 0 || sale.paid !== sale.total) throw new Error(`Checkout status ${response.status()}`);
  cases.push({ name: 'barcode scan → actual browser cash checkout → persisted invoice', status: 'passed', invoiceId: sale.id, total: sale.total });
  const stored = await context.request.get(origin + `/api/sales/${sale.id}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!stored.ok() || (await stored.json()).status !== 'completed') throw new Error('Saved invoice missing');
  const after = await context.request.get(origin + '/api/products/prod-1', { headers: { Authorization: `Bearer ${session.token}` } });
  cases.push({ name: 'read saved invoice through the API after browser checkout', status: 'passed' });
  await page.screenshot({ path: 'audit/evidence/checkout-completed.png', fullPage: true });
  console.log(JSON.stringify({ cases, productResponseStatus: after.status() }));
} catch (error) {
  cases.push({ name: 'browser checkout workflow', status: 'failed', error: error.message });
  await page.screenshot({ path: 'audit/evidence/checkout-failure.png', fullPage: true });
  console.log(JSON.stringify(cases));
  process.exitCode = 1;
} finally {
  writeFileSync('audit/evidence/browser-checkout.json', JSON.stringify(cases, null, 2));
  await browser.close();
}
