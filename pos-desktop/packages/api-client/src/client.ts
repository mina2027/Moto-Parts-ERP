import type {
  AccountingSummary, Alert, AlternativeSuggestion, AppNotification, AppSettings, AuditLog, Branch, Brand, CashMovement, CashRegister,
  Category, Customer, CustomerDebt, CustomerPayment, DashboardData, DeadStockReport, DeadStockSnapshot, Expense, ExpenseCategory,
  CategoryNode, InvoiceVerification, LabelTemplate, ListQuery, MotorcycleModel, Paginated, Permission, PriceHistoryEntry, PrintProfile, Product, Purchase,
  PurchaseReturn, QuickCategory, QuickProduct, RegisterSession, Role, RoleKey, Sale, SaleReturn, Session, SpecialPrice, StatementLine,
  StockAdjustment, StockCount, StockLevel, StockMovement, Supplier, SupplierPayment, SyncPullResponse, SyncPushRequest, SyncPushResponse,
  Terminal, Transfer, User, Warehouse, WhatsAppMessage, WhatsAppTemplate, WhatsAppTemplateKey,
} from '@moto/shared';
import type {
  AdjustmentCreateInput, BranchSaveInput, CustomerPaymentCreateInput, CustomerSaveInput, DeadStockQuery, ExpenseCreateInput,
  LabelTemplateSaveInput, PrintProfileSaveInput, ProductCreateInput, ProductUpdateInput, PurchaseCreateInput, QuickCategorySaveInput,
  QuickProductSaveInput, SaleCreateInput, SaleReturnCreateInput, SupplierPaymentCreateInput, SupplierSaveInput, TerminalRegisterInput,
  TransferCreateInput, UserSaveInput, WarehouseSaveInput, WhatsAppSendInput,
} from '@moto/shared';
import { HttpClient, type HttpClientOptions, type QueryParams } from './http';

export interface ProductWithStock extends Product {
  totalStock: number;
  branchStock: Record<string, number>;
  stockStatus: 'in' | 'low' | 'out';
  saleStock?: number;
  saleLocation?: string;
  location?: string;
}

export interface ProductQuery extends ListQuery {
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  stockStatus?: 'in' | 'low' | 'out';
  isActive?: boolean;
  modelId?: string;
}

export interface SaleQuery extends ListQuery {
  cashierId?: string;
  customerId?: string;
  status?: string;
  type?: string;
  method?: string;
}

export interface InventoryRow {
  productId: string;
  quantity: number;
  reserved: number;
  value: number;
  minStock: number;
  /** Derived from the scoped quantity. */
  status: 'in' | 'low' | 'out';
  byBranch: Record<string, number>;
  byWarehouse: Record<string, number>;
  /** Branches at or below the reorder level even when the scoped total looks healthy. */
  lowBranches: string[];
  outBranches: string[];
}

export interface DebtRow extends CustomerDebt {
  status: 'open' | 'partial' | 'paid' | 'overdue';
  daysOverdue: number;
}

export interface RangeFilter {
  from: string;
  to: string;
  branchId?: string;
}

const q = (o: object): QueryParams => o as QueryParams;

export function createApiClient(options: HttpClientOptions) {
  const http = new HttpClient(options);

  const auth = {
    login: (username: string, password: string) => http.post<Session>('/auth/login', { username, password }, { noRetry: true }),
    refresh: (refreshToken?: string) => http.post<Session>('/auth/refresh', { refreshToken }, { noRetry: true }),
    logout: (refreshToken?: string) => http.post<{ ok: true }>('/auth/logout', { refreshToken }, { noRetry: true }),
    me: () => http.get<Session>('/auth/me'),
    changePassword: (current: string, next: string) => http.post<{ ok: true }>('/auth/change-password', { current, next }),
  };

  const products = {
    list: (query: ProductQuery = {}) => http.get<Paginated<ProductWithStock>>('/products', { query: q(query) }),
    all: (branchId?: string, includeDeleted = false) => http.get<ProductWithStock[]>('/products/all', { query: { branchId, ...(includeDeleted ? { includeDeleted: true } : {}) } }),
    get: (id: string, branchId?: string) => http.get<ProductWithStock>(`/products/${id}`, { query: { branchId } }),
    lookup: (term: string, branchId?: string, limit = 12) => http.get<ProductWithStock[]>('/products/lookup', { query: { term, branchId, limit } }),
    lookupWithHint: async (term: string, branchId?: string, limit = 12) => {
      const { data, headers } = await http.requestWithHeaders<ProductWithStock[]>('GET', '/products/lookup', undefined, { query: { term, branchId, limit } });
      return { products: data, legacyHit: headers.get('X-Legacy-Barcode') === 'true' };
    },
    create: (input: ProductCreateInput) => http.post<ProductWithStock>('/products', input),
    update: (id: string, patch: ProductUpdateInput) => http.patch<ProductWithStock>(`/products/${id}`, patch),
    delete: (id: string) => http.delete<{ ok: true }>(`/products/${id}`),
    bulkUpdate: (ids: string[], patch: ProductUpdateInput) => http.post<{ count: number }>('/products/bulk', { ids, patch }),
    stockLevels: (id: string) => http.get<StockLevel[]>(`/products/${id}/stock`),
    priceHistory: (query: { productId?: string; userId?: string; field?: string; branchId?: string; from?: string; to?: string; pageSize?: number } = {}) =>
      http.get<PriceHistoryEntry[]>('/products/price-history', { query: q(query) }),
    move: (ids: string[], categoryId: string) => http.post<{ count: number }>('/products/move', { ids, categoryId }),
    regenerateBarcode: (id: string) => http.post<ProductWithStock>(`/products/${id}/barcode/regenerate`),
    alternatives: (id: string, branchId: string, inStockOnly = true) => http.get<AlternativeSuggestion[]>(`/products/${id}/alternatives`, { query: { branchId, inStockOnly } }),
    setCompatibility: (productId: string, modelId: string, compatible: boolean) => http.post<string[]>(`/products/${productId}/compatibility`, { modelId, compatible }),
    setAlternative: (productId: string, altId: string, link: boolean) => http.post<{ ok: true }>(`/products/${productId}/alternatives`, { altId, link }),
    brands: () => http.get<Brand[]>('/catalog/brands'),
    addBrand: (input: { name: { ar?: string; en?: string }; country?: { ar?: string; en?: string } }) => http.post<Brand>('/catalog/brands', input),
    categories: () => http.get<Category[]>('/catalog/categories'),
    categoryTree: () => http.get<CategoryNode[]>('/catalog/categories/tree'),
    addCategory: (input: { name: { ar?: string; en?: string }; parentId?: string | null }) => http.post<Category>('/catalog/categories', input),
    updateCategory: (id: string, patch: { name?: { ar?: string; en?: string }; parentId?: string | null; sortOrder?: number; isActive?: boolean }) =>
      http.patch<Category>(`/catalog/categories/${id}`, patch),
    reorderCategories: (parentId: string | null, ids: string[]) => http.post<Category[]>('/catalog/categories/reorder', { parentId, ids }),
    deleteCategory: (id: string) => http.delete<{ ok: true }>(`/catalog/categories/${id}`),
    models: () => http.get<MotorcycleModel[]>('/catalog/models'),
    addModel: (input: { code: string; name: { ar: string; en?: string }; manufacturer: string; engineCc: number; years: string }) => http.post<MotorcycleModel>('/catalog/models', input),
  };

  const sales = {
    list: (query: SaleQuery = {}) => http.get<Paginated<Sale>>('/sales', { query: q(query) }),
    get: (id: string) => http.get<Sale>(`/sales/${id}`),
    findByInvoiceNumber: (num: string) => http.get<Sale | null>('/sales/by-number', { query: { num } }),
    held: (branchId: string) => http.get<Sale[]>('/sales/held', { query: { branchId } }),
    create: (input: SaleCreateInput, idempotencyKey?: string) => http.post<Sale>('/sales', input, { idempotencyKey }),
    resumeHeld: (id: string) => http.post<Sale>(`/sales/${id}/resume`),
    cancel: (id: string, refundMethod?: import('@moto/shared').PaymentMethod, registerSessionId?: string) => http.post<Sale>(`/sales/${id}/cancel`, { refundMethod, registerSessionId }),
    returns: (query: ListQuery = {}) => http.get<Paginated<SaleReturn>>('/sales/returns', { query: q(query) }),
    createReturn: (input: SaleReturnCreateInput, idempotencyKey?: string) => http.post<SaleReturn>('/sales/returns', input, { idempotencyKey }),
    stats: (branchId?: string) => http.get<{ count: number; total: number; avg: number; todayCount: number; todayTotal: number; cash: number; credit: number }>('/sales/stats', { query: { branchId } }),
    verifyPublic: (id: string) => http.get<InvoiceVerification>(`/public/invoices/${id}/verify`, { noRetry: true }),
  };

  const inventory = {
    overview: (branchId?: string, warehouseId?: string) => http.get<{ rows: InventoryRow[]; totalValue: number; totalQty: number; lowCount: number; outCount: number; skuCount: number }>('/inventory/overview', { query: { branchId, warehouseId } }),
    levels: (filter: { productId?: string; branchId?: string; warehouseId?: string } = {}) => http.get<StockLevel[]>('/inventory/levels', { query: q(filter) }),
    movements: (query: ListQuery = {}) => http.get<Paginated<StockMovement>>('/inventory/movements', { query: q(query) }),
    movementsForProduct: (productId: string, limit = 50) => http.get<StockMovement[]>(`/inventory/movements/product/${productId}`, { query: { limit } }),
    adjustments: (query: ListQuery = {}) => http.get<Paginated<StockAdjustment>>('/inventory/adjustments', { query: q(query) }),
    createAdjustment: (input: AdjustmentCreateInput) => http.post<StockAdjustment>('/inventory/adjustments', input),
    counts: () => http.get<StockCount[]>('/inventory/counts'),
    getCount: (id: string) => http.get<StockCount>(`/inventory/counts/${id}`),
    createCount: (input: { branchId: string; warehouseId: string; productIds: string[] }) => http.post<StockCount>('/inventory/counts', input),
    updateCountItem: (countId: string, productId: string, counted: number | null) => http.patch<StockCount>(`/inventory/counts/${countId}/items`, { productId, counted }),
    finishCount: (countId: string) => http.post<StockCount>(`/inventory/counts/${countId}/finish`),
    warehouses: (branchId?: string) => http.get<Warehouse[]>('/warehouses', { query: { branchId } }),
    getWarehouse: (id: string) => http.get<Warehouse>(`/warehouses/${id}`),
    warehouseStats: (id: string) => http.get<{ skuCount: number; qty: number; value: number; low: number; out: number; utilization: number }>(`/warehouses/${id}/stats`),
    saveWarehouse: (input: WarehouseSaveInput) => (input.id ? http.put<Warehouse>(`/warehouses/${input.id}`, input) : http.post<Warehouse>('/warehouses', input)),
    transfers: (query: ListQuery = {}) => http.get<Paginated<Transfer>>('/transfers', { query: q(query) }),
    getTransfer: (id: string) => http.get<Transfer>(`/transfers/${id}`),
    createTransfer: (input: TransferCreateInput) => http.post<Transfer>('/transfers', input),
    advanceTransfer: (id: string, next: string, note?: string, quantities?: Record<string, number>) => http.post<Transfer>(`/transfers/${id}/advance`, { next, note, quantities }),
  };

  const purchases = {
    list: (query: ListQuery = {}) => http.get<Paginated<Purchase>>('/purchases', { query: q(query) }),
    get: (id: string) => http.get<Purchase>(`/purchases/${id}`),
    create: (input: PurchaseCreateInput) => http.post<Purchase>('/purchases', input),
    receive: (id: string, quantities: Record<string, number>) => http.post<Purchase>(`/purchases/${id}/receive`, { quantities }),
    cancel: (id: string, input: { refundMethod?: 'cash' | 'card' | 'bank_transfer' } = {}) => http.post<Purchase>(`/purchases/${id}/cancel`, input),
    returns: (query: ListQuery = {}) => http.get<Paginated<PurchaseReturn>>('/purchases/returns', { query: q(query) }),
    reimbursements: (query: ListQuery & { purchaseId?: string } = {}) => http.get<Paginated<import('@moto/shared').SupplierReimbursement>>('/purchases/reimbursements', { query: q(query) }),
    receiveReimbursement: (id: string, input: { reference: string; registerSessionId?: string }, idempotencyKey?: string) => http.post<import('@moto/shared').SupplierReimbursement>(`/purchases/reimbursements/${id}/receive`, input, { idempotencyKey }),
    createReturn: (input: import('@moto/shared').PurchaseReturnCreateInput, idempotencyKey?: string) => http.post<PurchaseReturn>('/purchases/returns', input, { idempotencyKey }),
    payments: (query: ListQuery = {}) => http.get<Paginated<SupplierPayment>>('/purchases/payments', { query: q(query) }),
    recordPayment: (input: SupplierPaymentCreateInput, idempotencyKey?: string) => http.post<SupplierPayment>('/purchases/payments', input, { idempotencyKey }),
    stats: () => http.get<{ count: number; total: number; outstanding: number; pending: number }>('/purchases/stats'),
  };

  const customers = {
    list: (query: ListQuery = {}) => http.get<Paginated<Customer>>('/customers', { query: q(query) }),
    all: () => http.get<Customer[]>('/customers/all'),
    get: (id: string) => http.get<Customer>(`/customers/${id}`),
    save: (input: CustomerSaveInput, idempotencyKey?: string) => (input.id ? http.put<Customer>(`/customers/${input.id}`, input) : http.post<Customer>('/customers', input, { idempotencyKey })),
    summary: (id: string) => http.get<{ totalPurchases: number; totalPaid: number; balance: number; invoiceCount: number; lastPurchase: string | null; aging: Record<string, number>; overdueCount: number; availableCredit: number }>(`/customers/${id}/summary`),
    statement: (id: string) => http.get<StatementLine[]>(`/customers/${id}/statement`),
    specialPrices: (customerId?: string) => http.get<SpecialPrice[]>('/customers/special-prices', { query: { customerId } }),
    addSpecialPrice: (input: Omit<SpecialPrice, 'id'>) => http.post<SpecialPrice>('/customers/special-prices', input),
    removeSpecialPrice: (id: string) => http.delete<{ ok: true }>(`/customers/special-prices/${id}`),
    debts: (query: ListQuery = {}) => http.get<Paginated<DebtRow>>('/debts', { query: q(query) }),
    debtStats: (branchId?: string) => http.get<{ total: number; paid: number; remaining: number; overdue: number; overdueCount: number; dueSoon: number; dueSoonCount: number; collectionRate: number; aging: Record<string, number> }>('/debts/stats', { query: { branchId } }),
    payments: (query: ListQuery = {}) => http.get<Paginated<CustomerPayment>>('/debts/payments', { query: q(query) }),
    recordPayment: (input: CustomerPaymentCreateInput, idempotencyKey?: string) => http.post<CustomerPayment>('/debts/payments', input, { idempotencyKey }),
  };

  const suppliers = {
    list: (query: ListQuery = {}) => http.get<Paginated<Supplier>>('/suppliers', { query: q(query) }),
    all: () => http.get<Supplier[]>('/suppliers/all'),
    get: (id: string) => http.get<Supplier>(`/suppliers/${id}`),
    save: (input: SupplierSaveInput) => (input.id ? http.put<Supplier>(`/suppliers/${input.id}`, input) : http.post<Supplier>('/suppliers', input)),
    summary: (id: string) => http.get<{ totalPurchases: number; totalPaid: number; totalReturns: number; balance: number; purchaseCount: number; lastPurchase: string | null; productsCount: number }>(`/suppliers/${id}/summary`),
    statement: (id: string) => http.get<StatementLine[]>(`/suppliers/${id}/statement`),
    debtOverview: () => http.get<{ totalPayable: number; count: number; top: Supplier[]; suppliers: Supplier[] }>('/suppliers/debt-overview'),
  };

  const branches = {
    list: () => http.get<Branch[]>('/branches'),
    get: (id: string) => http.get<Branch>(`/branches/${id}`),
    save: (input: BranchSaveInput) => (input.id ? http.put<Branch>(`/branches/${input.id}`, input) : http.post<Branch>('/branches', input)),
    performance: () => http.get<{ branch: Branch; revenue: number; profit: number; expenses: number; net: number; invoices: number; inventory: number; employees: number; warehouses: number }[]>('/branches/performance'),
  };

  const users = {
    list: (query: ListQuery = {}) => http.get<Paginated<User>>('/users', { query: q(query) }),
    all: () => http.get<User[]>('/users/all'),
    get: (id: string) => http.get<User>(`/users/${id}`),
    save: (input: UserSaveInput) => (input.id ? http.put<User>(`/users/${input.id}`, input) : http.post<User>('/users', input)),
    roles: () => http.get<Role[]>('/roles'),
    saveRolePermissions: (key: RoleKey, permissions: Permission[]) => http.put<Role>(`/roles/${key}`, { permissions }),
  };

  const cash = {
    registers: (branchId?: string) => http.get<CashRegister[]>('/cash/registers', { query: { branchId } }),
    sessions: (query: ListQuery = {}) => http.get<Paginated<RegisterSession>>('/cash/sessions', { query: q(query) }),
    getSession: (id: string) => http.get<RegisterSession>(`/cash/sessions/${id}`),
    openSession: (registerId: string, openingBalance: number, idempotencyKey?: string) => http.post<RegisterSession>('/cash/sessions', { registerId, openingBalance }, { idempotencyKey }),
    addMovement: (sessionId: string, input: { type: string; amount: number; notes?: string }, idempotencyKey?: string) => http.post<CashMovement>(`/cash/sessions/${sessionId}/movements`, input, { idempotencyKey }),
    closeSession: (sessionId: string, actualCash: number, notes?: string, idempotencyKey?: string) => http.post<RegisterSession>(`/cash/sessions/${sessionId}/close`, { actualCash, notes }, { idempotencyKey }),
    currentSession: (branchId: string) => http.get<RegisterSession | null>('/cash/sessions/current', { query: { branchId } }),
  };

  const expenses = {
    categories: () => http.get<ExpenseCategory[]>('/expenses/categories'),
    list: (query: ListQuery = {}) => http.get<Paginated<Expense>>('/expenses', { query: q(query) }),
    create: (input: ExpenseCreateInput) => http.post<Expense>('/expenses', input),
    setStatus: (id: string, status: Expense['status']) => http.patch<Expense>(`/expenses/${id}/status`, { status }),
    stats: (branchId?: string) => http.get<{ total: number; thisMonth: number; pending: number; byCategory: { name: { ar: string; en?: string }; value: number; color?: string }[]; byBranch: { name: { ar: string; en?: string }; value: number }[] }>('/expenses/stats', { query: { branchId } }),
  };

  const reports = {
    dashboard: (f: RangeFilter) => http.get<DashboardData>('/reports/dashboard', { query: q(f) }),
    accounting: (f: RangeFilter) => http.get<AccountingSummary>('/reports/accounting', { query: q(f) }),
    sales: (f: RangeFilter & { cashierId?: string; customerId?: string; groupBy?: string }) => http.get<{ rows: { key: string; label: { ar: string; en?: string }; invoices: number; qty: number; sales: number; cost: number; profit: number }[]; totals: { invoices: number; qty: number; sales: number; cost: number; profit: number } }>('/reports/sales', { query: q(f) }),
    employeePerformance: (f: RangeFilter) => http.get<{ user: User; invoices: number; revenue: number; profit: number; avg: number; returns: number }[]>('/reports/employees', { query: q(f) }),
    deadStock: (query: Partial<DeadStockQuery>) => http.get<DeadStockReport>('/reports/dead-stock', { query: q(query) }),
    deadStockSnapshots: (branchId?: string) => http.get<DeadStockSnapshot[]>('/reports/dead-stock/snapshots', { query: { branchId } }),
    auditLogs: (query: ListQuery = {}) => http.get<Paginated<AuditLog>>('/audit', { query: q(query) }),
    globalSearch: (term: string) => http.get<{ products: Product[]; sales: Sale[]; customers: Customer[]; suppliers: Supplier[] }>('/search', { query: { term } }),
  };

  const notifications = {
    list: () => http.get<AppNotification[]>('/notifications'),
    markRead: (id: string) => http.patch<{ ok: true }>(`/notifications/${id}/read`),
    markAllRead: () => http.post<{ ok: true }>('/notifications/read-all'),
    alerts: (query: ListQuery & { unread?: boolean; severity?: string; type?: string; resolved?: boolean } = {}) => http.get<Paginated<Alert>>('/alerts', { query: q(query) }),
    alertSummary: () => http.get<{ unread: number; critical: number; latest: Alert[] }>('/alerts/summary'),
    readAlert: (id: string) => http.patch<Alert>(`/alerts/${id}/read`),
    resolveAlert: (id: string) => http.patch<Alert>(`/alerts/${id}/resolve`),
    readAllAlerts: () => http.post<{ ok: true }>('/alerts/read-all'),
  };

  const settings = {
    get: () => http.get<AppSettings>('/settings'),
    update: <K extends keyof AppSettings>(section: K, value: AppSettings[K]) => http.put<AppSettings>(`/settings/${section}`, { value }),
    uploadLogo: (file: File | Blob) => {
      const fd = new FormData();
      fd.append('file', file);
      return http.post<{ url: string }>('/settings/logo', fd);
    },
    printProfiles: (branchId?: string) => http.get<PrintProfile[]>('/print-profiles', { query: { branchId } }),
    savePrintProfile: (input: PrintProfileSaveInput) => (input.id ? http.put<PrintProfile>(`/print-profiles/${input.id}`, input) : http.post<PrintProfile>('/print-profiles', input)),
    deletePrintProfile: (id: string) => http.delete<{ ok: true }>(`/print-profiles/${id}`),
    labelTemplates: (branchId?: string) => http.get<LabelTemplate[]>('/labels/templates', { query: { branchId } }),
    saveLabelTemplate: (input: LabelTemplateSaveInput) => (input.id ? http.put<LabelTemplate>(`/labels/templates/${input.id}`, input) : http.post<LabelTemplate>('/labels/templates', input)),
    deleteLabelTemplate: (id: string) => http.delete<{ ok: true }>(`/labels/templates/${id}`),
  };

  const quick = {
    products: (branchId?: string) => http.get<QuickProduct[]>('/quick-products', { query: { branchId } }),
    categories: (branchId?: string) => http.get<QuickCategory[]>('/quick-products/categories', { query: { branchId } }),
    saveProduct: (input: QuickProductSaveInput) => (input.id ? http.put<QuickProduct>(`/quick-products/${input.id}`, input) : http.post<QuickProduct>('/quick-products', input)),
    deleteProduct: (id: string) => http.delete<{ ok: true }>(`/quick-products/${id}`),
    reorder: (ids: string[]) => http.patch<{ ok: true }>('/quick-products/reorder', { ids }),
    saveCategory: (input: QuickCategorySaveInput) => (input.id ? http.put<QuickCategory>(`/quick-products/categories/${input.id}`, input) : http.post<QuickCategory>('/quick-products/categories', input)),
    fillCategory: (id: string, body: { limit?: number; replace?: boolean } = {}) => http.post<{ added: number; removed: number }>(`/quick-products/categories/${id}/fill`, body),
    deleteCategory: (id: string) => http.delete<{ ok: true }>(`/quick-products/categories/${id}`),
  };

  const whatsapp = {
    templates: () => http.get<WhatsAppTemplate[]>('/whatsapp/templates'),
    saveTemplate: (key: WhatsAppTemplateKey, patch: Partial<WhatsAppTemplate>) => http.put<WhatsAppTemplate>(`/whatsapp/templates/${key}`, patch),
    messages: (query: ListQuery = {}) => http.get<Paginated<WhatsAppMessage>>('/whatsapp/messages', { query: q(query) }),
    stats: () => http.get<{ total: number; sentToday: number; deliveryRate: number | null; failed: number; queued: number; mode: 'cloud' | 'web' }>('/whatsapp/stats'),
    send: (input: WhatsAppSendInput) => http.post<WhatsAppMessage>('/whatsapp/send', input),
    retry: (id: string) => http.post<WhatsAppMessage>(`/whatsapp/messages/${id}/retry`),
  };

  const sync = {
    push: (body: SyncPushRequest) => http.post<SyncPushResponse>('/sync/push', body),
    pull: (branchId: string, since?: string, opIds?: string[]) => http.get<SyncPullResponse>('/sync/pull', { query: { branchId, since, opIds: opIds?.join(',') } }),
    bootstrap: (branchId: string, opIds?: string[]) => http.get<SyncPullResponse>('/sync/bootstrap', { query: { branchId, opIds: opIds?.join(',') } }),
    registerTerminal: (input: TerminalRegisterInput) => http.post<Terminal>('/terminals', input),
    terminals: (branchId?: string) => http.get<Terminal[]>('/terminals', { query: { branchId } }),
    heartbeat: (terminalId: string, appVersion?: string) => http.post<{ serverTime: string }>(`/terminals/${terminalId}/heartbeat`, { appVersion }),
    health: () => http.get<{ ok: true; time: string }>('/health', { noRetry: true }),
  };

  return { http, auth, products, sales, inventory, purchases, customers, suppliers, branches, users, cash, expenses, reports, notifications, settings, quick, whatsapp, sync };
}

export type ApiClient = ReturnType<typeof createApiClient>;
