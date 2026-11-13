import type { AccountingSummary, Alert, AppNotification, AuditAction, AuditLog, DashboardData, DeadStockReport, DeadStockSnapshot, ID, ListQuery, Paginated } from '@/types';
import type { DeadStockQuery } from '@moto/shared';
import type { RangeFilter } from '@moto/api-client';
import { api } from './api';

export type DatePreset = 'today' | 'yesterday' | 'week' | 'month' | 'custom';
export type { RangeFilter };

export function presetRange(preset: DatePreset): { from: string; to: string } {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (preset === 'yesterday') {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === 'week') start.setDate(start.getDate() - 6);
  else if (preset === 'month') start.setDate(start.getDate() - 29);
  return { from: start.toISOString(), to: end.toISOString() };
}

export const reportService = {
  dashboard: (f: RangeFilter): Promise<DashboardData> => api.reports.dashboard(f),
  accounting: (f: RangeFilter): Promise<AccountingSummary> => api.reports.accounting(f),
  salesReport: (f: RangeFilter & { cashierId?: ID; customerId?: ID; groupBy?: 'day' | 'cashier' | 'branch' | 'product' | 'category' | 'tier' }) => api.reports.sales(f),
  employeePerformance: (f: RangeFilter) => api.reports.employeePerformance(f),
  deadStock: (q: Partial<DeadStockQuery>): Promise<DeadStockReport> => api.reports.deadStock(q),
  deadStockSnapshots: (branchId?: ID): Promise<DeadStockSnapshot[]> => api.reports.deadStockSnapshots(branchId),
  auditLogs: (q: ListQuery & { userId?: ID; action?: AuditAction; entity?: string } = {}): Promise<Paginated<AuditLog>> => api.reports.auditLogs(q),
  notifications: (): Promise<AppNotification[]> => api.notifications.list(),
  markAllRead: async (): Promise<boolean> => {
    await api.notifications.markAllRead();
    return true;
  },
  markRead: async (id: ID): Promise<boolean> => {
    await api.notifications.markRead(id);
    return true;
  },
  alerts: (q: ListQuery & { unread?: boolean; severity?: string; type?: string; resolved?: boolean } = {}): Promise<Paginated<Alert>> => api.notifications.alerts(q),
  alertSummary: () => api.notifications.alertSummary(),
  readAlert: (id: ID): Promise<Alert> => api.notifications.readAlert(id),
  resolveAlert: (id: ID): Promise<Alert> => api.notifications.resolveAlert(id),
  readAllAlerts: () => api.notifications.readAllAlerts(),
  globalSearch: (term: string) => api.reports.globalSearch(term),
};
