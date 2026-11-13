import { z } from 'zod';
import type { AppSettings, Session } from '@moto/shared';
import type { DisplaySettings, DisplayState } from '../shared/display';
import { assertBoundedData } from './ipcValidation';
const name = z.object({ ar: z.string().max(10000), en: z.string().max(10000).optional() });
const state = z.object({
  lines: z.array(z.object({ productId: z.string().min(1).max(256), name, quantity: z.number().finite().positive(), unitPrice: z.number().finite().nonnegative(), discountPercent: z.number().finite().min(0).max(100), discount: z.number().finite().nonnegative().optional() })).max(1000),
  invoiceDiscount: z.number().finite().nonnegative(), customer: z.object({ name }).nullable(), lastSaleId: z.string().max(256).nullable(),
});
export function projectDisplayState(value: unknown): DisplayState {
  assertBoundedData(value);
  const parsed = state.safeParse(value);
  if (!parsed.success) throw new Error('INVALID_DISPLAY_STATE');
  return parsed.data;
}
export function projectDisplaySettings(value: AppSettings): DisplaySettings {
  return { company: { name: value.company.name }, currency: value.currency, invoice: { showTax: value.invoice.showTax, taxRate: value.invoice.taxRate } };
}
export function projectSession(session: Session | null) {
  return session ? { user: session.user, permissions: session.permissions, expiresAt: session.expiresAt } : null;
}
