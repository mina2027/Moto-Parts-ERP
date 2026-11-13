import type { PaymentMethod } from '@moto/shared';
import { round2 } from '@moto/shared';
import type { LocalDb } from './db/database';

/** A rejected sale never reached the server. Its local stock/debt reversal and payout evidence stay atomic. */
export function settleRejectedSale(db: LocalDb, opId: string, userId: string, branchId: string, settlement?: { method: Exclude<PaymentMethod, 'credit'>; reference: string }) {
  if (!db.outbox().some(row => row.opId === opId && row.status === 'rejected')) throw new Error('OP_NOT_REJECTED');
  const op = db.opPayload(opId);
  if (op?.type !== 'sale') throw new Error('RECONCILIATION_REQUIRED');
  const localId = (op.payload as { localId?: string }).localId;
  if (!localId) throw new Error('RECONCILIATION_REQUIRED');
  const sale = db.sale(localId);
  if (!sale || sale.branchId !== branchId || sale.status === 'cancelled' || sale.syncStatus !== 'failed' || sale.items.some(i => i.returnedQty > 0)) throw new Error('RECONCILIATION_REQUIRED');
  if (sale.paid > 0 && (!settlement || !['cash', 'card', 'bank_transfer'].includes(settlement.method) || !settlement.reference.trim())) throw new Error('REFUND_METHOD_REQUIRED');
  // Cross-method or split payouts need a posted allocation/reconciliation workflow, not an implicit drawer adjustment.
  const tenderMethods = new Set(sale.payments.filter(payment => payment.method !== 'credit' && payment.amount > 0).map(payment => payment.method));
  if (sale.paid > 0 && (tenderMethods.size !== 1 || !tenderMethods.has(settlement!.method))) throw new Error('RECONCILIATION_REQUIRED');
  db.db.transaction(() => {
    db.db.prepare('INSERT INTO rejected_settlements(op_id, sale_id, doc) VALUES (?, ?, ?)').run(opId, sale.id, JSON.stringify({ opId, saleId: sale.id, invoiceNumber: sale.invoiceNumber, userId, branchId, date: new Date().toISOString(), paid: sale.paid, debtReduction: sale.remaining, payoutAmount: sale.paid, method: settlement?.method ?? null, reference: settlement?.reference ?? '', originalPayments: sale.payments, serverRejection: db.outbox().find(row => row.opId === opId)?.error }));
    for (const item of sale.items) db.adjustLocalStock(item.productId, sale.branchId, item.quantity);
    const customer = sale.type === 'credit' && sale.customerId ? db.customers().find(c => c.id === sale.customerId) : undefined;
    if (sale.remaining > 0 && (!customer || customer.financialRestricted || customer.branchId !== branchId)) throw new Error('RECONCILIATION_REQUIRED');
    if (customer) db.upsertCustomer({ ...customer, balance: round2(customer.balance - sale.remaining) });
    db.cancelLocalSale(sale.id);
    db.updateSale({ ...sale, status: 'cancelled', syncStatus: 'failed', remaining: 0 });
    db.deleteOp(opId);
  })();
}
