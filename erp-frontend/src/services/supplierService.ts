import type { ID, ListQuery, Paginated, StatementLine, Supplier } from '@/types';
import type { SupplierSaveInput } from '@moto/shared';
import { api } from './api';

export const supplierService = {
  list: (q: ListQuery & { hasBalance?: boolean } = {}): Promise<Paginated<Supplier>> => api.suppliers.list(q),
  all: (): Promise<Supplier[]> => api.suppliers.all(),
  get: (id: ID): Promise<Supplier> => api.suppliers.get(id),
  save: (input: Partial<Supplier> & { id?: ID }): Promise<Supplier> => api.suppliers.save(input as SupplierSaveInput),
  summary: (id: ID) => api.suppliers.summary(id),
  statement: (id: ID): Promise<StatementLine[]> => api.suppliers.statement(id),
  debtOverview: () => api.suppliers.debtOverview(),
};
