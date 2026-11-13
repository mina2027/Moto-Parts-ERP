import { contextBridge, ipcRenderer } from 'electron';
import { IPC, type PosApi } from '../shared/ipc';
import { exposeDisplayBridge } from './display';

const data = <T>(method: string) => (arg?: unknown) => ipcRenderer.invoke(IPC.data, method, arg) as Promise<T>;

const on = <T>(channel: string) => (cb: (payload: T) => void) => {
  const handler = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

const posApi: PosApi = {
  app: {
    version: () => ipcRenderer.invoke(IPC.appVersion),
    pairing: () => ipcRenderer.invoke(IPC.appPairing),
    pair: (input) => ipcRenderer.invoke(IPC.appPair, input),
    branchesFor: (input) => ipcRenderer.invoke(IPC.appBranchesFor, input),
    reregister: () => ipcRenderer.invoke(IPC.appReregister),
    unpair: () => ipcRenderer.invoke(IPC.appUnpair),
    archive: () => ipcRenderer.invoke(IPC.appArchive),
    openCustomerDisplay: () => ipcRenderer.invoke(IPC.appOpenDisplay),
    openDrawer: () => ipcRenderer.invoke(IPC.appOpenDrawer),
    printers: () => ipcRenderer.invoke(IPC.appPrinters),
    printHtml: (input) => ipcRenderer.invoke(IPC.appPrintHtml, input),
    checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckUpdates),
    quitAndInstall: () => ipcRenderer.invoke(IPC.appQuitAndInstall),
  },
  auth: {
    login: (input) => ipcRenderer.invoke(IPC.authLogin, input),
    cachedSession: () => ipcRenderer.invoke(IPC.authCached),
    logout: () => ipcRenderer.invoke(IPC.authLogout),
    lock: () => ipcRenderer.invoke(IPC.authLock),
  },
  data: {
    settings: data('settings'),
    lookup: data('lookup'),
    product: data('product'),
    products: data('products'),
    customers: data('customers'),
    createCustomer: data('createCustomer'),
    specialPrices: data('specialPrices'),
    quickGrid: data('quickGrid'),
    catalogMeta: data('catalogMeta'),
    saveQuickProduct: data('saveQuickProduct'),
    deleteQuickProduct: data('deleteQuickProduct'),
    reorderQuick: data('reorderQuick'),
    currentSession: data('currentSession'),
    openSession: data('openSession'),
    closeSession: data('closeSession'),
    addCashMovement: data('addCashMovement'),
    recordCustomerPayment: data('recordCustomerPayment'),
    createSale: data('createSale'),
    createSaleReturn: data('createSaleReturn'),
    sale: data('sale'),
    saleByInvoice: data('saleByInvoice'),
    recentSales: data('recentSales'),
    salesHistory: data('salesHistory'),
    alternatives: data('alternatives'),
    requestTransfer: data('requestTransfer'),
    printProfiles: data('printProfiles'),
    getPref: data('getPref'),
    setPref: data('setPref'),
    registers: data('registers'),
    branches: data('branches'),
  },
  sync: {
    status: () => ipcRenderer.invoke(IPC.syncStatus),
    syncNow: () => ipcRenderer.invoke(IPC.syncNow),
    outbox: () => ipcRenderer.invoke(IPC.syncOutbox),
    retryRejected: (opId) => ipcRenderer.invoke(IPC.syncRetry, opId),
    voidRejected: (opId, settlement) => ipcRenderer.invoke(IPC.syncVoid, opId, settlement),
    onStatus: on(IPC.evSyncStatus),
    onDataChanged: on(IPC.evDataChanged),
  },
  display: {
    push: (state) => ipcRenderer.send(IPC.displayPush, state),
    onState: on(IPC.evDisplayState),
  },
};

if (process.argv.includes('--pos-customer-display')) exposeDisplayBridge();
else contextBridge.exposeInMainWorld('pos', posApi);
