import { z } from 'zod';
import { CashMovementCreateSchema, CustomerSaveSchema, PaymentMethodSchema, QuickProductSaveSchema, RegisterCloseSchema, RegisterOpenSchema, SaleCreateSchema, SaleReturnCreateSchema } from '@moto/shared';
import { IPC } from '../shared/ipc';
import { FIXED_SERVER_URL } from '../shared/server';

const id = z.string().min(1).max(256);
const note = z.string().max(10000).optional();
const login = z.object({ username: z.string().trim().min(1).max(256), password: z.string().min(1).max(1024) }).strict();
export function normalizedServerUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('INVALID_SERVER_URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('INVALID_SERVER_URL');
  return url.href.replace(/\/$/, '');
}
const credentials = login.extend({ serverUrl: z.string().max(4096).transform(normalizedServerUrl).refine((url) => url === FIXED_SERVER_URL, 'FIXED_SERVER_URL_REQUIRED') });
const print = z.object({
  html: z.string().min(1).max(2_000_000), profileId: id.nullable().optional(), printerName: z.string().max(256).nullable().optional(),
  silent: z.boolean(), copies: z.number().int().min(1).max(10), widthMm: z.number().finite().min(10).max(1000), heightMm: z.number().finite().min(10).max(5000).nullable(),
  scale: z.number().finite().min(0.5).max(1.5).optional(), title: z.string().max(256).optional(), mode: z.enum(['printer', 'pdf']).optional(), locale: z.enum(['ar', 'en']).optional(),
}).strict();
const channelSchemas: Record<string, z.ZodTypeAny> = {
  [IPC.authLogin]: login, [IPC.appBranchesFor]: credentials,
  [IPC.appPair]: credentials.extend({ terminalName: z.string().trim().min(1).max(256), branchId: id, registerId: id.nullable() }),
  [IPC.appPrintHtml]: print, [IPC.syncRetry]: id, [IPC.syncVoid]: id,
};

export function validateIpcArgs(channel: string, args: unknown[]): unknown[] {
  if (channel === IPC.syncVoid && args.length === 2) {
    const parsed = z.tuple([id, z.object({ method: z.enum(['cash', 'card', 'bank_transfer']), reference: z.string().trim().min(1).max(256) }).strict().optional()]).safeParse(args);
    if (!parsed.success) throw new Error('INVALID_IPC_ARGUMENT');
    return parsed.data;
  }
  if (channel === IPC.data) {
    if (args.length !== 2 || typeof args[0] !== 'string' || args[0].length > 80) throw new Error('INVALID_IPC_ARGUMENT');
    return args;
  }
  const schema = channelSchemas[channel];
  if (!schema) { if (args.length) throw new Error('INVALID_IPC_ARGUMENT'); return []; }
  if (args.length !== 1) throw new Error('INVALID_IPC_ARGUMENT');
  const parsed = schema.safeParse(args[0]);
  if (!parsed.success) throw new Error('INVALID_IPC_ARGUMENT');
  return [parsed.data];
}

/** Bound even optional fields, and reject non-finite values before schemas coerce input. */
export function assertBoundedData(value: unknown) {
  let nodes = 0, size = 0;
  const walk = (v: unknown, depth: number) => {
    if (++nodes > 20000 || depth > 20) throw new Error('INVALID_IPC_ARGUMENT');
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('INVALID_IPC_ARGUMENT');
    if (typeof v === 'string') { size += v.length; if (size > 200000 || v.length > 10000) throw new Error('INVALID_IPC_ARGUMENT'); }
    if (Array.isArray(v) && v.length > 1000) throw new Error('INVALID_IPC_ARGUMENT');
    if (v && typeof v === 'object') for (const item of Object.values(v)) walk(item, depth + 1);
  };
  walk(value, 0);
}
const noArg = z.union([z.undefined(), z.null()]);
const dataSchemas: Record<string, z.ZodTypeAny> = {
  ...Object.fromEntries(['settings', 'products', 'customers', 'specialPrices', 'quickGrid', 'catalogMeta', 'currentSession', 'printProfiles', 'registers', 'branches'].map(m => [m, noArg])),
  lookup: z.string().max(256), product: id, sale: id, saleByInvoice: id, alternatives: id,
  recentSales: z.number().int().min(1).max(500).optional(),
  salesHistory: z.object({ page: z.number().int().min(1).max(1_000_000).default(1), pageSize: z.number().int().min(1).max(500).default(100), search: z.string().trim().max(256).default('') }).strict(),
  createCustomer: CustomerSaveSchema.extend({ notes: note }), saveQuickProduct: QuickProductSaveSchema,
  deleteQuickProduct: id, reorderQuick: z.array(id).min(1).max(1000),
  openSession: RegisterOpenSchema, closeSession: RegisterCloseSchema.extend({ sessionId: id, notes: note }),
  addCashMovement: CashMovementCreateSchema.extend({ notes: note }),
  recordCustomerPayment: z.object({ customerId: id, amount: z.number().finite().positive(), method: PaymentMethodSchema, notes: note }),
  createSale: SaleCreateSchema.extend({ notes: note }), createSaleReturn: SaleReturnCreateSchema.extend({ notes: note }),
  requestTransfer: z.object({ productId: id, fromBranchId: id, quantity: z.number().finite().positive() }),
  getPref: z.string().min(1).max(256), setPref: z.object({ key: z.string().min(1).max(256), value: z.string().max(10000).nullable() }),
};
export function validateDataArg(method: string, arg: unknown, branchId: string): unknown {
  assertBoundedData(arg);
  if (!Object.hasOwn(dataSchemas, method)) throw new Error('UNKNOWN_DATA_METHOD');
  const parsed = dataSchemas[method].safeParse(arg);
  if (!parsed.success) throw new Error('INVALID_IPC_ARGUMENT');
  if (['createSale', 'createCustomer', 'saveQuickProduct'].includes(method)) {
    const wanted = (parsed.data as { branchId?: string | null }).branchId;
    if (wanted && wanted !== branchId) throw new Error('BRANCH_DENIED');
  }
  return parsed.data;
}
