import type {
  AlternativeSuggestion, AppSettings, Brand, Branch, CashMovementType, Category, Customer, CustomerPayment, ListQuery, MotorcycleModel, Paginated, PaymentMethod, PrintProfile, QuickCategory, QuickProduct, RegisterSession, Sale, SaleReturn, Session, SpecialPrice, Terminal, Product,
} from '@moto/shared';
import type { CustomerSaveInput, QuickProductSaveInput, SaleCreateInput, SaleReturnCreateInput } from '@moto/shared';

export type RendererSession = Omit<Session, 'token' | 'refreshToken'>;
import type { PrintOutcome } from '@moto/shared';

/** Everything the renderer may ask the main process. Kept in one place so preload + renderer share the contract. */
export interface PairingInfo {
  serverUrl: string;
  terminal: Terminal | null;
  branchId: string | null;
  paired: boolean;
}

export interface ConnectivityInfo {
  online: boolean;
  syncing: boolean;
  /** Server does not know this terminal any more; pushes are paused until it is registered again. */
  unregistered: boolean;
  pending: number;
  rejected: number;
  lastSyncAt: string | null;
  lastPullAt: string | null;
  error: string | null;
}

export interface OutboxRow {
  opId: string;
  type: string;
  createdAt: string;
  attempts: number;
  status: 'pending' | 'sent' | 'applied' | 'rejected';
  error: string | null;
  summary: string;
}

export interface LocalProduct extends Product {
  available: number;
  /** "rack · shelf · bin" in this branch; undefined when no shelf is assigned. */
  location?: string;
}

/** Device-local print preference keys (stored in the terminal's SQLite `print_prefs`). */
export const PRINT_PREF = {
  deviceProfile: 'printProfile',
  /** '0' = always show the system print dialog. */
  silent: 'printSilent',
  /** Installed printer chosen on this PC for a profile. */
  printer: (profileId: string) => `printer:${profileId}`,
  /** Content scale in percent for a profile (e.g. "95"). */
  scale: (profileId: string) => `printScale:${profileId}`,
} as const;

export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  /** PDF/XPS/OneNote… — never printed to silently. */
  virtual: boolean;
}

export interface PrintHtmlInput {
  html: string;
  /** Profile the job belongs to; lets the main process apply this device's printer/scale overrides. */
  profileId?: string | null;
  printerName?: string | null;
  silent: boolean;
  copies: number;
  widthMm: number;
  heightMm: number | null;
  /** Explicit zoom (1 = 100%); when omitted the device setting for the profile is used. */
  scale?: number;
  /** Shown as the window title when the job has to fall back to the system print dialog. */
  title?: string;
  mode?: 'printer' | 'pdf';
  locale?: 'ar' | 'en';
}

export interface PosApi {
  app: {
    version(): Promise<string>;
    pairing(): Promise<PairingInfo>;
    pair(input: { serverUrl: string; username: string; password: string; terminalName: string; branchId: string; registerId: string | null }): Promise<PairingInfo>;
    branchesFor(input: { serverUrl: string; username: string; password: string }): Promise<{ id: string; name: { ar: string; en?: string }; registers: { id: string; name: { ar: string; en?: string } }[] }[]>;
    /** Register this device again on the same server/branch, keeping local data and the outbox. */
    reregister(): Promise<PairingInfo>;
    unpair(): Promise<void>;
    archive(): Promise<{ file: string; manifest: string; sha256: string }>;
    openCustomerDisplay(): Promise<void>;
    openDrawer(): Promise<void>;
    printers(): Promise<PrinterInfo[]>;
    printHtml(input: PrintHtmlInput): Promise<PrintOutcome>;
    checkForUpdates(): Promise<{ available: boolean; version?: string }>;
    quitAndInstall(): Promise<void>;
  };
  auth: {
    login(input: { username: string; password: string }): Promise<RendererSession>;
    cachedSession(): Promise<RendererSession | null>;
    logout(): Promise<void>;
    lock(): Promise<void>;
  };
  data: {
    settings(): Promise<AppSettings>;
    lookup(term: string): Promise<{ products: LocalProduct[]; legacyHit: boolean }>;
    product(id: string): Promise<LocalProduct | null>;
    products(): Promise<LocalProduct[]>;
    customers(): Promise<Customer[]>;
    createCustomer(input: CustomerSaveInput): Promise<Customer>;
    specialPrices(): Promise<SpecialPrice[]>;
    quickGrid(): Promise<{ products: QuickProduct[]; categories: QuickCategory[] }>;
    catalogMeta(): Promise<{ categories: Category[]; brands: Brand[]; models: MotorcycleModel[] }>;
    saveQuickProduct(input: QuickProductSaveInput): Promise<QuickProduct>;
    deleteQuickProduct(id: string): Promise<void>;
    reorderQuick(ids: string[]): Promise<void>;
    currentSession(): Promise<RegisterSession | null>;
    openSession(input: { registerId: string; openingBalance: number }): Promise<RegisterSession>;
    closeSession(input: { sessionId: string; actualCash: number; notes?: string }): Promise<RegisterSession>;
    /** Cash in / out / expense against the open drawer. Returns the session with fresh totals. */
    addCashMovement(input: { type: CashMovementType; amount: number; notes?: string }): Promise<RegisterSession>;
    recordCustomerPayment(input: { customerId: string; amount: number; method: PaymentMethod; notes?: string }): Promise<CustomerPayment>;
    createSale(input: SaleCreateInput): Promise<Sale>;
    createSaleReturn(input: SaleReturnCreateInput): Promise<SaleReturn>;
    sale(id: string): Promise<Sale | null>;
    saleByInvoice(invoiceNumber: string): Promise<Sale | null>;
    recentSales(limit?: number): Promise<Sale[]>;
    salesHistory(query: Pick<ListQuery, 'page' | 'pageSize' | 'search'>): Promise<Paginated<Sale>>;
    alternatives(productId: string): Promise<AlternativeSuggestion[]>;
    requestTransfer(input: { productId: string; fromBranchId: string; quantity: number }): Promise<void>;
    printProfiles(): Promise<PrintProfile[]>;
    getPref(key: string): Promise<string | null>;
    setPref(input: { key: string; value: string | null }): Promise<void>;
    registers(): Promise<{ id: string; name: { ar: string; en?: string } }[]>;
    branches(): Promise<Branch[]>;
  };
  sync: {
    status(): Promise<ConnectivityInfo>;
    syncNow(): Promise<ConnectivityInfo>;
    outbox(): Promise<OutboxRow[]>;
    retryRejected(opId: string): Promise<void>;
    voidRejected(opId: string, settlement?: { method: 'cash' | 'card' | 'bank_transfer'; reference: string }): Promise<void>;
    onStatus(cb: (s: ConnectivityInfo) => void): () => void;
    onDataChanged(cb: (what: string) => void): () => void;
  };
  display: {
    /** Renderer (main window) pushes cart state to the customer display window. */
    push(state: unknown): void;
    onState(cb: (state: unknown) => void): () => void;
  };
}

export const IPC = {
  appVersion: 'app:version',
  appPairing: 'app:pairing',
  appPair: 'app:pair',
  appBranchesFor: 'app:branchesFor',
  appReregister: 'app:reregister',
  appUnpair: 'app:unpair',
  appArchive: 'app:archive',
  appOpenDisplay: 'app:openDisplay',
  appOpenDrawer: 'app:openDrawer',
  appPrinters: 'app:printers',
  appPrintHtml: 'app:printHtml',
  appCheckUpdates: 'app:checkUpdates',
  appQuitAndInstall: 'app:quitAndInstall',
  authLogin: 'auth:login',
  authCached: 'auth:cached',
  authLogout: 'auth:logout',
  authLock: 'auth:lock',
  data: 'data:call',
  syncStatus: 'sync:status',
  syncNow: 'sync:now',
  syncOutbox: 'sync:outbox',
  syncRetry: 'sync:retry',
  syncVoid: 'sync:void',
  evSyncStatus: 'ev:syncStatus',
  evDataChanged: 'ev:dataChanged',
  displayPush: 'display:push',
  displaySettings: 'display:settings',
  evDisplayState: 'ev:displayState',
} as const;
