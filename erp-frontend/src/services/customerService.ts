import type { Customer, CustomerPayment, CustomerType, DebtStatus, ID, ListQuery, Paginated, PaymentMethod, SpecialPrice, StatementLine } from '@/types';
import type { CustomerSaveInput } from '@moto/shared';
import type { DebtRow } from '@moto/api-client';
import { api } from './api';
import { retryableWrite } from '@/lib/retryableWrite';

export type { DebtRow };

export const customerService = {
  list: (q: ListQuery & { type?: CustomerType; hasDebt?: boolean } = {}): Promise<Paginated<Customer>> => api.customers.list(q),
  all: (): Promise<Customer[]> => api.customers.all(),
  get: (id: ID): Promise<Customer> => api.customers.get(id),
  save: (input: Partial<Customer> & { id?: ID }): Promise<Customer> => api.customers.save(input as CustomerSaveInput),
  summary: (id: ID) => api.customers.summary(id),
  statement: (id: ID): Promise<StatementLine[]> => api.customers.statement(id),
  specialPrices: (customerId?: ID): Promise<SpecialPrice[]> => api.customers.specialPrices(customerId),
  addSpecialPrice: (input: Omit<SpecialPrice, 'id'>): Promise<SpecialPrice> => api.customers.addSpecialPrice(input),
  removeSpecialPrice: async (id: ID): Promise<boolean> => {
    await api.customers.removeSpecialPrice(id);
    return true;
  },
  debts: (q: ListQuery & { customerId?: ID; status?: DebtStatus } = {}): Promise<Paginated<DebtRow>> => api.customers.debts(q),
  debtStats: (branchId?: ID) => api.customers.debtStats(branchId),
  payments: (q: ListQuery & { customerId?: ID; debtId?: ID } = {}): Promise<Paginated<CustomerPayment>> => api.customers.payments(q),
  recordPayment: (input: { customerId: ID; debtId: ID | null; amount: number; method: PaymentMethod; reference: string; userId?: ID; branchId: ID; notes?: string }): Promise<CustomerPayment> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return retryableWrite(`erp:payment:${rest.customerId}`, rest, key => api.customers.recordPayment(rest, key));
  },
};
