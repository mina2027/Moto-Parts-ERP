import { type ConnectivityState, type PosAdapter, type PosProduct } from '@moto/pos-core';
import type { Locale, Permission, PrintProfile, User } from '@moto/shared';
import { PAPER_SIZES } from '@moto/shared';
import type { ConnectivityInfo } from '../../shared/ipc';

/** POS adapter for Electron: data via IPC → SQLite outbox; printing through the Windows dialog. */
export function createIpcAdapter(opts: { user: User; permissions: Permission[]; branchId: string; terminalCode: string; locale: Locale; navigate: (path: string) => void; branchName: (id: string) => string; onCartState?: (s: unknown) => void }): PosAdapter {
  const pos = window.pos;
  let last: ConnectivityState = { online: false, syncing: false, unregistered: false, pending: 0, rejected: 0, lastSyncAt: null };
  const toState = (s: ConnectivityInfo): ConnectivityState => ({ online: s.online, syncing: s.syncing, unregistered: s.unregistered, pending: s.pending, rejected: s.rejected, lastSyncAt: s.lastSyncAt, error: s.error });
  void pos.sync.status().then((s) => (last = toState(s)));
  const listeners = new Set<(s: ConnectivityState) => void>();
  pos.sync.onStatus((s) => {
    last = toState(s);
    listeners.forEach((l) => l(last));
  });

  return {
    user: opts.user,
    permissions: opts.permissions,
    branchId: opts.branchId,
    terminalCode: opts.terminalCode,
    locale: opts.locale,
    settings: () => pos.data.settings(),
    lookup: (term) => pos.data.lookup(term),
    product: (id) => pos.data.product(id),
    customers: () => pos.data.customers(),
    createCustomer: (input) => pos.data.createCustomer(input),
    specialPrices: () => pos.data.specialPrices(),
    catalog: async () => await pos.data.products() as PosProduct[],
    catalogMeta: () => pos.data.catalogMeta(),
    currentSession: () => pos.data.currentSession(),
    createSale: (input) => pos.data.createSale(input),
    createSaleReturn: (input) => pos.data.createSaleReturn(input),
    cashMovement: (input) => pos.data.addCashMovement(input),
    collectDebt: (input) => pos.data.recordCustomerPayment(input),
    lastSale: (id) => pos.data.sale(id),
    saleByInvoice: (invoiceNumber) => pos.data.saleByInvoice(invoiceNumber),
    recentSales: (limit) => pos.data.recentSales(limit),
    salesHistory: (query) => pos.data.salesHistory(query),
    branchName: (id) => opts.branchName(id),
    alternatives: (id) => pos.data.alternatives(id),
    requestTransfer: (productId, fromBranchId, quantity) => pos.data.requestTransfer({ productId, fromBranchId, quantity }),
    print: async (el: HTMLElement | null, profile: PrintProfile | null) => {
      if (!el || !profile) {
        throw new Error(opts.locale === 'ar' ? 'تعذّر تجهيز محتوى الفاتورة للطباعة' : 'Invoice content is not ready to print');
      }
      const paper = PAPER_SIZES[profile.paper];
      return pos.app.printHtml({ html: el.outerHTML, profileId: profile.id, printerName: null, mode: 'printer', locale: opts.locale, silent: false, copies: profile.copies, widthMm: paper.widthMm, heightMm: paper.heightMm === 'auto' ? null : paper.heightMm, scale: 1, title: profile.name });
    },
    openDrawer: () => pos.app.openDrawer(),
    openCustomerDisplay: () => pos.app.openCustomerDisplay(),
    navigate: opts.navigate,
    connectivity: () => last,
    subscribeConnectivity: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    syncNow: async () => {
      last = toState(await pos.sync.syncNow());
      listeners.forEach((l) => l(last));
    },
  };
}
