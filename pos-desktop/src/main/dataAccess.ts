import type { Customer, Permission, Session } from '@moto/shared';
import { customerVisibleInBranch, projectCustomer, visibleCosts } from '@moto/shared';
import { validateDataArg } from './ipcValidation';
const requirements: Record<string, Permission[]> = {
  salesHistory: ['sales.view'],
  createSale: ['sales.create'], createSaleReturn: ['returns.create'], createCustomer: ['customers.edit', 'sales.create'],
  recordCustomerPayment: ['customers.credit', 'sales.create'], openSession: ['cash.open'], closeSession: ['cash.close'], addCashMovement: ['cash.open', 'cash.close', 'sales.create'],
  saveQuickProduct: ['settings.edit', 'settings.quick_grid'], deleteQuickProduct: ['settings.edit', 'settings.quick_grid'], reorderQuick: ['settings.edit', 'settings.quick_grid'], requestTransfer: ['inventory.transfer'],
};
export async function invokeData(handlers: Record<string, (arg: never) => unknown | Promise<unknown>>, session: Session | null, branchId: string, method: string, arg: unknown) {
  if (!session) throw new Error('AUTH_REQUIRED');
  if (!Object.hasOwn(handlers, method)) throw new Error('UNKNOWN_DATA_METHOD');
  const required = Object.hasOwn(requirements, method) ? requirements[method] : undefined;
  if (required && !required.some(p => session.permissions.includes(p))) throw new Error('PERMISSION_DENIED');
  let value = await handlers[method](validateDataArg(method, arg, branchId) as never);
  if (method === 'customers') value = (value as Customer[]).filter(c => customerVisibleInBranch(c, branchId)).map(c => projectCustomer(c, branchId));
  if (['sale', 'saleByInvoice', 'currentSession'].includes(method) && value && (value as { branchId: string }).branchId !== branchId) throw new Error('BRANCH_DENIED');
  if (method === 'recentSales') value = (value as { branchId: string }[]).filter(s => s.branchId === branchId);
  return visibleCosts(value, session.permissions);
}
