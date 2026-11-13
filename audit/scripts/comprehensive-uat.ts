import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Load test settings before importing application modules. No production .env is loaded.
await import('../../erp-backend/src/test/setup.ts');
const { startTestDb, stopTestDb, loginAs } = await import('../../erp-backend/src/test/harness.ts');
const models = await import('../../erp-backend/src/db/models.ts');
const { default: mongoose } = await import('../../erp-backend/node_modules/mongoose/index.js');
const { BSON } = await import('../../erp-backend/node_modules/mongodb/lib/index.js');
const { createServer } = await import('../../erp-frontend/node_modules/vite/dist/node/index.js');
const { initSocket, closeSocket } = await import('../../erp-backend/src/realtime/socket.ts');
const playwrightPath = process.env.UAT_PLAYWRIGHT_PATH ?? 'C:/Users/jeepc/AppData/Local/Temp/moto-pos-parity/node_modules/playwright-core/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightPath).href);
const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.resolve(root, process.argv[2] ?? 'audit/evidence/comprehensive-uat');
fs.mkdirSync(evidence, { recursive: true });
const results: any[] = [];
const pageErrors: any[] = [];
let server: any, vite: any, browser: any, page: any, context: any;
let origin = '', apiUrl = '', token = '';
let purchase: any, shift: any, cashSale: any, creditSale: any, wholesaleSale: any, offlineDrawer: any;
const approximate = (actual: number, expected: number, message = '') => assert.ok(Math.abs(actual - expected) < 0.005, `${message}: expected ${expected}, got ${actual}`);
const qty = async (warehouseId: string, productId = 'prod-1') => (await models.StockLevelModel.findOne({ warehouseId, productId }).lean())?.quantity ?? 0;
const field = (scope: any, label: string) => scope.locator('label').filter({ hasText: new RegExp(`^${label}(?:\\s*\\*)?$`) }).locator('..');
const mainRegister = () => page.getByText('Ataba Register 1', { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
async function select(trigger: any, option: string) { await trigger.click(); await page.getByRole('option', { name: option, exact: true }).click(); }
async function goto(route: string) { await page.goto(origin + route); await page.locator('main').waitFor(); await page.waitForLoadState('networkidle'); }
async function response(method: string, endpoint: string, action: () => Promise<void>, status = 201) {
  const pending = page.waitForResponse((r: any) => r.request().method() === method && new URL(r.url()).pathname === '/api' + endpoint);
  pending.catch(() => {});
  await action(); const r = await pending; const body = await r.json();
  assert.equal(r.status(), status, JSON.stringify(body)); return body;
}
async function request(method: string, endpoint: string, data?: unknown, key?: string) {
  const r = await context.request.fetch(origin + '/api' + endpoint, { method, data, headers: { Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) } });
  const body = await r.json(); assert.ok(r.ok(), `${method} ${endpoint}: ${r.status()} ${JSON.stringify(body)}`); return body;
}
async function check(name: string, layer: string, action: () => Promise<any>, stopOnFailure = true) {
  const startedAt = new Date().toISOString();
  try {
    const details = await action();
    const result = { name, layer, status: 'passed', startedAt, finishedAt: new Date().toISOString(), details };
    results.push(result); console.log(JSON.stringify(result));
  } catch (error: any) {
    const result = { name, layer, status: 'failed', startedAt, error: error.stack };
    results.push(result); console.log(JSON.stringify(result));
    if (page) { await page.screenshot({ path: path.join(evidence, `failure-${results.length}.png`), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(evidence, 'failure-page.txt'), await page.locator('body').innerText().catch(() => '')); }
    if (stopOnFailure) throw error;
  } finally { fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ results, pageErrors }, null, 2)); }
}
async function saleInBrowser(quantity: number, tier: number, expectedTotal: number, credit = false) {
  await goto('/pos');
  const product = await models.ProductModel.findById('prod-1').lean();
  await page.getByRole('combobox', { name: 'Customer type', exact: true }).selectOption(['retail1', 'retail2', 'wholesale'][tier - 1]);
  for (let i = 0; i < quantity; i++) {
    if (tier === 1 && i === 0) {
      const loaded = page.waitForResponse((r: any) => r.url().includes('/products/lookup')); loaded.catch(() => {});
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.type(product!.internalBarcode, { delay: 5 }); await page.keyboard.press('Enter'); await loaded;
    } else await page.getByRole('button', { name: 'Add quick product: UAT Brake Pads', exact: true }).click();
    await page.locator('tbody tr').filter({ hasText: 'UAT Brake Pads' }).first().waitFor();
  }
  if (credit) {
    await page.getByRole('button', { name: /Walk-in customer/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /UAT Customer/ }).click();
    await page.getByRole('button', { name: 'Credit', exact: true }).click();
  }
  await page.getByRole('button', { name: /Complete sale/ }).first().click();
  const dialog = page.getByRole('dialog');
  if (credit) await dialog.locator('input[type=number]').fill('50');
  const sale = await response('POST', '/sales', () => dialog.getByRole('button', { name: /Complete sale|Confirm/ }).click());
  approximate(sale.total, expectedTotal, 'sale total');
  await dialog.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(evidence, `sale-${tier}.png`), fullPage: true });
  return sale;
}
async function returnInBrowser(sale: any, quantity: number, expected: number) {
  await goto(`/sales/returns?invoice=${encodeURIComponent(sale.invoiceNumber)}`);
  const row = page.locator('tbody tr').filter({ hasText: 'UAT Brake Pads' }).first();
  await row.getByRole('checkbox').click();
  await row.locator('input[type=number]').fill(String(quantity));
  await select(row.getByRole('combobox'), 'Wrong item');
  await select(page.locator('main').getByRole('combobox').last(), 'Cash');
  await page.getByRole('button', { name: 'Complete return', exact: true }).click();
  const returned = await response('POST', '/sales/returns', () => page.getByRole('dialog').getByRole('button', { name: 'Complete return', exact: true }).click());
  approximate(returned.refundAmount, expected, 'return amount');
  return returned;
}
try {
  await check('Isolated MongoDB test database and deterministic opening balances', 'setup', async () => {
    const app = await startTestDb({ seed: true });
    assert.equal(mongoose.connection.name, 'moto-test');
    const removable = ['SaleModel', 'SaleReturnModel', 'CustomerDebtModel', 'CustomerPaymentModel', 'PurchaseModel', 'PurchaseReturnModel', 'SupplierPaymentModel', 'SupplierReimbursementModel', 'TransferModel', 'StockMovementModel', 'StockAdjustmentModel', 'StockCountModel', 'RegisterSessionModel', 'ExpenseModel', 'SpecialPriceModel', 'AlertModel', 'NotificationModel', 'IdempotencyModel', 'SyncOpModel'];
    for (const name of removable) await (models as any)[name].deleteMany({});
    await models.StockLevelModel.updateMany({}, { $set: { quantity: 0, reserved: 0 } });
    await models.CashRegisterModel.updateMany({}, { $set: { currentSessionId: null } });
    await models.CustomerModel.updateMany({}, { $set: { balance: 0 } });
    await models.SupplierModel.updateMany({}, { $set: { balance: 0 } });
    await models.ProductModel.updateMany({ _id: { $ne: 'prod-1' } }, { $set: { isActive: false } });
    await models.ProductModel.updateOne({ _id: 'prod-1' }, { $set: { name: { ar: 'تيل فرامل الاختبار', en: 'UAT Brake Pads' }, supplierId: 'sup-1', isActive: true, prices: { retail1: 100, retail2: 90, wholesale: 80 }, purchasePrice: 50, lastPurchaseCost: 50 } });
    await models.SupplierModel.updateOne({ _id: 'sup-1' }, { $set: { name: { ar: 'مورد الاختبار', en: 'UAT Supplier' } } });
    await models.CustomerModel.updateOne({ _id: 'cust-1' }, { $set: { name: { ar: 'عميل الاختبار', en: 'UAT Customer' }, type: 'retail', branchId: 'br-1', creditLimit: 10000, balance: 0 } });
    const { getSettings, updateSettingsSection } = await import('../../erp-backend/src/modules/settings/service.ts');
    const settings = await getSettings();
    const taxAttempt = await updateSettingsSection('invoice', { ...settings.invoice, taxEnabled: true, taxRate: 14, showTax: true });
    assert.equal(taxAttempt.invoice.taxEnabled, false); assert.equal(taxAttempt.invoice.taxRate, 0);
    await updateSettingsSection('pos', { ...settings.pos, idleLockMinutes: 0, showTierChooserOnScan: false });
    const auth = await loginAs(app, 'admin'); token = auth.token;
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
    apiUrl = `http://127.0.0.1:${server.address().port}`;
    process.chdir(path.join(root, 'erp-frontend'));
    vite = await createServer({ root: path.join(root, 'erp-frontend'), configFile: path.join(root, 'erp-frontend/vite.config.ts'), server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: apiUrl, changeOrigin: true }, '/socket.io': { target: apiUrl, ws: true } } } });
    await vite.listen(); origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
    const { corsOrigins } = await import('../../erp-backend/src/config/env.ts'); corsOrigins.push(origin); initSocket(server);
    browser = await chromium.launch({ executablePath: process.env.UAT_CHROME_PATH ?? 'C:/Users/jeepc/AppData/Local/ms-playwright/chromium-1248/chrome-win64/chrome.exe', headless: true });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', (e: any) => pageErrors.push({ route: new URL(page.url()).pathname, message: e.message }));
    return { database: 'moto-test', productionDatabaseAccessed: false, startingStock: 0, taxRate: 0, taxEnableRequestOverridden: true, cost: 50, prices: [100, 90, 80] };
  });
  await check('Actual Arabic login, authentication redirect, and English interface', 'browser', async () => {
    await page.goto(origin + '/accounting'); await page.waitForURL('**/login');
    assert.equal(await page.locator('html').getAttribute('dir'), 'rtl');
    await page.locator('#username').fill('admin'); await page.locator('#password').fill('123456');
    await page.locator('form button[type=submit]').click(); await page.waitForURL('**/dashboard');
    await page.screenshot({ path: path.join(evidence, 'arabic-dashboard.png'), fullPage: true });
    await page.evaluate(() => localStorage.setItem('moto-ui', JSON.stringify({ state: { locale: 'en', theme: 'light', sidebarCollapsed: false }, version: 0 })));
    await page.reload(); await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('html').getAttribute('dir'), 'ltr');
  });
  await check('Purchase 20 units at 50, pay 200, receive goods, then bank payment of 300', 'browser + database', async () => {
    await goto('/purchases'); await page.getByRole('button', { name: 'New purchase invoice', exact: true }).click();
    let dialog = page.getByRole('dialog');
    await field(dialog, 'Supplier').locator('button').first().click();
    await page.getByRole('button', { name: /UAT Supplier/ }).click();
    await field(dialog, 'Supplier invoice #').locator('input').fill('UAT-DAY-001');
    await select(field(dialog, 'Warehouse').getByRole('combobox'), 'Ataba Shop Store');
    await field(dialog, 'Add item').locator('button').first().click();
    await page.getByRole('button', { name: /UAT Brake Pads/ }).click();
    await dialog.locator('tbody input[type=number]').nth(0).fill('20');
    await dialog.locator('tbody input[type=number]').nth(1).fill('50');
    await dialog.locator('input[type=number]').last().fill('200');
    purchase = await response('POST', '/purchases', () => dialog.getByRole('button', { name: 'Create', exact: true }).click());
    approximate(purchase.total, 1000); approximate(purchase.remaining, 800); assert.equal(purchase.warehouseId, 'wh-2');
    await goto(`/purchases/${purchase.id}`); await page.getByRole('button', { name: 'Receive goods', exact: true }).click();
    dialog = page.getByRole('dialog');
    await response('POST', `/purchases/${purchase.id}/receive`, () => dialog.getByRole('button', { name: 'Confirm receipt', exact: true }).click(), 200);
    assert.equal(await qty('wh-2'), 20);
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    dialog = page.getByRole('dialog'); await dialog.locator('#amount').fill('300'); await dialog.locator('#reference').fill('UAT-BANK-300');
    await response('POST', '/purchases/payments', () => dialog.getByRole('button', { name: 'Confirm', exact: true }).click());
    approximate((await models.PurchaseModel.findById(purchase.id).lean())!.remaining, 500);
    approximate((await models.SupplierModel.findById('sup-1').lean())!.balance, 500);
    return { purchased: 20, received: 20, total: 1000, paid: 500, supplierDebt: 500 };
  });
  await check('Transfer four units to a second branch through approval, shipment and receipt', 'browser + database', async () => {
    await goto('/transfers'); await page.getByRole('button', { name: 'New transfer', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await select(field(dialog, 'Source branch').getByRole('combobox'), 'Cairo - Ataba');
    await select(field(dialog, 'Destination branch').getByRole('combobox'), 'Giza - Faisal');
    await select(field(dialog, 'Warehouse \\(Source branch\\)').getByRole('combobox'), 'Ataba Shop Store');
    await field(dialog, 'Add items').locator('button').first().click(); await page.getByRole('button', { name: /UAT Brake Pads/ }).click();
    await field(dialog, 'Add items').locator('button').last().click();
    await dialog.locator('tbody input[type=number]').fill('4');
    const transfer = await response('POST', '/transfers', () => dialog.getByRole('button', { name: 'Submit request', exact: true }).click());
    await goto(`/transfers/${transfer.id}`);
    for (const label of ['Approve', 'Confirm shipment', 'Confirm receipt', 'Complete']) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await response('POST', `/transfers/${transfer.id}/advance`, () => page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click(), 200);
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    assert.equal(await qty('wh-2'), 16); assert.equal(await qty('wh-3'), 4);
    return { sourceStock: 16, destinationStock: 4 };
  });
  await check('Blind stock count finds one missing unit and records an auditable adjustment', 'browser + database', async () => {
    await goto('/inventory?tab=counts'); await page.getByRole('button', { name: 'New count', exact: true }).click();
    const dialog = page.getByRole('dialog'); await select(dialog.locator('#warehouseId'), 'Ataba Shop Store');
    const count = await response('POST', '/inventory/counts', () => dialog.getByRole('button', { name: 'Start count', exact: true }).click());
    assert.equal(count.items.length, 1);
    await page.waitForURL(`**/inventory/counts/${count.id}`);
    await response('PATCH', `/inventory/counts/${count.id}/items`, () => page.locator('tbody input[type=number]').fill('15'), 200);
    await page.getByRole('button', { name: 'Finish count', exact: true }).click();
    await response('POST', `/inventory/counts/${count.id}/finish`, () => page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click(), 200);
    assert.equal(await qty('wh-2'), 15);
    assert.equal(await models.StockMovementModel.countDocuments({ productId: 'prod-1', type: 'count', quantity: -1 }), 1);
    return { expected: 16, counted: 15, variance: -1 };
  });
  await check('Open cash register with 1000 after the initial supplier cash payment', 'browser + database', async () => {
    await goto('/cash-registers'); await mainRegister().getByRole('button', { name: 'Open register', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.locator('input[type=number]').fill('1000');
    shift = await response('POST', '/cash/sessions', () => dialog.getByRole('button', { name: 'Open register', exact: true }).click());
    assert.equal(shift.registerId, 'reg-1'); approximate(shift.expectedCash, 1000);
  });
  await check('Cash sale: two units at retail 1 with zero tax', 'browser + database', async () => { cashSale = await saleInBrowser(2, 1, 200); approximate(cashSale.tax, 0); assert.equal(await qty('wh-2'), 13); return { total: 200, tax: 0, quantity: 2 }; });
  await check('Credit sale: two units at retail 2, cash deposit 50, debt 130', 'browser + database', async () => { creditSale = await saleInBrowser(2, 2, 180, true); approximate(creditSale.remaining, 130); assert.equal(await qty('wh-2'), 11); return { total: 180, paid: 50, remaining: 130 }; });
  await check('Customer cash collection of 100 updates the invoice, debt and drawer together', 'browser + database', async () => {
    await goto('/customers/cust-1');
    assert.doesNotMatch(await page.locator('body').innerText(), /Something went wrong|Unexpected Application Error|is not a function/);
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.locator('#amount').fill('100'); await dialog.locator('#reference').fill('UAT-COLLECT-100');
    await response('POST', '/debts/payments', () => dialog.getByRole('button', { name: 'Confirm', exact: true }).click());
    approximate((await models.CustomerModel.findById('cust-1').lean())!.balance, 30);
    approximate((await models.SaleModel.findById(creditSale.id).lean())!.remaining, 30);
    return { collected: 100, debt: 30 };
  }, false);
  if (results.at(-1).status === 'failed') await check('API collection continues the day after the customer-screen failure', 'API + database', async () => {
    await request('POST', '/debts/payments', { customerId: 'cust-1', debtId: null, amount: 100, method: 'cash', branchId: 'br-1', reference: 'UAT-COLLECT-100' }, randomUUID());
    approximate((await models.CustomerModel.findById('cust-1').lean())!.balance, 30);
    approximate((await models.SaleModel.findById(creditSale.id).lean())!.remaining, 30);
    return { collected: 100, debt: 30, browserCollectionPassed: false };
  });
  await check('Cash sale at wholesale tier with zero tax', 'browser + database', async () => { wholesaleSale = await saleInBrowser(1, 3, 80); return { total: 80, tax: 0 }; });
  await check('Actual invoice reprint flow produces 80mm and A4 documents', 'browser print preparation', async () => {
    await goto(`/sales/${cashSale.id}`);
    await page.evaluate(() => {
      (window as any).__uatPrints = [];
      window.print = () => (window as any).__uatPrints.push({ html: document.querySelector('.invoice-print-document')?.outerHTML, styles: Array.from(document.querySelectorAll('style')).map(style => style.textContent).join('\n') });
    });
    for (const size of ['small', 'large']) {
      await page.getByRole('button', { name: 'Reprint', exact: true }).click();
      const dialog = page.getByRole('dialog'); await dialog.locator(`label:has(input[value="${size}"])`).click();
      await dialog.getByRole('button', { name: 'Print', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      const capture = await page.evaluate(() => (window as any).__uatPrints.at(-1));
      assert.ok(capture?.html?.includes(cashSale.invoiceNumber));
      assert.match(capture.styles, size === 'small' ? /80mm/ : /210mm|A4/);
      fs.writeFileSync(path.join(evidence, `invoice-${size}.html`), `<!doctype html><html><head><meta charset="utf-8"><style>${capture.styles}</style></head><body>${capture.html.replace('left: -10000px;', 'left: 0px;')}</body></html>`);
    }
    return { printDocuments: 2, paperSizes: ['80mm', 'A4'], invoiceNumber: cashSale.invoiceNumber, physicalPrinterUsed: false };
  }, false);
  await check('Partial retail return and full wholesale return restore stock and refund exactly once', 'browser + database', async () => {
    const partial = await returnInBrowser(cashSale, 1, 100); const full = await returnInBrowser(wholesaleSale, 1, 80);
    assert.equal(await qty('wh-2'), 12);
    assert.equal((await models.SaleModel.findById(wholesaleSale.id).lean())!.status, 'returned');
    return { refunds: [partial.refundAmount, full.refundAmount], sourceStock: 12 };
  });
  await check('Disabled discounts reject without side effects; valid concurrent retries and reversal occur once', 'API + database', async () => {
    const input = { branchId: 'br-1', registerSessionId: shift.id, items: [{ productId: 'prod-1', name: { ar: 'تيل فرامل الاختبار', en: 'UAT Brake Pads' }, quantity: 1, unitPrice: 100, priceTier: 'retail1' }], invoiceDiscount: 0, type: 'cash', payments: [{ method: 'cash', amount: 100 }] };
    const before = await models.SaleModel.countDocuments();
    for (const [patch, errorCode] of [[{ invoiceDiscount: 10 }, 'INVOICE_DISCOUNT_DISABLED'], [{ items: [{ ...input.items[0], discount: 10 }] }, 'ITEM_DISCOUNT_DISABLED']] as const) {
      const rejected = await context.request.post(origin + '/api/sales', { data: { ...input, ...patch }, headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() } });
      const error = await rejected.json(); assert.equal(rejected.status(), 422, JSON.stringify(error)); assert.equal(error.error.code, errorCode);
    }
    assert.equal(await models.SaleModel.countDocuments(), before); assert.equal(await qty('wh-2'), 12);
    const key = randomUUID(); const invoices = await Promise.all([request('POST', '/sales', input, key), request('POST', '/sales', input, key)]);
    assert.equal(invoices[0].id, invoices[1].id); approximate(invoices[0].tax, 0); approximate(invoices[0].total, 100);
    const returned = await request('POST', '/sales/returns', { saleId: invoices[0].id, registerSessionId: shift.id, refundMethod: 'cash', items: [{ saleItemId: invoices[0].items[0].id, productId: 'prod-1', quantity: 1, unitPrice: 100, refund: 0, reason: 'wrong_item' }] }, randomUUID());
    approximate(returned.refundAmount, 100); assert.equal(await qty('wh-2'), 12);
    return { discountRejections: ['INVOICE_DISCOUNT_DISABLED', 'ITEM_DISCOUNT_DISABLED'], total: 100, tax: 0, duplicatedInvoices: 0, refund: 100 };
  });
  await check('Paid expense of 20 and cash withdrawal of 50', 'browser + database', async () => {
    await goto('/expenses'); await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    let dialog = page.getByRole('dialog'); await dialog.locator('#categoryId').click(); await page.getByRole('option').first().click();
    await dialog.locator('#amount').fill('20'); await select(dialog.locator('#registerId'), 'Ataba Register 1'); await dialog.locator('#descEn').fill('UAT day expense');
    const expense = await response('POST', '/expenses', () => dialog.getByRole('button', { name: 'Save', exact: true }).click()); assert.equal(expense.status, 'approved');
    await goto('/cash-registers'); await mainRegister().getByRole('button', { name: 'Add movement', exact: true }).click();
    dialog = page.getByRole('dialog'); await select(dialog.getByRole('combobox'), 'Withdrawal'); await dialog.locator('input[type=number]').fill('50');
    await response('POST', `/cash/sessions/${shift.id}/movements`, () => dialog.getByRole('button', { name: 'Save', exact: true }).click());
    approximate((await models.RegisterSessionModel.findById(shift.id).lean())!.expectedCash, 1180);
    return { expense: 20, withdrawal: 50, expectedCash: 1180 };
  });
  await check('Close register with independently counted 1180 and zero difference', 'browser + database', async () => {
    await goto('/cash-registers'); await mainRegister().getByRole('button', { name: 'Close register', exact: true }).click();
    const dialog = page.getByRole('dialog'); await field(dialog, 'Actual cash \\(Optional\\)').locator('input[type=number]').fill('1180');
    const closed = await response('POST', `/cash/sessions/${shift.id}/close`, () => dialog.getByRole('button', { name: 'Confirm register close', exact: true }).click(), 200);
    approximate(closed.actualCash, 1180); approximate(closed.expectedCash, 1180); approximate(closed.difference, 0); assert.equal(closed.status, 'closed');
    return { expectedCash: 1180, actualCash: 1180, difference: 0 };
  });
  await check('Accounting, customer and supplier statements match the independent day ledger', 'browser + API + database', async () => {
    const from = new Date(Date.now() - 86400000).toISOString(), to = new Date(Date.now() + 86400000).toISOString();
    const accounting = await request('GET', `/reports/accounting?branchId=br-1&from=${from}&to=${to}`);
    const expected = { totalSales: 560, returns: 280, netSales: 280, tax: 0, cogs: 150, grossProfit: 130, expenses: 20, netProfit: 110, receivables: 30, payables: 500 };
    for (const [key, value] of Object.entries(expected)) approximate(accounting[key], value, key);
    approximate((await request('GET', '/customers/cust-1/statement'))[0].balance, 30);
    approximate((await request('GET', '/suppliers/sup-1/statement'))[0].balance, 500);
    await goto('/accounting'); await page.screenshot({ path: path.join(evidence, 'accounting.png'), fullPage: true });
    assert.equal(await qty('wh-2'), 12); assert.equal(await qty('wh-3'), 4);
    return { expected, observed: Object.fromEntries(Object.keys(expected).map(key => [key, accounting[key]])), stock: { source: 12, destination: 4 } };
  });
  await check('Two real SQLite terminals: offline persistence, lost response, conflict, return and retry', 'real desktop storage + real API', async () => {
    const { LocalDb } = await import('../../pos-desktop/src/main/db/database.ts');
    const { SyncWorker } = await import('../../pos-desktop/src/main/sync/worker.ts');
    const { createLocalOps } = await import('../../pos-desktop/src/main/sync/localOps.ts');
    const { createApiClient } = await import('../../pos-desktop/packages/api-client/src/client.ts');
    const { SaleCreateSchema } = await import('../../erp-backend/packages/shared/src/index.ts');
    await models.ProductModel.updateOne({ _id: 'prod-2' }, { $set: { isActive: true, prices: { retail1: 100, retail2: 90, wholesale: 80 } } });
    await models.StockLevelModel.updateOne({ productId: 'prod-2', warehouseId: 'wh-3' }, { $set: { quantity: 1, reserved: 0 } });
    const drawer = await request('POST', '/cash/sessions', { registerId: 'reg-4', openingBalance: 1000 }); offlineDrawer = drawer;
    const folder = mkdtempSync(path.join(tmpdir(), 'moto-comprehensive-uat-'));
    const nativeBinding = path.join(root, 'pos-desktop/native/better_sqlite3.node');
    const adminApi = createApiClient({ baseUrl: apiUrl + '/api', getToken: () => token });
    let online = true, loseResponse = false; const statuses: string[] = [];
    const terminals = await Promise.all(['A', 'B'].map(name => adminApi.sync.registerTerminal({ name: `UAT-${name}`, branchId: 'br-2', registerId: 'reg-4', appVersion: 'uat' })));
    const devices = terminals.map((terminal: any, index: number) => {
      const file = path.join(folder, `${index}.sqlite`); let db = new LocalDb(file, { nativeBinding });
      const client = createApiClient({ baseUrl: apiUrl + '/api', getToken: () => token, headers: { 'X-Terminal-Id': terminal.id }, fetchImpl: async (input, init) => {
        if (!online) throw new Error('UAT network disconnected'); const r = await fetch(input, init);
        if (String(input).endsWith('/sync/push')) { const payload = await r.clone().json() as any; statuses.push(...payload.results.map((item: any) => item.status)); if (loseResponse) { loseResponse = false; throw new Error('UAT response lost after commit'); } }
        return r;
      } });
      const newWorker = () => new SyncWorker({ db, api: () => client, terminalId: () => terminal.id, branchId: () => 'br-2', setTimer: () => null, clearTimer: () => undefined });
      let worker = newWorker();
      return { get db() { return db; }, get worker() { return worker; }, client,
        ops: () => createLocalOps({ db, worker, terminalCode: () => terminal.code, terminalId: () => terminal.id, branchId: () => 'br-2', userId: () => 'usr-1', publicUrl: () => origin }),
        restart() { worker.stop(); db.close(); db = new LocalDb(file, { nativeBinding }); worker = newWorker(); }, close() { worker.stop(); db.close(); } };
    });
    const [a, b] = devices;
    try {
      await a.worker.bootstrap(a.client, 'br-2'); await b.worker.bootstrap(b.client, 'br-2'); online = false;
      const input = SaleCreateSchema.parse({ branchId: 'br-2', registerSessionId: drawer.id, items: [{ productId: 'prod-2', quantity: 1, unitPrice: 100, priceTier: 'retail1', name: { ar: 'اختبار أوفلاين' } }], type: 'cash', payments: [{ method: 'cash', amount: 100 }] });
      const sa = await a.ops().createSale(input), sb = await b.ops().createSale(input);
      a.restart(); b.restart(); assert.equal(a.db.counts().pending, 1); assert.equal(b.db.counts().pending, 1);
      online = true; loseResponse = true; await a.worker.syncNow(); assert.equal(a.db.counts().pending, 1);
      a.restart(); await a.worker.syncNow(); assert.equal(a.db.counts().pending, 0); assert.ok(statuses.includes('duplicate'));
      assert.equal(await models.SaleModel.countDocuments({ invoiceNumber: sa.invoiceNumber }), 1);
      await b.worker.syncNow(); assert.equal(b.db.counts().rejected, 1); assert.equal(await models.SaleModel.countDocuments({ invoiceNumber: sb.invoiceNumber }), 0);
      await assert.rejects(() => b.ops().createSaleReturn({ saleId: sb.id, refundMethod: 'cash', items: [{ saleItemId: sb.items[0].id, productId: 'prod-2', quantity: 1, unitPrice: 100, refund: 0, reason: 'wrong_item' }] }), /RECONCILIATION_REQUIRED/);
      online = false; await a.ops().createSaleReturn({ saleId: sa.id, refundMethod: 'cash', items: [{ saleItemId: sa.items[0].id, productId: 'prod-2', quantity: 1, unitPrice: 100, refund: 0, reason: 'wrong_item' }] });
      a.restart(); online = true; loseResponse = true; await a.worker.syncNow(); a.restart(); await a.worker.syncNow();
      const stored = await models.SaleModel.findOne({ invoiceNumber: sa.invoiceNumber }).lean(); assert.equal(await models.SaleReturnModel.countDocuments({ saleId: stored!._id }), 1);
      const failed = b.db.outbox().find((op: any) => op.status === 'rejected')!; b.db.retryOp(failed.opId, randomUUID()); b.restart(); await b.worker.syncNow();
      assert.deepEqual(b.db.counts(), { pending: 0, rejected: 0 }); assert.equal(await qty('wh-3', 'prod-2'), 0);
      approximate((await models.RegisterSessionModel.findById(drawer.id).lean())!.expectedCash, 1100);
      assert.equal(await models.SaleModel.countDocuments({ invoiceNumber: sb.invoiceNumber }), 1);
      return { terminals: 2, lostResponses: 2, duplicatesPrevented: true, conflictVisible: true, finalStock: 0, expectedDrawer: 1100, queuedOperations: 0 };
    } finally { devices.forEach(device => device.close()); }
  });
  await check('Cashier permissions and foreign-branch access rejected through UI and API', 'browser + API', async () => {
    const login = await context.request.post(origin + '/api/auth/login', { data: { username: 'cashier1', password: '123456' } }); const session = await login.json(); assert.ok(login.ok());
    const forbidden = await context.request.get(origin + '/api/reports/accounting', { headers: { Authorization: `Bearer ${session.token}` } }); assert.equal(forbidden.status(), 403);
    const foreign = await context.request.get(origin + '/api/cash/sessions/' + offlineDrawer.id, { headers: { Authorization: `Bearer ${session.token}` } }); assert.equal(foreign.status(), 403);
    await page.evaluate((session: any) => localStorage.setItem('moto-auth', JSON.stringify({ state: { session, status: 'authenticated' }, version: 0 })), session);
    await goto('/settings'); assert.match(await page.locator('body').innerText(), /permission|authorized|access/i);
    const adminLogin = await context.request.post(origin + '/api/auth/login', { data: { username: 'admin', password: '123456' } }); const adminSession = await adminLogin.json();
    await page.evaluate((session: any) => localStorage.setItem('moto-auth', JSON.stringify({ state: { session, status: 'authenticated' }, version: 0 })), adminSession);
    return { financialReportStatus: 403, foreignBranchStatus: 403 };
  });
  await check('Every ERP screen renders with live API data and no browser exception', 'browser', async () => {
    const routes = ['/dashboard', '/sales', '/sales/returns', '/products', '/products/categories', '/products/compatibility', '/products/barcodes', '/products/labels/designer', '/inventory', '/inventory/movements', '/warehouses', '/transfers', '/purchases', '/suppliers', '/suppliers/sup-1', '/customers', '/customers/cust-1', '/debts', '/pricing', '/cash-registers', '/expenses', '/users', '/roles', '/branches', '/reports/dead-stock', '/reports', '/alerts', '/accounting', '/whatsapp', '/audit-logs', '/settings', '/pos'];
    const screenResults = [];
    for (const route of routes) {
      await goto(route); const text = await page.locator('body').innerText();
      const failed = /Something went wrong|Unexpected Application Error|Cannot read properties|is not a function/.test(text);
      screenResults.push({ route, status: failed ? 'failed' : 'passed', ...(failed ? { error: text } : {}) });
      if (failed) await page.screenshot({ path: path.join(evidence, `screen-${route.replaceAll('/', '-')}.png`), fullPage: true });
    }
    fs.writeFileSync(path.join(evidence, 'screens.json'), JSON.stringify(screenResults, null, 2));
    assert.equal(screenResults.filter(screen => screen.status === 'failed').length, 0, JSON.stringify(screenResults.filter(screen => screen.status === 'failed')));
    assert.deepEqual(pageErrors, []); return { screens: routes.length, pageErrors: 0 };
  }, false);
  await check('File backup and restore of the completed day preserve all records and indexes', 'MongoDB BSON backup + restored database', async () => {
    const source = mongoose.connection.db!; assert.equal(source.databaseName, 'moto-test');
    const archive = [];
    for (const collection of await source.listCollections().toArray()) archive.push({ name: collection.name, rows: await source.collection(collection.name).find().sort({ _id: 1 }).toArray(), indexes: await source.collection(collection.name).listIndexes().toArray() });
    const file = path.join(evidence, 'completed-day-backup.bson'); fs.writeFileSync(file, BSON.serialize({ collections: archive }));
    const destination = mongoose.connection.getClient().db(`moto-uat-restore-${randomUUID()}`);
    const hash = (rows: any[]) => createHash('sha256').update(BSON.serialize({ rows })).digest('hex');
    try {
      const restored = BSON.deserialize(fs.readFileSync(file)).collections;
      for (const collection of restored) {
        await destination.createCollection(collection.name); if (collection.rows.length) await destination.collection(collection.name).insertMany(collection.rows);
        for (const index of collection.indexes) if (index.name !== '_id_') { const { v, ns, key, ...options } = index; void v; void ns; await destination.collection(collection.name).createIndex(key, options); }
        assert.equal(hash(await destination.collection(collection.name).find().sort({ _id: 1 }).toArray()), hash(collection.rows), collection.name);
        assert.deepEqual((await destination.collection(collection.name).listIndexes().toArray()).map((index: any) => ({ key: index.key, unique: Boolean(index.unique) })), collection.indexes.map((index: any) => ({ key: index.key, unique: Boolean(index.unique) })));
      }
      const restoredShift = await destination.collection(models.RegisterSessionModel.collection.name).findOne({ _id: shift.id }); approximate(restoredShift!.actualCash, 1180);
      return { collections: restored.length, documentAndIndexEquality: true, completedDayCash: 1180, backup: path.basename(file), method: 'Logical BSON file restore; production Docker mongodump pipeline is not exercised.' };
    } finally { await destination.dropDatabase(); }
  });
} catch (error: any) { console.error(error.message); process.exitCode = 1; }
finally {
  if (results.some(result => result.status === 'failed')) process.exitCode = 1;
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify({ results, pageErrors, limitations: ['Physical printer and cash drawer were not operated.', 'Offline desktop operations use the real LocalDb and SyncWorker without driving Electron windows.', 'Current policy disables taxes and discounts; rejection and zero-tax behavior are verified.', 'Backup uses a BSON file and separate restore database rather than the production Docker backup pipeline.'] }, null, 2));
  await browser?.close(); await vite?.close(); await closeSocket();
  if (server) await new Promise<void>(resolve => { server.close(resolve); server.closeAllConnections?.(); });
  await stopTestDb();
  console.log(JSON.stringify({ passed: results.filter(result => result.status === 'passed').length, failed: results.filter(result => result.status === 'failed').length, evidence }));
}
