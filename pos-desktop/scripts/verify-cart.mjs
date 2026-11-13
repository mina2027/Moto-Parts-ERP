/** Verify the built invoice editor using an isolated Electron profile and synthetic data. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'release', 'cart-verification');
mkdirSync(target, { recursive: true });
const entry = `
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, ALL_PERMISSIONS } = require('./packages/shared/src/index.ts');
const { IPC } = require('./src/shared/ipc.ts');
const root = ${JSON.stringify(root)};
const target = ${JSON.stringify(target)};
app.setPath('userData', path.join(target, 'isolated-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const user = { id: 'test-user', username: 'test', fullName: { ar: 'كاشير اختبار' }, branchId: 'test-branch', role: 'cashier', status: 'active' };
const shift = { id: 'test-shift', branchId: 'test-branch', status: 'open' };
const product = { id: 'test-product', name: { ar: 'تيل فرامل أمامي' }, internalBarcode: 'MP-TEST-001', sku: 'SKU-001', partNumber: 'PART-001', size: 'CG125', location: 'رف 1 · خانة 2', brandId: '', categoryId: '', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, prices: { retail1: 100, retail2: 90, wholesale: 80 }, available: 10 };
const second = { ...product, id: 'test-filter', name: { ar: 'فلتر زيت' }, internalBarcode: 'MP-TEST-002', sku: 'SKU-002', location: 'رف 3 · خانة 1', prices: { retail1: 60, retail2: 50, wholesale: 45 }, available: 6 };
const soldOut = { ...product, id: 'test-empty', name: { ar: 'منتج نفد من المخزون' }, internalBarcode: 'MP-TEST-003', sku: 'SKU-003', available: 0 };
const sale = { id: 'test-sale', invoiceNumber: 'INV-TEST-001', date: '2026-10-27T10:00:00Z', branchId: 'test-branch', cashierId: user.id, customerId: null, registerSessionId: shift.id, items: [{ id: 'test-item', productId: product.id, name: product.name, barcode: product.internalBarcode, sku: product.sku, quantity: 1, unitPrice: 100, listPrice: 100, unitCost: 40, priceTier: 'retail1', discountPercent: 0, discount: 0, subtotal: 100, returnedQty: 0 }], subtotal: 100, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 100, paid: 100, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 100 }], type: 'cash', status: 'completed' };
const status = { online: true, syncing: false, pending: 0, rejected: 0, lastSyncAt: null };
const prefs = new Map();
let main;
const handlers = {
  [IPC.appVersion]: () => 'verification',
  [IPC.appPairing]: () => ({ paired: true, serverUrl: 'https://example.com', branchId: 'test-branch', terminal: { code: 'TEST', registerId: 'test-register' } }),
  [IPC.authCached]: () => ({ user, permissions: ALL_PERMISSIONS }),
  [IPC.syncStatus]: () => status,
  [IPC.data]: (_event, method, arg) => {
    if (method === 'settings') return { ...DEFAULT_SETTINGS, invoice: { ...DEFAULT_SETTINGS.invoice, allowNegativeStock: true, showTax: true, taxEnabled: true, taxRate: 14 }, pos: { ...DEFAULT_SETTINGS.pos, showTierChooserOnScan: false, idleLockMinutes: 0 } };
    if (method === 'currentSession') return shift;
    if (method === 'products') return [product, second, soldOut];
    if (method === 'catalogMeta') return { categories: [], brands: [], models: [] };
    if (method === 'quickGrid') throw new Error('Removed POS feature must not be requested');
    if (method === 'product') return arg === second.id ? second : product;
    if (method === 'recentSales') return [sale];
    if (method === 'sale') return sale;
    if (method === 'getPref') return prefs.get(arg) ?? null;
    if (method === 'setPref') { prefs.set(arg.key, arg.value); return; }
    return [];
  },
};
Object.entries(handlers).forEach(([channel, fn]) => ipcMain.handle(channel, fn));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(code) {
  try { return await main.webContents.executeJavaScript(code); }
  catch (error) { console.error('Failed renderer check:', code); throw error; }
}
async function until(code) {
  const end = Date.now() + 15000;
  while (Date.now() < end) { if (await evaluate(code)) return; await pause(100); }
  throw new Error('Timed out: ' + code);
}
async function click(label) {
  const code = '(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.getAttribute("aria-label") === ' + JSON.stringify(label) + ' || x.textContent.trim() === ' + JSON.stringify(label) + '); if (!b || b.disabled) return false; b.click(); return true; })()';
  assert(await evaluate(code), 'Button unavailable: ' + label);
  await pause(100);
}
async function capture(name) {
  await pause(250);
  await fs.writeFile(path.join(target, name + '.png'), (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
}
async function choose(name) {
  await until('Boolean(document.querySelector("[role=listbox]"))');
  assert(await evaluate('(() => { const b = Array.from(document.querySelectorAll("[role=option]")).find(x => x.textContent.includes(' + JSON.stringify(name) + ')); if (!b) return false; b.click(); return true; })()'));
  await until('!document.querySelector("[role=listbox]")');
}
async function qty() { return evaluate('Number(document.querySelector(".pos-catalog input[aria-label^=الكمية]").value)'); }
async function value() { return evaluate('document.querySelector(".pos-catalog tbody tr").children[3].textContent'); }
async function cart() { return evaluate('localStorage.getItem("moto-pos-desktop")'); }
async function customerType(tier) {
  await evaluate('(() => { const select = Array.from(document.querySelectorAll("select")).find(s => s.getAttribute("aria-label") === "نوع العميل"); select.value = ' + JSON.stringify(tier) + '; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
  await until('(() => { const select = Array.from(document.querySelectorAll("select")).find(s => s.getAttribute("aria-label") === "نوع العميل"); return select.value === ' + JSON.stringify(tier) + ' && !select.disabled; })()');
}
(async () => {
  try {
    await app.whenReady();
    main = new BrowserWindow({ show: false, width: 1366, height: 850, webPreferences: { preload: path.join(root, 'out/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    main.setPosition(-10000, -10000); main.showInactive();
    await main.loadFile(path.join(root, 'out/renderer/index.html'));
    await evaluate('localStorage.clear()'); await main.reload();
    await until('Boolean(document.querySelector(".pos-workspace"))');
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-cart button")).some(b => b.textContent.trim() === "نقدي") && Array.from(document.querySelectorAll(".pos-cart button")).some(b => b.textContent.trim() === "آجل")'), 'Cash and credit sale controls must be available');
    await click('آجل');
    assert(await evaluate('JSON.parse(localStorage.getItem("moto-pos-desktop")).state.saleType === "credit"'), 'Credit selection must be stored');
    await main.reload();
    await until('Boolean(document.querySelector(".pos-workspace"))');
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-cart button")).find(b => b.textContent.trim() === "آجل").getAttribute("aria-pressed") === "true"'), 'Credit selection must survive restart');
    await capture('cash-credit');
    await click('نقدي');
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-cart span")).filter(s => s.textContent === "الإجمالي").length === 1 && !document.querySelector(".pos-cart").textContent.includes("الصافي")'), 'Invoice details must show only one total');
    assert(await evaluate('Boolean(document.querySelector(".pos-product-filters input"))'), 'Top product filters must be available');
    await evaluate('(() => { const input = document.querySelector(".pos-product-filters input"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "فلتر"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await until('document.querySelectorAll(".pos-quick-grid button").length === 1');
    assert(await evaluate('document.querySelector(".pos-quick-grid button").textContent.includes("فلتر زيت")'), 'Top search must filter quick products');
    await click('مسح الفلاتر');
    assert(await evaluate('!document.querySelector(".pos-cart").textContent.includes("نوع السعر") && !document.body.innerText.includes("خصم الفاتورة") && !document.body.innerText.includes("الضريبة")'), 'Removed invoice controls must be absent even with old tax settings');
    assert(await evaluate('!document.querySelector("[role=tab]")'), 'Filter tabs must be removed');
    assert(await evaluate('!document.body.innerText.includes("تصفية المنتجات") && !document.body.innerText.includes("الأصناف السريعة")'));
    await evaluate('for (const key of ["F5", "F11"]) window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))');
    assert(await evaluate('Boolean(document.querySelector(".pos-product-lines")) && !document.querySelector("[role=dialog]")'), 'Removed shortcuts must not replace the products section');
    const productsAreRight = 'document.querySelector(".pos-catalog").getBoundingClientRect().left >= document.querySelector(".pos-cart").getBoundingClientRect().right - 1';
    assert(await evaluate(productsAreRight), 'Products must occupy the right side of the screen');
    assert(await evaluate('Math.abs(document.querySelector(".pos-catalog").getBoundingClientRect().width / document.querySelector(".pos-workspace").getBoundingClientRect().width - 0.8) < 0.01'), 'Products must retain 80 percent of the workspace');
    assert(await evaluate('!document.querySelector(".pos-cart table")'), 'Invoice details must not contain the product editor');
    await until('document.querySelectorAll(".pos-quick-grid button").length === 3');
    const quickIsSidebar = '(() => { const quick = document.querySelector(".pos-quick-products").getBoundingClientRect(); const editor = document.querySelector(".pos-product-lines").getBoundingClientRect(); return quick.left >= editor.right - 1 && Math.abs(quick.top - editor.top) < 1 && Math.abs(quick.height - editor.height) < 1; })()';
    assert(await evaluate(quickIsSidebar), 'Quick products must form a sidebar to the right of the editor');
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-quick-grid button")).every((b, i, buttons) => i === 0 || b.getBoundingClientRect().top >= buttons[i - 1].getBoundingClientRect().bottom)'), 'Quick products must form a vertical list');
    assert(await evaluate('document.querySelector(".pos-quick-products").textContent.includes("المخزون: 6") && document.querySelector(".pos-quick-products").textContent.includes("الرف: رف 3")'), 'Quick products must show stock and shelf');
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-quick-grid button")).find(b => b.getAttribute("aria-label") === "إضافة منتج سريع: منتج نفد من المخزون").disabled'), 'Zero-stock quick products must be disabled');
    await click('إضافة منتج سريع: فلتر زيت');
    assert.equal(await qty(), 1);
    assert((await value()).includes('60.00'));
    for (let i = 0; i < 5; i++) await click('إضافة منتج سريع: فلتر زيت');
    assert.equal(await qty(), 6);
    assert(await evaluate('Array.from(document.querySelectorAll(".pos-quick-grid button")).find(b => b.getAttribute("aria-label") === "إضافة منتج سريع: فلتر زيت").disabled'), 'Quick additions must stop at available stock');
    await capture('quick-products');
    const beforeFold = await cart();
    const editorWidth = await evaluate('document.querySelector(".pos-product-lines").getBoundingClientRect().width');
    await click('طيّ المنتجات السريعة');
    assert(await evaluate('document.querySelector("#pos-quick-products-grid").getBoundingClientRect().height === 0'), 'Folded quick products must free their grid space');
    assert(await evaluate('document.querySelector(".pos-product-lines").getBoundingClientRect().width > ' + editorWidth), 'Folding the quick sidebar must widen the editor');
    assert.equal(await cart(), beforeFold, 'Folding quick products must preserve the cart');
    await capture('quick-products-folded');
    await main.reload();
    await until('Array.from(document.querySelectorAll("button")).some(b => b.getAttribute("aria-label") === "إظهار المنتجات السريعة")');
    assert.equal(await qty(), 6);
    await click('إظهار المنتجات السريعة');
    await until('document.querySelector("#pos-quick-products-grid").getBoundingClientRect().height > 0');
    assert(await evaluate(quickIsSidebar), 'Restoring quick products must keep them in the right sidebar');
    await evaluate('document.querySelector(".pos-catalog tbody tr").lastElementChild.querySelector("button").click()');
    await until('!document.querySelector(".pos-catalog input[aria-label^=الكمية]")');
    const cartWidth = await evaluate('document.querySelector(".pos-cart").getBoundingClientRect().width');
    await click('طيّ المنتجات');
    await until('document.querySelector(".pos-cart").getBoundingClientRect().width > ' + (cartWidth + 200));
    await click('إظهار المنتجات');
    await until('document.querySelector(".pos-catalog").getBoundingClientRect().width > 200');
    await pause(300);
    assert(await evaluate(productsAreRight), 'Restoring products must keep them on the right');
    assert.deepEqual(await evaluate('Array.from(document.querySelectorAll(".pos-catalog th")).slice(0, 4).map(x => x.textContent)'), ['الصنف', 'الكمية', 'السعر', 'القيمة']);
    assert(await evaluate('(() => { const columns = Array.from(document.querySelectorAll(".pos-catalog th")).slice(0, 4).map(x => x.getBoundingClientRect().left); return columns.every((left, i) => i === 0 || columns[i - 1] > left); })()'), 'Arabic product columns must retain right-to-left order');
    await click('اختر المنتج');
    await until('Boolean(document.querySelector("[role=option]"))');
    assert(await evaluate('document.querySelector("[role=listbox]").textContent.includes("المخزون: 6")'));
    assert(await evaluate('document.querySelector("[role=listbox]").textContent.includes("الرف: رف 3")'));
    assert(await evaluate('Array.from(document.querySelectorAll("[role=option]")).find(o => o.textContent.includes("منتج نفد من المخزون")).disabled'), 'Zero-stock products must not be selectable');
    await capture('product-list');
    await choose('تيل فرامل أمامي');
    await until('Boolean(document.querySelector(".pos-catalog input[aria-label^=الكمية]"))');
    assert(await evaluate('!document.querySelector(".pos-catalog tbody tr").firstElementChild.textContent.includes("الباركود") && !document.querySelector(".pos-catalog tbody tr").firstElementChild.textContent.includes("كود الصنف")'), 'Barcode and SKU must not appear below the product name');
    await evaluate('(() => { const input = document.querySelector(".pos-invoice-notes textarea"); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, "يرجى الاتصال قبل التسليم"); input.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await until('JSON.parse(localStorage.getItem("moto-pos-desktop")).state.notes === "يرجى الاتصال قبل التسليم"');
    await main.reload();
    await until('Boolean(document.querySelector(".pos-catalog input[aria-label^=الكمية]"))');
    assert(await evaluate('document.querySelector(".pos-invoice-notes textarea").value === "يرجى الاتصال قبل التسليم"'), 'Invoice notes must survive restart');
    await capture('filters-and-notes');
    assert(await evaluate('!document.querySelector(".pos-catalog tbody tr").children[3].querySelector("input") && !document.querySelector(".pos-catalog tbody tr").children[3].textContent.includes("خصم")'), 'The value column must not offer discounts');
    assert(await evaluate('!document.querySelector("input[aria-label^=يدوي]")'), 'Manual price entry must be removed');
    await click('زيادة الكمية: تيل فرامل أمامي'); assert.equal(await qty(), 2);
    await click('نقص الكمية: تيل فرامل أمامي'); assert.equal(await qty(), 1);
    await click('زيادة الكمية: تيل فرامل أمامي');
    for (let i = 0; i < 8; i++) await click('زيادة الكمية: تيل فرامل أمامي');
    assert.equal(await qty(), 10);
    assert(await evaluate('Array.from(document.querySelectorAll("button")).find(b => b.getAttribute("aria-label") === "زيادة الكمية: تيل فرامل أمامي").disabled'), 'Quantity must stop at available stock');
    for (let i = 0; i < 8; i++) await click('نقص الكمية: تيل فرامل أمامي');
    await click('اختر السعر: تيل فرامل أمامي');
    await capture('price-list');
    await evaluate('Array.from(document.querySelectorAll("[role=dialog] button")).find(x => x.textContent.includes("جملة")).click()');
    await until('!document.querySelector("[role=dialog]")');
    assert((await value()).includes('160.00'));
    await capture('invoice-row');
    await click('تغيير المنتج: تيل فرامل أمامي'); await choose('فلتر زيت');
    assert.equal(await qty(), 2); assert((await value()).includes('90.00'));
    assert(await evaluate('document.querySelector(".pos-cart").textContent.includes("90.00") && !document.querySelector(".pos-cart").textContent.includes("102.60")'), 'Legacy tax settings must not change the new sale total');
    await capture('changed-product');
    assert(await evaluate('!document.querySelector(".pos-cart select")'), 'Customer price type must be above the workspace');
    await customerType('wholesale');
    await click('إضافة منتج سريع: تيل فرامل أمامي');
    assert(await evaluate('JSON.parse(localStorage.getItem("moto-pos-desktop")).state.lines.every(line => line.priceTier === "wholesale")'), 'New products must use the top customer type');
    for (const [tier, total] of [['retail2', '190.00'], ['retail1', '220.00'], ['wholesale', '170.00'], ['retail2', '190.00']]) {
      await customerType(tier);
      assert(await evaluate('JSON.parse(localStorage.getItem("moto-pos-desktop")).state.lines.every(line => line.priceTier === ' + JSON.stringify(tier) + ')'), 'Customer type must update every selected product');
      assert(await evaluate('document.querySelector(".pos-cart").textContent.includes(' + JSON.stringify(total) + ')'), 'Bulk pricing must update the invoice total');
      assert.equal(await qty(), 2);
    }
    await capture('customer-type');
    await main.reload();
    await until('Boolean(document.querySelector(".pos-catalog input[aria-label^=الكمية]"))');
    assert(await evaluate('Array.from(document.querySelectorAll("select")).find(s => s.getAttribute("aria-label") === "نوع العميل").value === "retail2"'), 'The selected customer type must survive restart');
    assert(await evaluate('JSON.parse(localStorage.getItem("moto-pos-desktop")).state.lines.every(line => line.priceTier === "retail2")'), 'Restart must preserve all selected prices');
    const beforeSales = await cart();
    assert(beforeSales, 'The cart must be persisted');
    await click('المبيعات');
    await until('Boolean(Array.from(document.querySelectorAll("[role=dialog] button")).find(x => x.textContent.trim() === "INV-TEST-001"))');
    await click('INV-TEST-001');
    assert(await evaluate('Array.from(document.querySelectorAll("[role=dialog] [aria-label]")).find(x => x.getAttribute("aria-label") === "تفاصيل الفاتورة").textContent.includes("تيل فرامل أمامي")'));
    await capture('sales-history');
    await evaluate('window.dispatchEvent(new KeyboardEvent("keydown", { key: "F4", bubbles: true }))');
    assert.equal(await cart(), beforeSales, 'Sales history must keep the active cart');
    await click('Close');
    await until('!document.querySelector("[role=dialog]")');
    assert.equal(await qty(), 2);
    main.setSize(390, 844);
    await pause(200);
    assert(await evaluate('document.querySelector(".pos-product-lines").getBoundingClientRect().height > 0'), 'Small screens must retain space for editing products');
    assert(await evaluate(quickIsSidebar), 'Quick products must remain a sidebar on mobile');
    assert(await evaluate('document.querySelector(".pos-product-lines").getBoundingClientRect().width > document.querySelector(".pos-catalog").getBoundingClientRect().width / 2'), 'The mobile editor must retain most of the products width');
    await capture('mobile-invoice');
    await click('طيّ المنتجات السريعة');
    await capture('mobile-quick-folded');
    await fs.writeFile(path.join(target, 'results.json'), JSON.stringify({ passed: true, checks: ['top product filters and search', 'cash and credit selection survives restart', 'invoice notes survive restart', 'barcode and SKU hidden below product names', 'removed shortcuts cannot open old panels', 'product editor on the right with 80 percent width', 'invoice details have no product editor', 'collapse and restore products', 'vertical quick products sidebar on the right', 'quick products stock and shelf', 'quick additions respect stock', 'independent quick folding widens the editor and persists', 'column order', 'product list stock and shelf', 'quantity arrows', 'wholesale value', 'product replacement', 'top customer type applies all tiers to all products and totals', 'new products inherit customer type', 'selected customer type survives restart', 'sales detail', 'cart persistence', 'mobile sidebar layout'] }, null, 2));
    console.log('PASS: Product filters, invoice notes, cash/credit selection, stock limits and sales history.');
    main.destroy(); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
})();
`;
const output = path.join(target, 'electron-check.cjs');
await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'verify-cart-electron.cjs' }, outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [output], { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 60000 });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
