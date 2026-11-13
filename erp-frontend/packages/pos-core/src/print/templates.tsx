import * as React from 'react';
import type { AppSettings, Branch, Brand, Category, Customer, MotorcycleModel, PrintProfile, Product, Sale, User } from '@moto/shared';
import { PAPER_SIZES, invoicePageMarginMm, normalizeInvoicePaper } from '@moto/shared';
import { usePosT } from '../i18n';
import { invoiceFromSale, storeProfileFrom, type StoreProfile } from './invoiceModel';
import { SalesInvoiceA4 } from './SalesInvoiceA4';
import { SalesInvoiceThermal } from './SalesInvoiceThermal';

export interface PrintContext {
  sale: Sale;
  profile: PrintProfile;
  settings: AppSettings;
  branch?: Branch | null;
  /** Localized branch name when the host only provides a name lookup. */
  branchName?: string;
  cashier?: User | null;
  customer?: Customer | null;
  /** Product details for catalog labels and compatibility rows. */
  products?: Record<string, Product | undefined>;
  brands?: Record<string, Brand | undefined>;
  categories?: Record<string, Category | undefined>;
  models?: Record<string, MotorcycleModel | undefined>;
  terminalCode?: string;
  verifyBaseUrl?: string;
  /** Overrides for the branded invoice header/footer (name, phones, warranty notes…). */
  store?: Partial<StoreProfile>;
}

function useBranded(ctx: PrintContext) {
  const { p, locale } = usePosT();
  return { invoice: invoiceFromSale(ctx, locale, p), store: storeProfileFrom(ctx, locale, p) };
}

/** Branded A4 sales invoice built from a persisted sale at its original size. */
export const BrandedA4Invoice = React.forwardRef<HTMLDivElement, PrintContext>(function BrandedA4Invoice(ctx, ref) {
  const { invoice, store } = useBranded(ctx);
  return <SalesInvoiceA4 ref={ref} invoice={invoice} store={store} />;
});

/** Same identity as the A4 invoice, laid out for an 80mm roll. */
export const BrandedThermalReceipt = React.forwardRef<HTMLDivElement, PrintContext>(function BrandedThermalReceipt(ctx, ref) {
  // Older saved compact profiles must still carry every item detail on the small invoice.
  const { invoice, store } = useBranded({
    ...ctx,
    profile: { ...ctx.profile, detail: 'detailed', showPartNumber: true, showCompatibility: true },
  });
  return <SalesInvoiceThermal ref={ref} invoice={invoice} store={store} />;
});

/** Picks the right template for the profile. */
export const InvoiceDocument = React.forwardRef<HTMLDivElement, PrintContext>(function InvoiceDocument(ctx, ref) {
  const thermal = normalizeInvoicePaper(ctx.profile.paper) === 'thermal80';
  return thermal ? <BrandedThermalReceipt ref={ref} {...ctx} /> : <BrandedA4Invoice ref={ref} {...ctx} />;
});

/** Roll pages require a numeric height: `80mm auto` is not a valid CSS page size. */
export function pageStyleFor(profile: PrintProfile, rollHeightMm?: number): string {
  const paper = PAPER_SIZES[normalizeInvoicePaper(profile.paper)];
  const heightMm = paper.heightMm === 'auto' ? rollHeightMm ?? paper.widthMm * 3 : paper.heightMm;
  const size = `${paper.widthMm}mm ${heightMm}mm`;
  return `@page { size: ${size}; margin: ${invoicePageMarginMm(paper.widthMm)}mm; } @media print { html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; margin: 0; padding: 0; background: #fff; } }`;
}
