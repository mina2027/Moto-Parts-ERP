import type { CashMovement, CashMovementType, Customer, CustomerPayment, PaymentMethod, RegisterSession, Sale, SaleItem, SaleReturn, SaleReturnItem, AppSettings } from '@moto/shared';
import { DEFAULT_SETTINGS, applyCashMovement, encodeInvoiceQr, expectedCashOf, formatOfflineInvoiceNumber, maxRefundFor, returnPayout, round2, saleLineDiscount, tx, uuid } from '@moto/shared';
import type { CustomerSaveInput, SaleCreateInput, SaleReturnCreateInput } from '@moto/shared';
import type { LocalDb } from '../db/database';
import type { SyncWorker } from './worker';

export interface LocalOpsContext {
  db: LocalDb;
  worker: SyncWorker;
  terminalCode: () => string;
  terminalId: () => string | null;
  branchId: () => string;
  userId: () => string;
  permissions?: () => readonly string[];
  publicUrl: () => string;
}

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** Keep the server-signed zero-tax policy on the invoice, including when an older server later changes settings. */
function zeroTaxSnapshot(token?: string): string | undefined {
  if (!token) return undefined;
  try {
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra !== undefined) return undefined;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).rate === 0 ? token : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Local-first operations: every write goes to SQLite + outbox, then is pushed immediately when online.
 * The local record is the terminal's source of truth until the server confirms.
 */
export function createLocalOps(ctx: LocalOpsContext) {
  const settings = (): AppSettings => ctx.db.settings() ?? DEFAULT_SETTINGS;

  async function afterEnqueue(opId: string) {
    if (!ctx.worker.isOnline()) return;
    try {
      await ctx.worker.pushOne(opId);
    } catch {
      // Network blip — the background worker will retry.
    }
  }

  async function createSale(input: SaleCreateInput): Promise<Sale> {
    const s = settings();
    const permissions = ctx.permissions?.();
    const can = (permission: string) => !permissions || permissions.includes(permission);
    const maxDiscountAmount = can('discounts.unlimited') ? Number.POSITIVE_INFINITY : s.pos.maxDiscountAmount;
    const now = new Date().toISOString();
    const seq = ctx.db.nextLocalSeq();
    const invoiceNumber = formatOfflineInvoiceNumber(s.invoice.prefix, ctx.terminalCode(), seq);
    const items: SaleItem[] = input.items.map((i) => {
      const gross = i.unitPrice * i.quantity;
      const discount = saleLineDiscount(i);
      const product = ctx.db.product(i.productId, ctx.branchId());
      if (!product || !product.isActive) throw new Error('PRODUCT_NOT_FOUND');
      const productMaxDiscountAmount = product.maxDiscountAmount && product.maxDiscountAmount > 0 ? Math.min(maxDiscountAmount, product.maxDiscountAmount) : maxDiscountAmount;
      if (discount > 0 && !can('discounts.item')) throw new Error('PERMISSION_DENIED');
      if (discount > round2(gross) || discount > productMaxDiscountAmount + 0.01) throw new Error('DISCOUNT_EXCEEDS');
      if (i.priceTier === 'wholesale' && !can('prices.wholesale')) throw new Error('PERMISSION_DENIED');
      const special = ctx.db.specialPrices().find(sp => sp.customerId === input.customerId && sp.productId === i.productId && new Date(sp.validFrom).getTime() <= Date.now() && (!sp.validTo || new Date(sp.validTo).getTime() >= Date.now()))?.price;
      const allowedPrices = i.priceTier === 'manual' ? [] : i.priceTier === 'special' ? (special != null ? [special] : []) : i.priceTier ? [product.prices[i.priceTier]] : [product.prices.retail1, product.prices.retail2, ...(can('prices.wholesale') ? [product.prices.wholesale] : []), ...(special != null ? [special] : [])];
      if (!allowedPrices.some(price => Math.abs(price - i.unitPrice) < 0.005)) throw new Error('PRICE_NOT_ALLOWED');
      const unitCost = product ? product.lastPurchaseCost || product.purchasePrice || 0 : i.unitCost ?? 0;
      return { id: newId('si'), productId: i.productId, name: i.name?.ar ? { ar: i.name.ar, en: i.name.en } : { ar: '' }, barcode: i.barcode ?? '', sku: i.sku ?? '', partNumber: i.partNumber, quantity: i.quantity, listPrice: i.unitPrice, unitPrice: i.unitPrice, unitCost, priceTier: i.priceTier ?? 'retail1', discount, discountPercent: 0, subtotal: round2(gross - discount), returnedQty: 0 };
    });
    const subtotal = round2(items.reduce((a, i) => a + i.unitPrice * i.quantity, 0));
    const itemDiscounts = round2(items.reduce((a, i) => a + i.discount, 0));
    const invoiceDiscount = round2(input.invoiceDiscount ?? 0);
    if (invoiceDiscount > 0 && !can('discounts.invoice')) throw new Error('PERMISSION_DENIED');
    if (invoiceDiscount > round2(subtotal - itemDiscounts) || invoiceDiscount > maxDiscountAmount + 0.01 || round2(itemDiscounts + invoiceDiscount) > maxDiscountAmount + 0.01) throw new Error('DISCOUNT_EXCEEDS');
    const taxable = round2(subtotal - itemDiscounts - invoiceDiscount);
    const tax = 0;
    const total = round2(taxable + tax);
    if (input.payments.some((p) => p.method === 'credit')) throw new Error('INVALID_PAYMENT_METHOD');
    const paidRaw = round2(input.payments.filter((p) => p.method !== 'credit').reduce((a, p) => a + p.amount, 0));
    const cashTendered = round2(input.payments.filter((p) => p.method === 'cash').reduce((a, p) => a + p.amount, 0));
    if (paidRaw > total && (input.type === 'credit' || round2(paidRaw - total) > cashTendered)) throw new Error('OVERPAYMENT');
    const change = input.type === 'cash' ? round2(Math.max(0, paidRaw - total)) : 0;
    let paid = round2(Math.min(paidRaw, total));
    let remaining = round2(Math.max(0, total - paid));
    const accountIncrease = remaining;
    if (total < 0) throw new Error('INVALID_TOTAL');
    if (input.type === 'cash' && paid < total) throw new Error('UNDERPAID');
    const customer = input.customerId ? ctx.db.customers().find(c => c.id === input.customerId && c.isActive) : undefined;
    if (input.customerId && !customer) throw new Error('CUSTOMER_NOT_FOUND');
    if (input.type === 'credit') {
      if (!customer) throw new Error('CUSTOMER_REQUIRED');
      if (customer.branchId !== ctx.branchId()) throw new Error('BRANCH_DENIED');
      if (customer.creditLimit > 0 && round2(customer.balance + accountIncrease) > customer.creditLimit) throw new Error('CUSTOMER_CREDIT_EXCEEDED');
      const advance = round2(Math.min(remaining, Math.max(0, -customer.balance)));
      paid = round2(paid + advance);
      remaining = round2(remaining - advance);
    }
    const quantities = new Map<string, number>();
    for (const item of items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
    for (const [productId, quantity] of quantities) {
      const product = ctx.db.product(productId, ctx.branchId());
      if (!product || !product.isActive) throw new Error('PRODUCT_NOT_FOUND');
      if (product.available < quantity) throw new Error('INSUFFICIENT_STOCK');
    }
    const localId = newId('lsale');
    const sale: Sale = {
      id: localId,
      invoiceNumber,
      date: now,
      branchId: ctx.branchId(),
      cashierId: ctx.userId(),
      customerId: input.customerId ?? null,
      registerSessionId: input.registerSessionId ?? null,
      terminalId: ctx.terminalId(),
      items,
      subtotal,
      itemDiscounts,
      invoiceDiscount,
      tax,
      total,
      paid,
      remaining,
      change,
      payments: input.payments,
      type: input.type,
      status: 'completed',
      notes: input.notes,
      syncStatus: 'pending',
    };
    sale.qrPayload = encodeInvoiceQr({ sellerName: tx(s.company.name, 'ar'), taxNumber: s.company.taxNumber, timestamp: now, totalWithTax: total, taxAmount: tax, verifyUrl: `${ctx.publicUrl().replace(/\/$/, '')}/v/${encodeURIComponent(invoiceNumber)}` });

    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.insertSale(sale, 'pending');
      for (const it of items) ctx.db.adjustLocalStock(it.productId, sale.branchId, -it.quantity);
      if (input.type === 'credit' && customer) ctx.db.upsertCustomer({ ...customer, balance: round2(customer.balance + accountIncrease), updatedAt: now });
      ctx.db.enqueue({ opId, type: 'sale', createdAt: now, summary: `${invoiceNumber} · ${total}`, payload: { ...input, taxSnapshot: zeroTaxSnapshot(s.invoice.taxSnapshot), invoiceDiscount, invoiceNumber, date: now, branchId: sale.branchId, cashierId: sale.cashierId, terminalId: sale.terminalId, localId } });
    });
    txn();
    await afterEnqueue(opId);
    return ctx.db.sale(localId) ?? sale;
  }

  /**
   * Offline mirror of sales/service.ts createReturn: caps each line at what is still unreturned,
   * puts the stock back, books a cash refund against the drawer, and reduces the debt on a credit refund.
   */
  async function createSaleReturn(input: SaleReturnCreateInput): Promise<SaleReturn> {
    const sale = ctx.db.sale(input.saleId);
    if (!sale) throw new Error('SALE_NOT_FOUND');
    if (sale.status === 'cancelled' || sale.status === 'held') throw new Error('SALE_NOT_RETURNABLE');
    if (sale.syncStatus === 'failed') throw new Error('RECONCILIATION_REQUIRED');
    const history = ctx.db.returnsForSale(sale.id);
    if (history.some(r => r.status === 'rejected') || (sale.items.some(i => i.returnedQty > 0) && !history.length)) throw new Error('RECONCILIATION_REQUIRED');
    let refundable = round2(Math.max(0, sale.total - history.reduce((sum, r) => sum + r.value.refundAmount, 0)));
    const now = new Date().toISOString();
    const nextItems = sale.items.map((i) => ({ ...i }));
    const items: SaleReturnItem[] = [];
    for (const r of input.items) {
      const si = nextItems.find((x) => x.id === r.saleItemId);
      if (!si) throw new Error('SALE_ITEM_NOT_FOUND');
      if (si.returnedQty + r.quantity > si.quantity) throw new Error('RETURN_QTY_EXCEEDED');
      const maxRefund = maxRefundFor(sale, si, r.quantity);
      si.returnedQty = round2(si.returnedQty + r.quantity);
      const refund = Math.min(r.refund > 0 ? Math.min(round2(r.refund), maxRefund) : maxRefund, refundable);
      refundable = round2(refundable - refund);
      items.push({ saleItemId: si.id, productId: si.productId, quantity: r.quantity, unitPrice: si.unitPrice, refund, reason: r.reason });
    }
    const refundAmount = round2(items.reduce((a, i) => a + i.refund, 0));
    const priorPayout = round2(history.reduce((sum, r) => sum + returnPayout(r.value), 0));
    const debtReduction = input.settlement === 'debt_first' ? round2(Math.min(refundAmount, Math.max(0, sale.remaining))) : input.refundMethod === 'credit' ? refundAmount : 0;
    const payoutAmount = round2(refundAmount - debtReduction);
    if (input.refundMethod === 'credit' ? sale.type !== 'credit' || payoutAmount > 0 || debtReduction > sale.remaining : payoutAmount > round2(sale.paid - priorPayout)) throw new Error('REFUND_RECONCILIATION_REQUIRED');
    // Local only: the server assigns the real RET-nnnnn on apply.
    const returnNumber = `RET-L${Date.now().toString(36).toUpperCase()}`;
    const ret: SaleReturn = { id: newId('lret'), returnNumber, saleId: sale.id, invoiceNumber: sale.invoiceNumber, date: now, branchId: sale.branchId, userId: ctx.userId(), customerId: sale.customerId, items, refundAmount, refundMethod: input.refundMethod, debtReduction, payoutAmount, notes: input.notes };
    const updatedSale: Sale = { ...sale, items: nextItems, status: nextItems.every((i) => i.returnedQty >= i.quantity) ? 'returned' : 'partially_returned' };

    const open = input.refundMethod === 'cash' ? ctx.db.openSession() : null;
    if (input.refundMethod === 'cash' && payoutAmount > 0 && !open) throw new Error('SESSION_CLOSED');
    if (input.refundMethod === 'cash' && input.registerSessionId && input.registerSessionId !== open?.id) throw new Error('SESSION_DENIED');
    ret.registerSessionId = open?.id ?? null;
    const nextSession = open && payoutAmount > 0 ? postMovement(projectSession(open), 'refund', payoutAmount, returnNumber, input.notes, now) : null;
    const customer = sale.type === 'credit' && sale.customerId && debtReduction > 0 ? ctx.db.customers().find((c) => c.id === sale.customerId) : undefined;
    if (debtReduction > 0 && (!customer || customer.financialRestricted || customer.branchId !== ctx.branchId())) throw new Error('RECONCILIATION_REQUIRED');
    const creditReduction = debtReduction;
    if (creditReduction > 0) updatedSale.remaining = round2(sale.remaining - creditReduction);

    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.insertReturn(ret, opId);
      ctx.db.updateSale(updatedSale);
      for (const it of items) ctx.db.adjustLocalStock(it.productId, sale.branchId, it.quantity);
      if (nextSession) ctx.db.upsertSession(nextSession);
      if (customer) ctx.db.upsertCustomer({ ...customer, balance: round2(customer.balance - creditReduction), updatedAt: now });
      ctx.db.enqueue({ opId, type: 'sale_return', createdAt: now, summary: `${sale.invoiceNumber} \u00b7 -${refundAmount}`, payload: { saleId: sale.id, registerSessionId: open?.id, invoiceNumber: sale.invoiceNumber, lineIndexes: input.items.map(item => sale.items.findIndex(line => line.id === item.saleItemId)), items: input.items, customerBalanceDelta: -creditReduction, refundMethod: input.refundMethod, settlement: input.settlement, notes: input.notes, date: now } });
    });
    txn();
    await afterEnqueue(opId);
    return ret;
  }

  async function createCustomer(input: CustomerSaveInput): Promise<Customer> {
    const now = new Date().toISOString();
    const id = newId('lcust');
    const c: Customer = { id, code: `L-${id.slice(-6).toUpperCase()}`, name: input.name, phone: input.phone, whatsapp: input.whatsapp || input.phone, address: input.address ?? { ar: '' }, type: input.type, creditLimit: input.creditLimit, balance: 0, branchId: input.branchId ?? ctx.branchId(), isActive: true, createdAt: now, updatedAt: now, notes: input.notes };
    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.upsertCustomer(c);
      ctx.db.enqueue({ opId, type: 'customer_create', createdAt: now, summary: `${c.name.ar}`, payload: { ...input, id } });
    });
    txn();
    await afterEnqueue(opId);
    return c;
  }

  /**
   * Cash sales live in the sales table, not in the session row, so the stored `cashSales` is stale as
   * soon as a sale is rung up. Every drawer figure is derived through here.
   */
  function projectSession(open: RegisterSession): RegisterSession {
    // A returned invoice still took its cash at the till; the refund is deducted through the refunds bucket.
    const settlementRows = ctx.db.db.prepare('SELECT sale_id, doc FROM rejected_settlements').all() as { sale_id: string; doc: string }[];
    const settlements = new Map(settlementRows.map(row => [row.sale_id, JSON.parse(row.doc) as { method: string; payoutAmount: number }]));
    // Rejection does not pay collected tender back. Keep it until explicit settlement evidence exists.
    const sales = ctx.db.salesForSession(open.id).filter((s) => s.status !== 'held' && (s.status !== 'cancelled' || settlements.has(s.id)));
    // Net rejected settlements here, rather than adding to a stored refund bucket again on every projection.
    const cashSales = round2(sales.reduce((a, s) => a + s.payments.filter((p) => p.method === 'cash').reduce((x, p) => x + p.amount, 0) - s.change - (settlements.get(s.id)?.method === 'cash' ? settlements.get(s.id)!.payoutAmount : 0), 0));
    const cardSales = round2(sales.reduce((a, s) => a + s.payments.filter((p) => p.method === 'card').reduce((x, p) => x + p.amount, 0), 0));
    const transferSales = round2(sales.reduce((a, s) => a + s.payments.filter((p) => p.method === 'bank_transfer').reduce((x, p) => x + p.amount, 0), 0));
    const next: RegisterSession = { ...open, cashSales, cardSales, transferSales };
    return { ...next, expectedCash: expectedCashOf(next) };
  }

  /** Applies a movement to the local open session so the drawer total is right before the push lands. */
  function postMovement(open: RegisterSession, type: CashMovementType, amount: number, reference: string, notes: string | undefined, now: string): RegisterSession {
    const mv: CashMovement = { id: newId('cm'), sessionId: open.id, type, amount, method: 'cash', date: now, reference, userId: ctx.userId(), notes };
    const buckets = applyCashMovement(open, type, amount);
    const next: RegisterSession = { ...open, ...buckets, movements: [...(open.movements ?? []), mv] };
    next.expectedCash = expectedCashOf(next);
    return next;
  }

  async function addCashMovement(input: { type: CashMovementType; amount: number; notes?: string }): Promise<RegisterSession> {
    const raw = ctx.db.openSession();
    if (!raw) throw new Error('SESSION_NOT_OPEN');
    const open = projectSession(raw);
    const now = new Date().toISOString();
    const next = postMovement(open, input.type, input.amount, input.type.toUpperCase(), input.notes, now);
    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.upsertSession(next);
      ctx.db.enqueue({ opId, type: 'cash_movement', createdAt: now, summary: `${input.type} ${input.amount}`, payload: { sessionId: open.id, type: input.type, amount: input.amount, notes: input.notes } });
    });
    txn();
    await afterEnqueue(opId);
    return next;
  }

  async function recordCustomerPayment(input: { customerId: string; amount: number; method: PaymentMethod; notes?: string; reference?: string }): Promise<CustomerPayment> {
    const customer = ctx.db.customers().find((c) => c.id === input.customerId);
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
    if (customer.financialRestricted || customer.branchId !== ctx.branchId()) throw new Error('BRANCH_DENIED');
    const now = new Date().toISOString();
    const reference = input.reference || `RCPT-L${Date.now().toString(36).toUpperCase()}`;
    const payment: CustomerPayment = { id: newId('lcpay'), customerId: input.customerId, debtId: null, saleId: null, date: now, amount: input.amount, method: input.method, reference, userId: ctx.userId(), branchId: ctx.branchId(), notes: input.notes };
    // The server books a payment_in movement for cash receipts, so mirror it here instead of queueing a second op.
    const open = input.method === 'cash' ? ctx.db.openSession() : null;
    const nextSession = open ? postMovement(projectSession(open), 'payment_in', input.amount, reference, input.notes, now) : null;
    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.upsertCustomer({ ...customer, balance: round2(customer.balance - input.amount), updatedAt: now });
      if (nextSession) ctx.db.upsertSession(nextSession);
      ctx.db.enqueue({ opId, type: 'customer_payment', createdAt: now, summary: `${reference} \u00b7 ${input.amount}`, payload: { customerId: input.customerId, debtId: null, amount: input.amount, method: input.method, reference, branchId: ctx.branchId(), notes: input.notes, date: now } });
    });
    txn();
    await afterEnqueue(opId);
    return payment;
  }

  async function openSession(input: { registerId: string; openingBalance: number }): Promise<RegisterSession> {
    const now = new Date().toISOString();
    const id = `sess-${uuid()}`;
    const sess: RegisterSession = { id, registerId: input.registerId, branchId: ctx.branchId(), userId: ctx.userId(), openedAt: now, closedAt: null, openingBalance: input.openingBalance, cashSales: 0, cardSales: 0, transferSales: 0, paymentsIn: 0, paymentsOut: 0, expenses: 0, refunds: 0, expectedCash: input.openingBalance, actualCash: null, difference: null, status: 'open', movements: [] };
    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.upsertSession(sess);
      ctx.db.enqueue({ opId, type: 'register_open', createdAt: now, summary: `OPEN ${input.openingBalance}`, payload: { registerId: input.registerId, openingBalance: input.openingBalance, sessionId: id } });
    });
    txn();
    await afterEnqueue(opId);
    return sess;
  }

  async function closeSession(input: { sessionId: string; actualCash: number; notes?: string }): Promise<RegisterSession> {
    const now = new Date().toISOString();
    const open = ctx.db.openSession();
    if (!open || open.id !== input.sessionId) throw new Error('SESSION_NOT_OPEN');
    const expected = expectedCashOf(projectSession(open));
    const closed: RegisterSession = { ...projectSession(open), expectedCash: expected, actualCash: input.actualCash, difference: round2(input.actualCash - expected), closedAt: now, status: 'closed', notes: input.notes };
    const opId = uuid();
    const txn = ctx.db.db.transaction(() => {
      ctx.db.upsertSession(closed);
      ctx.db.enqueue({ opId, type: 'register_close', createdAt: now, summary: `CLOSE ${input.actualCash}`, payload: { sessionId: open.id, actualCash: input.actualCash, notes: input.notes } });
    });
    txn();
    await afterEnqueue(opId);
    return closed;
  }

  return { createSale, createSaleReturn, createCustomer, openSession, closeSession, addCashMovement, recordCustomerPayment, projectSession };
}
