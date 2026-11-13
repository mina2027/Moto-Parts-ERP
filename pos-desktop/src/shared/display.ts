import type { AppSettings, LocalizedText } from '@moto/shared';

export type DisplaySettings = Pick<AppSettings, 'currency'> & { company: Pick<AppSettings['company'], 'name'>; invoice: Pick<AppSettings['invoice'], 'showTax' | 'taxRate'> };
export interface DisplayState {
  lines: { productId: string; name: LocalizedText; quantity: number; unitPrice: number; discountPercent: number; discount?: number }[];
  invoiceDiscount: number;
  customer: { name: LocalizedText } | null;
  lastSaleId: string | null;
}
export interface DisplayApi {
  settings(): Promise<DisplaySettings>;
  onState(cb: (state: DisplayState) => void): () => void;
}
