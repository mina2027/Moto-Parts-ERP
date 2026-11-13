import type { Branch, CashMovement, CashMovementType, CashRegister, Expense, ExpenseCategory, ID, ListQuery, Paginated, Permission, RegisterSession, Role, RoleKey, User, UserStatus } from '@/types';
import type { BranchSaveInput, UserSaveInput } from '@moto/shared';
import { api } from './api';

export const branchService = {
  list: (): Promise<Branch[]> => api.branches.list(),
  get: (id: ID): Promise<Branch> => api.branches.get(id),
  save: (input: Partial<Branch> & { id?: ID }): Promise<Branch> => api.branches.save(input as BranchSaveInput),
  performance: () => api.branches.performance(),

  users: (q: ListQuery & { role?: RoleKey; status?: UserStatus } = {}): Promise<Paginated<User>> => api.users.list(q),
  allUsers: (): Promise<User[]> => api.users.all(),
  getUser: (id: ID): Promise<User> => api.users.get(id),
  saveUser: (input: Partial<User> & { id?: ID; password?: string }, _actorId?: ID): Promise<User> => api.users.save(input as UserSaveInput),
  roles: (): Promise<Role[]> => api.users.roles(),
  saveRolePermissions: async (key: RoleKey, permissions: Permission[], _actorId?: ID): Promise<boolean> => {
    await api.users.saveRolePermissions(key, permissions);
    return true;
  },

  registers: (branchId?: ID): Promise<CashRegister[]> => api.cash.registers(branchId),
  sessions: (q: ListQuery & { registerId?: ID; status?: 'open' | 'closed' } = {}): Promise<Paginated<RegisterSession>> => api.cash.sessions(q),
  getSession: (id: ID): Promise<RegisterSession> => api.cash.getSession(id),
  openSession: (registerId: ID, _userId: ID, openingBalance: number): Promise<RegisterSession> => api.cash.openSession(registerId, openingBalance),
  addMovement: (sessionId: ID, input: { type: CashMovementType; amount: number; notes?: string; userId?: ID }): Promise<CashMovement> => api.cash.addMovement(sessionId, { type: input.type, amount: input.amount, notes: input.notes }),
  closeSession: (sessionId: ID, actualCash: number, _userId?: ID, notes?: string): Promise<RegisterSession> => api.cash.closeSession(sessionId, actualCash, notes),
  currentSession: (branchId: ID, _userId?: ID): Promise<RegisterSession | null> => api.cash.currentSession(branchId),

  expenseCategories: (): Promise<ExpenseCategory[]> => api.expenses.categories(),
  expenses: (q: ListQuery & { categoryId?: ID; status?: Expense['status'] } = {}): Promise<Paginated<Expense>> => api.expenses.list(q),
  createExpense: (input: Omit<Expense, 'id' | 'code' | 'date' | 'status'>): Promise<Expense> => {
    const { userId: _u, ...rest } = input;
    void _u;
    return api.expenses.create(rest);
  },
  setExpenseStatus: (id: ID, status: Expense['status']): Promise<Expense> => api.expenses.setStatus(id, status),
  expenseStats: (branchId?: ID) => api.expenses.stats(branchId),
};
