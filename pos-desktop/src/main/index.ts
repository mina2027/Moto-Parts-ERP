import { app, BrowserWindow, Menu, ipcMain, screen, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import electronUpdater from 'electron-updater';

// electron-updater is CJS, so a named ESM import throws at runtime (electron-builder#7976).
const { autoUpdater } = electronUpdater;
import { createApiClient, type ApiClient } from '@moto/api-client';
import type { AppSettings, Terminal } from '@moto/shared';
import { DEFAULT_SETTINGS } from '@moto/shared';
import { LocalDb } from './db/database';
import { SyncWorker } from './sync/worker';
import { createLocalOps } from './sync/localOps';
import { localAlternatives } from './sync/alternatives';
import { AuthStore } from './auth';
import { invokeData } from './dataAccess';
import { configuredDrawerPrinter, kickDrawer, listPrinters, printHtml } from './printing';
import { isSilentPref, parseScalePref, pickPrinterName, printLayoutFor } from './printLayout';
import { IPC, PRINT_PREF as PREF, type PairingInfo, type PrintHtmlInput } from '../shared/ipc';
import { invoicePreferences } from '../shared/printSettings';
import { assertSender, createIpcBoundary, secureNavigation } from './ipcSecurity';
import { normalizedServerUrl, validateIpcArgs } from './ipcValidation';
import { projectDisplaySettings, projectDisplayState, projectSession } from './displayProjection';
import { settleRejectedSale } from './rejectedSettlement';
import { archiveTerminal } from './db/archive';
import { assertInstallable, trustedUpdateFeed, verifyPinnedExecutable } from './updatePolicy';
import { IdlePolicy } from './idlePolicy';

const isDev = !app.isPackaged;
// On a sales terminal the stock menu hands the cashier Ctrl+R mid-sale, DevTools, and an F11 that
// fights the POS's own fullscreen shortcut.
if (!isDev) Menu.setApplicationMenu(null);
// A second instance would share this one's SQLite file and Chromium profile, so it must bail out
// before the database below is opened. app.exit (not app.quit) stops module execution right here.
if (!app.requestSingleInstanceLock()) app.exit(0);

let mainWin: BrowserWindow | null = null;
let displayWin: BrowserWindow | null = null;

const preload = path.join(__dirname, '../preload/index.cjs');
const devRenderer = isDev ? process.env.ELECTRON_RENDERER_URL : undefined;
const mainEntry = devRenderer || pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
const displayEntry = devRenderer ? `${devRenderer.replace(/\/$/, '')}/display.html` : pathToFileURL(path.join(__dirname, '../renderer/display.html')).href;
let updateDownloaded = false;
let updateTrusted = false;
let downloadedInstaller: string | null = null;
let updateConfigured = false;
let installingUpdate = false;
const publisherPins = __POS_UPDATE_THUMBPRINTS__.split(',').map(pin => pin.trim()).filter(Boolean);
autoUpdater.autoInstallOnAppQuit = false;

if (process.env.POS_SMOKE === '1') {
  if (!process.env.POS_SMOKE_USER_DATA) throw new Error('POS_SMOKE_USER_DATA must name an isolated smoke-test directory');
  app.setPath('userData', path.resolve(process.env.POS_SMOKE_USER_DATA));
}
const db = new LocalDb(path.join(app.getPath('userData'), 'pos.sqlite'));
const auth = new AuthStore(db);
const idle = new IdlePolicy();
function enforceIdle() {
  if (auth.current() && idle.expired(db.settings()?.pos.idleLockMinutes ?? DEFAULT_SETTINGS.pos.idleLockMinutes)) {
    auth.lock(); broadcast(IPC.evDataChanged, 'auth-locked');
  }
  return auth.current();
}
let api: ApiClient | null = null;

function serverUrl() {
  return db.getState('serverUrl');
}
function terminal(): Terminal | null {
  const raw = db.getState('terminal');
  return raw ? (JSON.parse(raw) as Terminal) : null;
}
function buildApi(url: string): ApiClient {
  return createApiClient({
    baseUrl: `${normalizedServerUrl(url)}/api`,
    credentials: 'omit',
    headers: { 'X-Client': 'pos-desktop', ...(terminal() ? { 'X-Terminal-Id': terminal()!.id } : {}) },
    getToken: () => auth.token(),
    onUnauthorized: () => (api ? auth.refresh(api) : Promise.resolve(null)),
  });
}
if (serverUrl()) api = buildApi(serverUrl()!);

const worker = new SyncWorker({
  db,
  api: () => api,
  canSync: () => Boolean(auth.token() || auth.refreshToken()),
  authenticate: () => api ? auth.reconnect(api) : Promise.resolve(false),
  terminalId: () => terminal()?.id ?? null,
  branchId: () => db.getState('branchId'),
});
const ops = createLocalOps({
  db,
  worker,
  terminalCode: () => terminal()?.code ?? 'T000',
  terminalId: () => terminal()?.id ?? null,
  branchId: () => db.getState('branchId') ?? '',
  userId: () => auth.current()?.user.id ?? '',
  permissions: () => auth.current()?.permissions ?? [],
  publicUrl: () => db.getState('publicUrl') ?? serverUrl() ?? '',
});

const broadcast = (channel: string, payload: unknown) => {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
};
worker.on('status', (s) => broadcast(IPC.evSyncStatus, s));
worker.on('data', (what: string) => broadcast(IPC.evDataChanged, what));

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1366,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'MotoParts POS',
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWin.on('ready-to-show', () => mainWin?.show());
  secureNavigation(mainWin.webContents, mainEntry, (url) => shell.openExternal(url));
  mainWin.webContents.on('before-input-event', () => idle.touch());
  mainWin.webContents.on('input-event', () => idle.touch());
  if (isDev && process.env.ELECTRON_RENDERER_URL) void mainWin.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void mainWin.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWin.on('closed', () => (mainWin = null));
}

function openCustomerDisplay() {
  if (displayWin && !displayWin.isDestroyed()) {
    displayWin.focus();
    return;
  }
  const displays = screen.getAllDisplays();
  const secondary = displays.find((d) => d.id !== screen.getPrimaryDisplay().id);
  displayWin = new BrowserWindow({
    x: secondary?.bounds.x ?? 40,
    y: secondary?.bounds.y ?? 40,
    width: secondary?.bounds.width ?? 1024,
    height: secondary?.bounds.height ?? 640,
    fullscreen: Boolean(secondary),
    autoHideMenuBar: true,
    title: 'Customer Display',
    webPreferences: { preload, additionalArguments: ['--pos-customer-display'], contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  secureNavigation(displayWin.webContents, displayEntry);
  if (devRenderer) void displayWin.loadURL(displayEntry);
  else void displayWin.loadFile(path.join(__dirname, '../renderer/display.html'));
  displayWin.on('closed', () => (displayWin = null));
}

// ---------- IPC ----------
const ipc = createIpcBoundary(ipcMain, () => mainWin?.webContents ?? null, mainEntry, enforceIdle, (channel, args) => {
  if (installingUpdate) throw new Error('UPDATE_INSTALL_IN_PROGRESS');
  return validateIpcArgs(channel, args);
});
function pairingInfo(): PairingInfo {
  return { serverUrl: serverUrl() ?? '', terminal: terminal(), branchId: db.getState('branchId'), paired: Boolean(serverUrl() && terminal()) };
}

ipc.handle(IPC.appVersion, () => app.getVersion());
ipc.handle(IPC.appPairing, () => pairingInfo());
ipc.handle(IPC.appBranchesFor, async (_e, input: { serverUrl: string; username: string; password: string }) => {
  const tmp = createApiClient({ baseUrl: `${input.serverUrl.replace(/\/$/, '')}/api`, credentials: 'omit', headers: { 'X-Client': 'pos-desktop' } });
  const session = await tmp.auth.login(input.username, input.password);
  const authed = createApiClient({ baseUrl: `${input.serverUrl.replace(/\/$/, '')}/api`, credentials: 'omit', headers: { 'X-Client': 'pos-desktop' }, getToken: () => session.token });
  const [branches, registers] = await Promise.all([authed.branches.list(), authed.cash.registers()]);
  return branches.filter((b) => b.isActive).map((b) => ({ id: b.id, name: b.name, registers: registers.filter((r) => r.branchId === b.id && r.isActive).map((r) => ({ id: r.id, name: r.name })) }));
});
ipc.handle(IPC.appPair, async (_e, input: { serverUrl: string; username: string; password: string; terminalName: string; branchId: string; registerId: string | null }) => {
  db.assertCanWipe();
  if (db.openSession()) throw new Error('RECONCILIATION_REQUIRED');
  const url = input.serverUrl.replace(/\/$/, '');
  const tmp = createApiClient({ baseUrl: `${url}/api`, credentials: 'omit', headers: { 'X-Client': 'pos-desktop' } });
  const session = await tmp.auth.login(input.username, input.password);
  const authed = createApiClient({ baseUrl: `${url}/api`, credentials: 'omit', headers: { 'X-Client': 'pos-desktop' }, getToken: () => session.token });
  const term = await authed.sync.registerTerminal({ name: input.terminalName, branchId: input.branchId, registerId: input.registerId, appVersion: app.getVersion() });
  db.wipe();
  db.setState('serverUrl', url);
  db.setState('terminal', JSON.stringify(term));
  db.setState('branchId', input.branchId);
  db.setState('publicUrl', url);
  auth.setSession(session);
  api = buildApi(url);
  await worker.bootstrap(api, input.branchId);
  worker.start();
  return pairingInfo();
});
ipc.handle(IPC.appReregister, async () => {
  const url = serverUrl();
  const prev = terminal();
  if (!url || !prev) throw new Error('NOT_PAIRED');
  if (!api) api = buildApi(url);
  const term = await api.sync.registerTerminal({ name: prev.name, branchId: prev.branchId, registerId: prev.registerId, appVersion: app.getVersion() });
  db.setState('terminal', JSON.stringify(term));
  db.setState('branchId', term.branchId);
  api = buildApi(url); // rebuild so the X-Terminal-Id header carries the new id
  worker.markRegistered();
  worker.start();
  void worker.syncNow();
  return pairingInfo();
});
ipc.handle(IPC.appUnpair, () => {
  db.assertCanWipe();
  if (db.openSession()) throw new Error('RECONCILIATION_REQUIRED');
  worker.stop();
  db.wipe();
  auth.logout();
  api = null;
});
ipc.handle(IPC.appOpenDisplay, () => openCustomerDisplay());
ipc.handle(IPC.appOpenDrawer, async () => {
  const prefs = invoicePreferences((key) => db.getPref(key), db.printProfiles());
  if (!prefs.smallPrinter || !mainWin || mainWin.isDestroyed()) return;
  const printer = configuredDrawerPrinter(await listPrinters(mainWin), prefs.smallPrinter);
  // PDF-only terminals and terminals without drawer hardware do not need a warning after every sale.
  if (!printer) return;
  const ok = await kickDrawer(printer);
  if (!ok) throw new Error('DRAWER_UNAVAILABLE');
});
ipc.handle(IPC.appPrinters, () => (mainWin ? listPrinters(mainWin) : []));
ipc.handle(IPC.appArchive, async () => {
  worker.stop();
  try {
    const archive = await archiveTerminal(db, path.join(app.getPath('userData'), 'archives'));
    return { file: archive.file, manifest: archive.manifest, sha256: archive.sha256 };
  } finally { if (pairingInfo().paired) worker.start(); }
});
ipc.handle(IPC.appPrintHtml, (_e, job: PrintHtmlInput) => {
  // Checkout uses the Windows printer dialog; other print callers retain legacy preferences.
  const override = job.profileId ? db.getPref(PREF.printer(job.profileId)) : null;
  const simple = job.profileId === 'invoice-small' || job.profileId === 'invoice-large';
  const scale = job.scale ?? (job.profileId ? parseScalePref(db.getPref(PREF.scale(job.profileId))) : 1);
  const layout = printLayoutFor({ ...job, scale });
  return printHtml(
    {
      html: job.html,
      approvedLogo: (() => { const logo = db.settings()?.company.logoUrl; const base = serverUrl(); if (!logo || !base) return undefined; const url = new URL(logo, `${base}/`); return url.origin === new URL(base).origin && /^\/uploads\/[A-Za-z0-9_.-]+$/.test(url.pathname) ? url.href : undefined; })(),
      printerName: simple ? null : pickPrinterName(override, job.printerName),
      silent: simple ? false : job.silent && isSilentPref(db.getPref(PREF.silent)),
      copies: Math.max(1, Math.min(10, Math.round(job.copies) || 1)),
      ...layout,
      title: job.title,
      mode: job.mode,
      locale: job.locale,
    },
    mainWin,
  );
});
ipc.handle(IPC.appCheckUpdates, async () => {
  if (isDev || !updateConfigured) return { available: false };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { available: Boolean(r?.updateInfo && r.updateInfo.version !== app.getVersion()), version: r?.updateInfo.version };
  } catch {
    throw new Error('UPDATE_CHECK_FAILED');
  }
});
ipc.handle(IPC.appQuitAndInstall, async () => {
  if (installingUpdate) throw new Error('UPDATE_INSTALL_IN_PROGRESS');
  assertInstallable(db, updateDownloaded, updateTrusted);
  installingUpdate = true;
  worker.stop();
  auth.lock(); // No new financial IPC can race the snapshot or installation.
  try {
    await verifyPinnedExecutable(process.execPath, publisherPins);
    const installer = downloadedInstaller;
    if (!installer) throw new Error('UPDATE_NOT_READY');
    await verifyPinnedExecutable(installer, publisherPins);
    await archiveTerminal(db, path.join(app.getPath('userData'), 'archives'));
    assertInstallable(db, updateDownloaded, updateTrusted);
    autoUpdater.quitAndInstall();
  } catch (error) {
    installingUpdate = false;
    if (pairingInfo().paired) worker.start();
    throw error;
  }
});

ipc.handle(IPC.authLogin, async (_e, input: { username: string; password: string }) => {
  const online = worker.isOnline();
  const session = await auth.login(api, online, input.username, input.password);
  idle.touch();
  if (auth.token() || auth.refreshToken()) void worker.syncNow();
  return projectSession(session);
});
ipc.handle(IPC.authCached, () => projectSession(auth.current()));
ipc.handle(IPC.authLock, () => auth.lock());
ipc.handle(IPC.authLogout, () => {
  const refreshToken = auth.refreshToken();
  if (api && worker.isOnline() && refreshToken) void api.auth.logout(refreshToken).catch(() => undefined);
  auth.logout();
  if (displayWin && !displayWin.isDestroyed()) displayWin.webContents.send(IPC.evDisplayState, { lines: [], invoiceDiscount: 0, customer: null, lastSaleId: null });
});

const branchId = () => db.getState('branchId') ?? '';
/** Receipts render on file:// / data: URLs, so a relative /uploads logo must be absolutised against the server. */
function withAbsoluteLogo(s: AppSettings): AppSettings {
  const url = s.company.logoUrl;
  const base = serverUrl();
  if (!url || !base || /^(https?:|data:)/i.test(url)) return s;
  return { ...s, company: { ...s.company, logoUrl: `${base.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}` } };
}

const dataHandlers: Record<string, (arg: never) => unknown | Promise<unknown>> = {
  settings: () => withAbsoluteLogo(db.settings() ?? DEFAULT_SETTINGS),
  lookup: (term: string) => db.lookup(term, branchId()),
  product: (id: string) => db.product(id, branchId()),
  products: () => db.products(branchId()),
  customers: () => db.customers(),
  createCustomer: (input: Parameters<typeof ops.createCustomer>[0]) => ops.createCustomer(input),
  specialPrices: () => db.specialPrices(),
  quickGrid: () => ({ products: db.quickProducts(), categories: db.quickCategories() }),
  catalogMeta: () => ({ categories: db.categories(), brands: db.brands(), models: db.models() }),
  saveQuickProduct: async (input: Parameters<ApiClient['quick']['saveProduct']>[0]) => {
    if (!api || !worker.isOnline()) throw new Error('OFFLINE');
    const saved = await api.quick.saveProduct(input);
    db.upsertQuickProduct(saved);
    return saved;
  },
  deleteQuickProduct: async (id: string) => {
    if (!api || !worker.isOnline()) throw new Error('OFFLINE');
    await api.quick.deleteProduct(id);
    db.deleteQuickProduct(id);
  },
  reorderQuick: async (ids: string[]) => {
    if (!api || !worker.isOnline()) throw new Error('OFFLINE');
    await api.quick.reorder(ids);
    const all = db.quickProducts();
    ids.forEach((id, i) => {
      const q = all.find((x) => x.id === id);
      if (q) db.upsertQuickProduct({ ...q, order: i });
    });
  },
  currentSession: () => {
    const open = db.openSession();
    return open ? ops.projectSession(open) : null;
  },
  openSession: (input: Parameters<typeof ops.openSession>[0]) => ops.openSession(input),
  closeSession: (input: Parameters<typeof ops.closeSession>[0]) => ops.closeSession(input),
  addCashMovement: (input: Parameters<typeof ops.addCashMovement>[0]) => ops.addCashMovement(input),
  recordCustomerPayment: (input: Parameters<typeof ops.recordCustomerPayment>[0]) => ops.recordCustomerPayment(input),
  createSale: (input: Parameters<typeof ops.createSale>[0]) => ops.createSale(input),
  createSaleReturn: (input: Parameters<typeof ops.createSaleReturn>[0]) => ops.createSaleReturn(input),
  sale: (id: string) => db.sale(id),
  saleByInvoice: (invoiceNumber: string) => db.saleByInvoice(invoiceNumber),
  recentSales: (limit?: number) => db.recentSales(limit),
  salesHistory: (query: Parameters<typeof db.salesHistory>[1]) => db.salesHistory(branchId(), query),
  alternatives: async (productId: string) => {
    if (api && worker.isOnline()) {
      try {
        return await api.products.alternatives(productId, branchId(), false);
      } catch {
        // fall through to local
      }
    }
    return localAlternatives(db, productId, branchId());
  },
  requestTransfer: async (input: { productId: string; fromBranchId: string; quantity: number }) => {
    // Transfers move stock between branches, so they are the one POS action that needs the server.
    if (!api || !worker.isOnline()) throw new Error('OFFLINE');
    await api.inventory.createTransfer({ sourceBranchId: input.fromBranchId, destinationBranchId: branchId(), items: [{ productId: input.productId, requestedQty: input.quantity }], notes: `POS ${terminal()?.code ?? ''}`.trim(), submit: true });
  },
  printProfiles: () => db.printProfiles(),
  getPref: (key: string) => db.getPref(key),
  setPref: (input: { key: string; value: string | null }) => db.setPref(input.key, input.value),
  registers: async () => {
    if (api && worker.isOnline()) {
      const regs = await api.cash.registers(branchId());
      return regs.map((r) => ({ id: r.id, name: r.name }));
    }
    const t = terminal();
    return t?.registerId ? [{ id: t.registerId, name: { ar: t.name } }] : [];
  },
  branches: () => db.branches(),
};
ipc.handle(IPC.data, async (_e, method: string, arg: unknown) => {
  return invokeData(dataHandlers, auth.current(), branchId(), method, arg);
});

ipc.handle(IPC.syncStatus, () => worker.status());
ipc.handle(IPC.syncNow, () => worker.reconnect());
ipc.handle(IPC.syncOutbox, () => db.outbox());
ipc.handle(IPC.syncRetry, (_e, opId: string) => {
  const row = db.outbox().find(r => r.opId === opId);
  if (!row || row.status !== 'rejected') throw new Error('OP_NOT_REJECTED');
  const retryPermissions = { sale: ['sales.create'], sale_return: ['returns.create'], customer_payment: ['customers.credit', 'sales.create'], customer_create: ['customers.edit', 'sales.create'], register_open: ['cash.open'], register_close: ['cash.close'], cash_movement: ['cash.open', 'cash.close', 'sales.create'] };
  if (!Object.hasOwn(retryPermissions, row.type) || !retryPermissions[row.type as keyof typeof retryPermissions].some(p => auth.current()?.permissions.some(allowed => allowed === p))) throw new Error('PERMISSION_DENIED');
  db.retryOp(opId, randomUUID());
  void worker.syncNow();
});
ipc.handle(IPC.syncVoid, (_e, opId: string, settlement?: { method: 'cash' | 'card' | 'bank_transfer'; reference: string }) => {
  if (!auth.current()?.permissions.includes('sales.cancel')) throw new Error('PERMISSION_DENIED');
  settleRejectedSale(db, opId, auth.current()!.user.id, db.getState('branchId') ?? '', settlement);
  broadcast(IPC.evSyncStatus, worker.status());
  broadcast(IPC.evDataChanged, 'sales');
});
ipcMain.on(IPC.displayPush, (_e, state: unknown) => {
  try {
    ipc.assertEvent(_e, IPC.displayPush);
    const projected = projectDisplayState(state);
    if (displayWin && !displayWin.isDestroyed()) displayWin.webContents.send(IPC.evDisplayState, projected);
  } catch { /* Untrusted one-way messages are dropped; never crash the main process. */ }
});
ipcMain.handle(IPC.displaySettings, (event) => {
  assertSender(event, displayWin?.webContents ?? null, displayEntry);
  return projectDisplaySettings(db.settings() ?? DEFAULT_SETTINGS);
});

app.on('second-instance', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});

app.whenReady().then(() => {
  if (process.env.POS_SMOKE === '1') {
    // CI / smoke: prove Electron + native SQLite boot, then exit.
    console.log(JSON.stringify({ smoke: 'ok', electron: process.versions.electron, counts: db.counts(), pairing: pairingInfo() }));
    db.close();
    app.exit(0);
    return;
  }
  createMainWindow();
  setInterval(enforceIdle, 1000).unref();
  if (pairingInfo().paired) worker.start();
  if (!isDev) {
    autoUpdater.autoDownload = true;
    if (__POS_UPDATE_URL__) {
      try {
        const feed = trustedUpdateFeed(__POS_UPDATE_URL__, __POS_UPDATE_PUBLISHER__, publisherPins);
        // NSIS uses this verifier for the downloaded EXE. Missing signature checks fail closed.
        const updater = autoUpdater as import('electron-updater').NsisUpdater;
        updater.verifyUpdateCodeSignature = async (_publishers, file) => {
          try { await verifyPinnedExecutable(file, publisherPins); return null; }
          catch { return 'UNTRUSTED_UPDATE_SIGNATURE'; }
        };
        autoUpdater.setFeedURL({ provider: 'generic', url: feed });
        autoUpdater.on('error', () => { updateDownloaded = false; updateTrusted = false; downloadedInstaller = null; broadcast(IPC.evDataChanged, 'update-error'); });
        autoUpdater.on('update-downloaded', event => {
          void verifyPinnedExecutable(event.downloadedFile, publisherPins).then(() => { downloadedInstaller = event.downloadedFile; updateDownloaded = true; updateTrusted = true; broadcast(IPC.evDataChanged, 'update-ready'); }).catch(() => { downloadedInstaller = null; updateDownloaded = false; updateTrusted = false; broadcast(IPC.evDataChanged, 'update-error'); });
        });
        updateConfigured = true;
        setTimeout(() => autoUpdater.checkForUpdates().catch(() => undefined), 5_000);
      } catch { broadcast(IPC.evDataChanged, 'update-configuration-error'); }
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  worker.stop();
  db.close();
  app.quit();
});
