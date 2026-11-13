import { writeFileSync } from 'node:fs';
import { chromium } from 'file:///C:/Users/jeepc/AppData/Local/Temp/cg-shots/node_modules/playwright-core/index.mjs';
const origin = 'http://127.0.0.1:5373';
const browser = await chromium.launch({ executablePath: 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const results = [];
const errors = [];
page.on('pageerror', error => errors.push({ route: new URL(page.url()).pathname, message: error.message }));
async function record(name, run) {
  try { await run(); results.push({ name, status: 'passed' }); }
  catch (error) { results.push({ name, status: 'failed', error: error.message }); }
  console.log(JSON.stringify(results.at(-1)));
}
await record('unauthenticated route redirects to login', async () => {
  await page.goto(`${origin}/accounting`);
  await page.waitForURL('**/login');
  await page.locator('#username').waitFor();
});
await record('Arabic RTL login and empty form validation', async () => {
  if (await page.locator('html').getAttribute('dir') !== 'rtl') throw new Error('Expected RTL');
  await page.locator('form button[type=submit]').click();
  if (await page.locator('form p.text-destructive').count() !== 2) throw new Error('Required field errors missing');
  await page.screenshot({ path: 'audit/evidence/login-arabic.png', fullPage: true });
});
await record('actual API login with isolated fixture administrator', async () => {
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('123456');
  await page.locator('form button[type=submit]').click();
  await page.waitForURL('**/dashboard');
  await page.locator('main').waitFor();
});
await page.evaluate(() => localStorage.setItem('moto-ui', JSON.stringify({ state: { locale: 'en', theme: 'light', sidebarCollapsed: false }, version: 0 })));
await page.reload();
const routes = ['/dashboard','/sales','/sales/returns','/products','/products/categories','/products/compatibility','/products/barcodes','/products/labels/designer','/inventory','/inventory/movements','/warehouses','/transfers','/purchases','/suppliers','/customers','/debts','/pricing','/cash-registers','/expenses','/users','/roles','/branches','/reports/dead-stock','/reports','/alerts','/accounting','/whatsapp','/audit-logs','/settings','/pos'];
for (const route of routes) {
  await record(`screen renders: ${route}`, async () => {
    const previousErrors = errors.length;
    await page.goto(origin + route);
    await page.locator(route === '/pos' ? 'body' : 'main').waitFor();
    await page.waitForLoadState('networkidle', { timeout: 10000 });
    const text = await page.locator('body').innerText();
    if (/Something went wrong|Unexpected Application Error|Cannot read properties|is not a function/.test(text)) throw new Error('Rendered error boundary');
    if (errors.length !== previousErrors) throw new Error(errors.at(-1).message);
    if (!text.trim()) throw new Error('Empty screen');
  });
}
await record('English LTR and mobile catalog/POS layout', async () => {
  if (await page.locator('html').getAttribute('dir') !== 'ltr') throw new Error('Expected LTR');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/products');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'audit/evidence/catalog-mobile.png', fullPage: true });
  await page.goto(origin + '/pos');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'audit/evidence/pos-mobile.png', fullPage: true });
  const sizes = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  if (sizes.content > sizes.width + 5) throw new Error(`Horizontal overflow ${sizes.content}/${sizes.width}`);
});
await record('restricted cashier cannot open financial settings', async () => {
  const login = await context.request.post(origin + '/api/auth/login', { data: { username: 'cashier1', password: '123456' } });
  const session = await login.json();
  if (!login.ok()) throw new Error('Cashier login failed');
  await page.evaluate(session => localStorage.setItem('moto-auth', JSON.stringify({ state: { session, status: 'authenticated' }, version: 0 })), session);
  await page.goto(origin + '/settings');
  await page.waitForLoadState('networkidle');
  const text = await page.locator('body').innerText();
  if (!/permission|authorized|access/i.test(text)) throw new Error('Permission rejection missing');
});
writeFileSync('audit/evidence/browser-results.json', JSON.stringify({ browser: 'Chromium', origin, results, pageErrors: errors }, null, 2));
await browser.close();
console.log(JSON.stringify({ passed: results.filter(r => r.status === 'passed').length, failed: results.filter(r => r.status === 'failed') }, null, 2));
if (results.some(r => r.status === 'failed')) process.exitCode = 1;
