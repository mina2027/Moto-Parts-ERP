import type { ID, ListQuery, Paginated, PaymentMethod, Purchase, PurchaseReturn, PurchaseStatus, SupplierPayment } from '@/types';
import { api } from './api';

export interface PurchaseQuery extends ListQuery {
  supplierId?: ID;
  status?: PurchaseStatus;
}

export const purchaseService = {
  reimbursements: (purchaseId: string) => api.purchases.reimbursements({ purchaseId }),
  receiveReimbursement: (id: string, input: { reference: string; registerSessionId?: string }, key: string) => api.purchases.receiveReimbursement(id, input, key),
  list: (q: PurchaseQuery = {}): Promise<Paginated<Purchase>> => api.purchases.list(q),
  get: (id: ID): Promise<Purchase> => api.purchases.get(id),
  create: (input: { supplierId: ID; supplierInvoiceNumber: string; branchId: ID; warehouseId: ID; expectedDate?: string; items: { productId: ID; quantity: number; unitCost: number }[]; discount: number; paid: number; userId?: ID; notes?: string; status: 'draft' | 'ordered' }): Promise<Purchase> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.purchases.create(rest);
  },
  receive: (id: ID, quantities: Record<ID, number>, _userId?: ID): Promise<Purchase> => api.purchases.receive(id, quantities),
  cancel: (id: ID, input: { refundMethod?: 'cash' | 'card' | 'bank_transfer' } = {}): Promise<Purchase> => api.purchases.cancel(id, input),
  returns: (q: ListQuery & { supplierId?: ID } = {}): Promise<Paginated<PurchaseReturn>> => api.purchases.returns(q),
  createReturn: (input: { purchaseId: ID; items: { productId: ID; purchaseItemId?: ID; quantity: number; unitCost: number }[]; reason: string; refundMethod?: 'cash' | 'card' | 'bank_transfer'; userId?: ID }, idempotencyKey?: string): Promise<PurchaseReturn> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.purchases.createReturn(rest, idempotencyKey);
  },
  payments: (q: ListQuery & { supplierId?: ID } = {}): Promise<Paginated<SupplierPayment>> => api.purchases.payments(q),
  recordPayment: (input: { supplierId: ID; purchaseId: ID | null; amount: number; method: PaymentMethod; reference: string; userId?: ID; notes?: string }, idempotencyKey?: string): Promise<SupplierPayment> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.purchases.recordPayment(rest, idempotencyKey);
  },
  stats: () => api.purchases.stats(),
};
