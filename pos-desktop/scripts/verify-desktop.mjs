/** Exercise the production renderer and Electron PDF printing with isolated, synthetic sales. */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.env.POS_VERIFICATION_OUTPUT ? path.resolve(process.env.POS_VERIFICATION_OUTPUT) : path.join(root, 'release', 'verification');
mkdirSync(target, { recursive: true });
const entry = `
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { DEFAULT_SETTINGS, ALL_PERMISSIONS, defaultPrintProfiles } = require('./packages/shared/src/index.ts');
const { IPC } = require('./src/shared/ipc.ts');
const { loadPrintDocument, listPrinters, printHtml } = require('./src/main/printing.ts');
const root = ${JSON.stringify(root)};
const target = ${JSON.stringify(target)};
app.setPath('userData', path.join(target, 'isolated-profile'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});
const user = { id: 'test-user', username: 'test', fullName: { ar: 'كاشير اختبار' }, branchId: 'test-branch', role: 'cashier', status: 'active' };
const session = { id: 'test-shift', status: 'open' };
const product = { id: 'test-product', name: { ar: 'تيل فرامل أمامي للاختبار' }, internalBarcode: 'MP-TEST-001', sku: 'SKU-TEST', partNumber: 'PART-TEST', size: 'CG125', location: 'رف 1 · خانة 2', brandId: '', categoryId: '', supplierId: '', purchasePrice: 40, lastPurchaseCost: 40, minStock: 2, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, prices: { retail1: 100, retail2: 90, wholesale: 80 }, available: 10 };
const sale = { id: 'test-sale', invoiceNumber: 'INV-TEST-001', date: '2026-10-11T10:00:00Z', branchId: 'test-branch', cashierId: user.id, customerId: null, registerSessionId: session.id, items: [{ productId: product.id, name: product.name, barcode: product.internalBarcode, sku: product.sku, partNumber: product.partNumber, quantity: 1, unitPrice: 100, listPrice: 100, priceTier: 'retail1', discountPercent: 0, discount: 0 }], subtotal: 100, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 100, paid: 100, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 100 }], type: 'cash', status: 'completed' };
const status = { online: true, syncing: false, pending: 0, rejected: 0, unregistered: false, lastSyncAt: null };
const prefs = new Map();
// Old local selections must not skip the system dialog or change the new receipt size.
prefs.set('invoicePrinter:small', 'Disconnected');
prefs.set('invoicePaper:small', 'thermal58');
const jobs = [];
const savedSales = new Map();
let createCount = 0;
let failNext = false;
let cancelNext = false;
let main;
const handlers = {
  [IPC.appVersion]: () => 'verification',
  [IPC.appPairing]: () => ({ paired: true, serverUrl: 'https://example.com', branchId: 'test-branch', terminal: { code: 'TEST', registerId: 'test-register' } }),
  [IPC.authCached]: () => ({ user, permissions: ALL_PERMISSIONS }),
  [IPC.syncStatus]: () => status,
  [IPC.appPrinters]: async () => [...await listPrinters(main), { name: 'TEST-RECEIPT', displayName: 'TEST-RECEIPT', isDefault: false, virtual: false }],
  [IPC.appPrintHtml]: async (_e, job) => {
    assert.equal(job.mode, 'printer');
    assert.equal(job.silent, false, 'Checkout must open the Windows printer dialog');
    assert.equal(job.printerName, null, 'Windows handles printer selection');
    if (failNext) { failNext = false; throw new Error('TEST: Printer disconnected'); }
    if (cancelNext) { cancelNext = false; return { status: 'cancelled' }; }
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    try {
      const { heightMm } = await loadPrintDocument(win, job);
      const content = await win.webContents.executeJavaScript('document.body.innerText');
      const saved = [...savedSales.values()].find((s) => content.includes(s.invoiceNumber));
      assert(saved, 'Print must refer to an already saved sale');
      assert(content.includes(product.name.ar));
      const label = job.widthMm === 210 ? 'invoice-a4' : job.widthMm === 148 ? 'invoice-a5' : 'invoice-' + job.widthMm + 'mm';
      const filePath = path.join(target, label + '.pdf');
      // Exercise the actual production PDF path; the native save picker is replaced only in this test.
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
      const outcome = await printHtml({ ...job, mode: 'pdf' }, main);
      assert.equal(outcome.status, 'saved');
      const pdf = await fs.readFile(filePath);
      const raw = pdf.toString('latin1');
      const pages = (raw.match(/\\/Type\\s*\\/Page\\b/g) || []).length;
      assert.equal(pages, 1, 'Each sample invoice must use one page');
      assert(pdf.length > 10000, 'PDF must contain the rendered invoice');
      await fs.writeFile(path.join(target, label + '.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
      jobs.push({ widthMm: job.widthMm, heightMm, pages, bytes: pdf.length, invoice: saved.invoiceNumber, destination: job.mode, silent: job.silent });
      return { status: 'saved' };
    } finally { win.destroy(); }
  },
  [IPC.data]: (_e, method, arg) => {
    if (method === 'settings') return { ...DEFAULT_SETTINGS, pos: { ...DEFAULT_SETTINGS.pos, autoPrint: true, openDrawerOnSale: false, showTierChooserOnScan: false, idleLockMinutes: 0 } };
    // Reproduce a still-running older main process sending all five server templates.
    if (method === 'printProfiles') return defaultPrintProfiles();
    if (method === 'currentSession') return session;
    if (method === 'products') return [product];
    if (method === 'quickGrid') return { products: [{ id: 'q1', productId: product.id, categoryId: null, order: 0 }], categories: [] };
    if (method === 'lookup') return { products: [product], legacyHit: false };
    if (method === 'product') return product;
    if (method === 'sale') return savedSales.get(arg) ?? null;
    if (method === 'createSale') {
      createCount++;
      const saved = { ...sale, id: 'test-sale-' + createCount, invoiceNumber: 'INV-TEST-00' + createCount };
      savedSales.set(saved.id, saved);
      return saved;
    }
    if (method === 'getPref') return prefs.get(arg) ?? null;
    if (method === 'setPref') { prefs.set(arg.key, arg.value); return; }
    if (method === 'catalogMeta') return { categories: [], brands: [], models: [] };
    return [];
  },
};
Object.entries(handlers).forEach(([channel, fn]) => ipcMain.handle(channel, fn));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(code) { try { return await main.webContents.executeJavaScript(code); } catch (error) { console.error('Failed renderer check:', code); throw error; } }
async function until(fn, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await pause(100); } throw new Error('Timed out waiting for renderer'); }
async function click(label) { assert(await evaluate('(() => { const b = Array.from(document.querySelectorAll("button")).find(x => x.textContent.trim() === ' + JSON.stringify(label) + ' || x.getAttribute("aria-label") === ' + JSON.stringify(label) + '); if (!b || b.disabled) return false; b.click(); return true; })()'), 'Button unavailable: ' + label); }
async function startCheckout(size) {
  await evaluate('Array.from(document.querySelectorAll(".pos-catalog button")).find(x => x.textContent.includes("تيل فرامل أمامي للاختبار")).click()');
  await until(() => evaluate('document.querySelector(".pos-cart").innerText.includes("PART-TEST")'));
  await evaluate('Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("إتمام البيع") && x.textContent.includes("F9")).click()');
  await until(() => evaluate('Boolean(document.querySelector("[role=dialog] input[name=invoice-size]"))'));
  await evaluate('document.querySelector("input[name=invoice-size][value=' + size + ']").click()');
}
async function confirmCheckout() {
  await evaluate('Array.from(document.querySelectorAll("[role=dialog] button")).find(x => x.textContent.includes("تأكيد البيع والطباعة")).click()');
}
(async () => {
  try {
    await app.whenReady();
    main = new BrowserWindow({ show: false, width: 1366, height: 800, webPreferences: { preload: path.join(root, 'out/preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
    main.setPosition(-10000, -10000);
    main.showInactive();
    main.webContents.on('console-message', (_e, level, message) => { if (level >= 3) console.error('Renderer:', message); });
    await main.loadFile(path.join(root, 'out/renderer/index.html'));
    await evaluate('localStorage.clear()');
    await main.reload();
    await until(() => evaluate('Boolean(document.querySelector(".pos-workspace"))'));
    // Hidden windows do not advance CSS animation frames; verify the settled geometry.
    await evaluate('(() => { const s = document.createElement("style"); s.textContent = ".pos-workspace, .pos-catalog { transition: none !important; }"; document.head.appendChild(s); })()');
    const printers = await listPrinters(main);
    console.log('Installed printers:', printers.map(p => p.name).join(', '));
    const widthBefore = await evaluate('document.querySelector(".pos-cart").getBoundingClientRect().width');
    await click('طيّ المنتجات'); await pause(350);
    const widthAfter = await evaluate('document.querySelector(".pos-cart").getBoundingClientRect().width');
    assert(widthAfter > widthBefore + 200, 'Cart must occupy collapsed product space');
    assert(await evaluate('getComputedStyle(document.querySelector(".pos-catalog")).visibility === "hidden"'));
    await click('إظهار المنتجات'); await pause(350);
    await click('تكبير الخط');
    await until(() => evaluate('document.documentElement.style.fontSize === "16.8px"'));
    assert.equal(await evaluate('localStorage.getItem("pos.fontSize")'), '105');
    await evaluate('(() => { const slider = document.querySelector("input[type=range]"); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(slider, "140"); slider.dispatchEvent(new Event("input", { bubbles: true })); })()');
    await until(() => evaluate('document.documentElement.style.fontSize === "22.4px"'));
    await click('طيّ المنتجات'); await pause(350);
    assert(await evaluate('document.querySelector(".pos-cart").getBoundingClientRect().width > 1000'));
    await fs.writeFile(path.join(target, 'cart-large-font.png'), (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await click('حجم الخط الافتراضي');
    await click('إظهار المنتجات'); await pause(350);
    assert(await evaluate('document.querySelector(".pos-catalog").innerText.includes("PART-TEST")'));
    await evaluate('Array.from(document.querySelectorAll(".pos-catalog button")).find(x => x.textContent.includes("تيل فرامل أمامي للاختبار")).click()');
    await until(() => evaluate('document.querySelector(".pos-cart").innerText.includes("PART-TEST")'));
    await pause(150);
    await fs.writeFile(path.join(target, 'products-and-cart.png'), (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    assert(await evaluate('!Array.from(document.querySelectorAll("button")).some(x => x.getAttribute("aria-label") === "إعدادات الطباعة")'));
    assert(await evaluate('!Array.from(document.querySelectorAll(".pos-cart button")).some(x => x.textContent.includes("طباعة"))'));
    await evaluate('Array.from(document.querySelectorAll("button")).find(x => x.textContent.includes("إتمام البيع") && x.textContent.includes("F9")).click()');
    await until(() => evaluate('Boolean(document.querySelector("[role=dialog] input[name=invoice-size]"))'));
    assert(await evaluate('document.querySelector("input[name=invoice-size][value=small]").checked'));
    await pause(200);
    await fs.writeFile(path.join(target, 'checkout-invoice-size.png'), (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await confirmCheckout();
    await until(() => jobs.length === 1);
    assert.equal(createCount, 1);
    assert.equal(jobs[0].widthMm, 80);
    await until(() => evaluate('!document.querySelector(".pos-print-root")'));
    await startCheckout('large');
    await confirmCheckout();
    await until(() => jobs.length === 2);
    assert.equal(createCount, 2);
    assert.equal(jobs[1].widthMm, 210); assert.equal(jobs[1].heightMm, 297);
    await until(() => evaluate('!document.querySelector(".pos-print-root")'));
    await startCheckout('large');
    failNext = true;
    await confirmCheckout();
    await until(() => evaluate('document.body.innerText.includes("TEST: Printer disconnected")'));
    assert.equal(createCount, 3);
    await click('إعادة المحاولة'); await until(() => jobs.length === 3);
    assert.equal(createCount, 3, 'Retry must not create another sale');
    assert.equal(jobs[2].widthMm, 210);
    assert.equal(jobs[2].invoice, 'INV-TEST-003');
    await until(() => evaluate('!document.querySelector(".pos-print-root")'));
    await startCheckout('small');
    cancelNext = true;
    await confirmCheckout();
    await until(() => evaluate('document.body.innerText.includes("تم إلغاء الطباعة")'));
    assert.equal(createCount, 4);
    assert.equal(savedSales.size, 4);
    assert.equal(jobs.length, 3);
    for (const [size, paper, width, height] of [['small', 'thermal58', 58, null], ['large', 'a5', 148, 210]]) {
      await startCheckout(size);
      await evaluate('(() => { const select = document.querySelector("[role=dialog] select"); const option = Array.from(select.options).find(o => o.textContent.includes(' + JSON.stringify(paper === 'thermal58' ? '58 mm' : 'A5') + ')); select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); })()');
      await confirmCheckout();
      await until(() => jobs.length === (paper === 'thermal58' ? 4 : 5));
      const job = jobs.at(-1);
      assert.equal(job.widthMm, width);
      if (height === null) assert(job.heightMm > 0, 'Thermal page follows measured content height');
      else assert.equal(job.heightMm, height);
      await until(() => evaluate('!document.querySelector(".pos-print-root")'));
    }
    assert(await evaluate('!document.querySelector("[data-invoice-preview]")'));
    await click('طيّ المنتجات'); await pause(350);
    await fs.writeFile(path.join(target, 'cart-collapsed.png'), (await main.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await main.reload();
    await until(() => evaluate('Boolean(document.querySelector(".pos-products-collapsed"))'));
    await fs.writeFile(path.join(target, 'results.json'), JSON.stringify({ passed: true, cartWidthBefore: widthBefore, cartWidthAfter: widthAfter, printers, jobs, createCount }, null, 2));
    console.log('PASS: Windows print-dialog routing, both invoice sizes, saved sales, retry without duplicates and cancellation.', JSON.stringify(jobs));
    main.destroy(); app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
})();
`;
const output = path.join(target, 'electron-check.cjs');
await build({ stdin: { contents: entry, resolveDir: root, sourcefile: 'verify-electron.cjs' }, outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(path.join(root, 'node_modules/electron/dist/electron.exe'), [output], { cwd: root, env, windowsHide: true, stdio: 'inherit', timeout: 90000 });
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);


