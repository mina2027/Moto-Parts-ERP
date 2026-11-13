import type { ID, InvoiceVerification, ListQuery, Paginated, Sale, SaleReturn } from '@/types';
import type { SaleCreateInput, SaleReturnCreateInput } from '@moto/shared';
import type { SaleQuery } from '@moto/api-client';
import { api } from './api';
import { retryableWrite } from '@/lib/retryableWrite';

export type { SaleQuery };
export type CreateSaleInput = SaleCreateInput;

export const salesService = {
  list: (q: SaleQuery = {}): Promise<Paginated<Sale>> => api.sales.list(q),
  get: (id: ID): Promise<Sale> => api.sales.get(id),
  findByInvoiceNumber: (num: string): Promise<Sale | null> => api.sales.findByInvoiceNumber(num),
  held: (branchId: ID): Promise<Sale[]> => api.sales.held(branchId),
  create: (input: CreateSaleInput, idempotencyKey?: string): Promise<Sale> => api.sales.create(input, idempotencyKey),
  resumeHeld: (id: ID): Promise<Sale> => api.sales.resumeHeld(id),
  cancel: (id: ID, _userId?: ID, refundMethod?: import('@moto/shared').PaymentMethod, registerSessionId?: string): Promise<Sale> => api.sales.cancel(id, refundMethod, registerSessionId),
  returns: (q: ListQuery = {}): Promise<Paginated<SaleReturn>> => api.sales.returns(q),
  createReturn: (input: SaleReturnCreateInput & { userId?: ID }): Promise<SaleReturn> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return retryableWrite(`erp:return:${rest.saleId}`, rest, key => api.sales.createReturn(rest, key));
  },
  stats: (branchId?: ID) => api.sales.stats(branchId),
  verify: (id: ID): Promise<InvoiceVerification> => api.sales.verifyPublic(id),
};
