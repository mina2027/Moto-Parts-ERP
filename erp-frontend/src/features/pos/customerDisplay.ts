import type { CartLine } from '@moto/pos-core';
import type { AppSettings, Customer, Locale } from '@moto/shared';

export interface DisplaySnapshot {
  lines: CartLine[];
  invoiceDiscount: number;
  customer: Customer | null;
  lastSaleId: string | null;
  settings: AppSettings;
  locale: Locale;
}

export const displayChannelName = (userId: string, branchId: string) => `moto-pos-display.${userId}.${branchId}`;
