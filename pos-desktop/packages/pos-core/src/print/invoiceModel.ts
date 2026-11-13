import type { Locale, LocalizedText, PaymentMethod } from '@moto/shared';
import { productCategoryIds, round2, tx } from '@moto/shared';
import type { PosTranslations } from '../i18n';
import type { PrintContext } from './templates';

export type InvoiceSaleType = 'cash' | 'credit';

export interface InvoiceLine {
  name: string;
  /** Catalog details displayed on the large invoice only. */
  brandName?: string;
  categoryName?: string;
  /** Barcode or SKU retained for item identification. */
  sku: string;
  qty: number;
  unitPrice: number;
  /** Discount amount for the whole line (not per unit). */
  discount: number;
  /** Optional secondary line under the item name (part number, fitment…). */
  note?: string;
}

export interface InvoiceCurrency {
  symbol: string;
  decimals?: number;
  position?: 'before' | 'after';
}

export interface Invoice {
  number: string;
  issuedAt: string;
  branch: string;
  /** Omit to hide the cashier row. */
  cashier?: string;
  /** POS terminal code; omit to hide the row. */
  terminal?: string;
  customer: { name: string; id?: string; saleType: InvoiceSaleType; balance?: number };
  items: InvoiceLine[];
  /** Invoice-level discount applied after line discounts. */
  invoiceDiscount?: number;
  /** Fraction, e.g. 0.15 for 15%. */
  taxRate: number;
  /** Amount tendered by the customer. */
  paid: number;
  paymentMethod: string;
  notes?: string;
  /** Omit to hide the QR code. */
  qrUrl?: string;
  showBarcode?: boolean;
  /** Shows the "reviewed" stamp in the reviewer signature box. */
  reviewed?: boolean;
  /** Shows the round company stamp between the signature boxes. */
  stamped?: boolean;
  currency: InvoiceCurrency;
}

export interface BrandMark {
  name: string;
  color: string;
  logoUrl?: string;
}

export interface StoreProfile {
  name: string;
  subtitle: string;
  tagline: string;
  phones: string[];
  address: string;
  logoUrl?: string;
  taxNumber?: string;
  brandLogos: BrandMark[];
  slogan: string;
  warrantyNotes: string[];
  thanks: string;
}

export interface InvoiceTotals {
  lineTotals: number[];
  qty: number;
  itemDiscounts: number;
  subtotal: number;
  invoiceDiscount: number;
  taxable: number;
  tax: number;
  grandTotal: number;
  paid: number;
  remaining: number;
  change: number;
}

const money = (n: number) => (Number.isFinite(n) ? n : 0);

/** Line total = qty × unitPrice − discount; tax applies after the invoice discount (mirrors the API). */
export function computeInvoiceTotals(inv: Pick<Invoice, 'items' | 'invoiceDiscount' | 'taxRate' | 'paid'>): InvoiceTotals {
  const lineTotals = inv.items.map((l) => round2(Math.max(0, money(l.qty) * money(l.unitPrice) - money(l.discount))));
  const subtotal = round2(lineTotals.reduce((a, b) => a + b, 0));
  const invoiceDiscount = round2(Math.min(subtotal, Math.max(0, money(inv.invoiceDiscount ?? 0))));
  const taxable = round2(subtotal - invoiceDiscount);
  const tax = round2(taxable * Math.max(0, money(inv.taxRate)));
  const grandTotal = round2(taxable + tax);
  const paid = round2(Math.max(0, money(inv.paid)));
  return {
    lineTotals,
    qty: inv.items.reduce((a, l) => a + money(l.qty), 0),
    itemDiscounts: round2(inv.items.reduce((a, l) => a + Math.max(0, money(l.discount)), 0)),
    subtotal,
    invoiceDiscount,
    taxable,
    tax,
    grandTotal,
    paid,
    remaining: round2(Math.max(0, grandTotal - paid)),
    change: round2(Math.max(0, paid - grandTotal)),
  };
}

export function formatAmount(value: number, decimals = 2): string {
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(money(value));
}

export function formatCurrency(value: number, currency: InvoiceCurrency): string {
  const n = formatAmount(value, currency.decimals ?? 2);
  return currency.position === 'before' ? `${currency.symbol} ${n}` : `${n} ${currency.symbol}`;
}

/** Splits an ISO date into `yyyy/MM/dd` and a 12-hour clock with a localized AM/PM marker. */
export function formatInvoiceDate(iso: string, locale: Locale): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: '—', time: '' };
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = d.getHours();
  const marker = locale === 'ar' ? (h < 12 ? 'ص' : 'م') : h < 12 ? 'AM' : 'PM';
  return { date: `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`, time: `${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${marker}` };
}

/** Builds the branded store header/footer from settings, branch and optional overrides. */
export function storeProfileFrom(ctx: Pick<PrintContext, 'settings' | 'branch' | 'profile' | 'store'>, locale: Locale, p: PosTranslations): StoreProfile {
  const { settings, branch, profile } = ctx;
  const t = (v: LocalizedText | null | undefined) => tx(v, locale);
  const phones = [branch?.phone, settings.company.phone].map((x) => x?.trim()).filter((x): x is string => Boolean(x));
  const branchAddress = branch ? [t(branch.city), t(branch.address)].filter(Boolean).join(' - ') : '';
  const base: StoreProfile = {
    name: (locale === 'ar' ? settings.receipt.headerLines[0]?.trim() : '') || t(settings.company.name),
    subtitle: t(settings.receipt.subtitle),
    tagline: t(settings.receipt.tagline),
    phones: Array.from(new Set(phones)),
    address: branchAddress || t(settings.company.address),
    logoUrl: profile.showLogo ? settings.company.logoUrl : undefined,
    taxNumber: settings.company.vatRegistered ? settings.company.taxNumber : undefined,
    brandLogos: settings.receipt.brandLogos,
    slogan: t(settings.receipt.slogan),
    warrantyNotes: settings.receipt.warrantyNotes.map(t).filter(Boolean),
    thanks: t(profile.footer) || p.receipt.thanks,
  };
  return { ...base, ...ctx.store };
}

/** Localized name of a price tier, falling back to the settings labels. */
export function tierLabel(settings: PrintContext['settings'], tier: string, p: PosTranslations, locale: Locale): string {
  const labels = settings.pricing.tierLabels;
  if (tier in labels) return tx(labels[tier as keyof typeof labels], locale);
  return tier === 'special' ? p.special : p.manual;
}

/** Maps a persisted sale to the invoice contract, keeping the sale's stored totals authoritative. */
export function invoiceFromSale(ctx: PrintContext, locale: Locale, p: PosTranslations): Invoice {
  const { sale, settings, profile, customer, cashier, branch } = ctx;
  const t = (v: LocalizedText | null | undefined) => tx(v, locale);
  const detailed = profile.detail === 'detailed';
  const fits = (productId: string) => {
    const ids = ctx.products?.[productId]?.compatibleModelIds ?? [];
    return ids.map((id) => ctx.models?.[id]?.code).filter(Boolean).slice(0, 6).join(', ');
  };
  const items: InvoiceLine[] = sale.items.map((it) => {
    const product = ctx.products?.[it.productId];
    const brandName = product ? t(ctx.brands?.[product.brandId]?.name).trim() || undefined : undefined;
    const categoryName = productCategoryIds(product)
      .map((id) => t(ctx.categories?.[id]?.name).trim()).filter(Boolean)
      .join(locale === 'ar' ? '، ' : ', ') || undefined;
    const notes: string[] = [];
    if (detailed && profile.showPartNumber && it.partNumber) notes.push(`${p.receipt.partNumber}: ${it.partNumber}`);
    if (detailed && profile.showCompatibility && fits(it.productId)) notes.push(`${p.receipt.fits}: ${fits(it.productId)}`);
    return { name: t(it.name), brandName, categoryName, sku: it.barcode || it.sku, qty: it.quantity, unitPrice: it.unitPrice, discount: it.discount, note: notes.join(' · ') || undefined };
  });
  const invoiceDiscount = sale.invoiceDiscount;
  const taxable = round2(computeInvoiceTotals({ items, invoiceDiscount, taxRate: 0, paid: 0 }).taxable);
  let taxRate = sale.tax > 0 ? settings.invoice.taxRate / 100 : 0;
  // Settings may have changed since the sale; fall back to the effective rate so reprints match the stored tax.
  if (taxable > 0 && Math.abs(round2(taxable * taxRate) - sale.tax) > 0.01) taxRate = sale.tax / taxable;
  const methods = Array.from(new Set(sale.payments.filter((x) => x.amount > 0).map((x) => x.method)));
  if (!methods.length) methods.push(sale.type === 'credit' ? 'credit' : 'cash');
  return {
    number: sale.invoiceNumber,
    issuedAt: sale.date,
    branch: t(branch?.name).trim() || ctx.branchName?.trim() || '—',
    cashier: profile.showCashier && cashier ? t(cashier.fullName) : undefined,
    terminal: ctx.terminalCode || undefined,
    customer: {
      name: customer ? t(customer.name) : p.walkIn,
      id: customer?.code,
      saleType: sale.type,
      balance: profile.showCustomerBalance && customer && customer.balance > 0 ? customer.balance : undefined,
    },
    items,
    invoiceDiscount,
    taxRate,
    paid: round2(sale.paid + sale.change),
    paymentMethod: methods.map((m: PaymentMethod) => p[m]).join(' + '),
    notes: sale.notes?.trim() || undefined,
    qrUrl: profile.showQr ? (sale.qrPayload ?? `${ctx.verifyBaseUrl ?? ''}/v/${encodeURIComponent(sale.invoiceNumber)}`) : undefined,
    showBarcode: settings.receipt.showBarcode,
    reviewed: profile.showReviewStamp,
    stamped: profile.showStamp,
    currency: { symbol: t(settings.currency.symbol), decimals: settings.currency.decimals, position: locale === 'ar' ? 'after' : settings.currency.symbolPosition },
  };
}
