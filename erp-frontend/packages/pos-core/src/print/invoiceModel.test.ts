import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultPrintProfiles, type Sale } from '@moto/shared';
import { posAr } from '../i18n';
import { computeInvoiceTotals, formatCurrency, formatInvoiceDate, invoiceFromSale, storeProfileFrom } from './invoiceModel';
import { SAMPLE_INVOICE } from '../test/fixtures/sampleInvoice';

describe('computeInvoiceTotals', () => {
  it('computes the reference invoice consistently (tax included in the grand total)', () => {
    const t = computeInvoiceTotals(SAMPLE_INVOICE);
    expect(t.lineTotals).toEqual([30, 60, 330, 95, 270, 85]);
    expect(t.subtotal).toBe(870);
    expect(t.invoiceDiscount).toBe(0);
    expect(t.tax).toBe(130.5);
    expect(t.grandTotal).toBe(1000.5);
    expect(t.remaining).toBe(0);
    expect(t.change).toBe(0);
    expect(t.qty).toBe(7);
  });

  it('applies line discounts, then the invoice discount, then tax on the taxable amount', () => {
    const t = computeInvoiceTotals({
      items: [
        { name: 'a', sku: '1', qty: 3, unitPrice: 33.33, discount: 4.99 },
        { name: 'b', sku: '2', qty: 1, unitPrice: 100, discount: 10 },
      ],
      invoiceDiscount: 15,
      taxRate: 0.14,
      paid: 100,
    });
    expect(t.lineTotals).toEqual([95, 90]);
    expect(t.itemDiscounts).toBe(14.99);
    expect(t.subtotal).toBe(185);
    expect(t.taxable).toBe(170);
    expect(t.tax).toBe(23.8);
    expect(t.grandTotal).toBe(193.8);
    expect(t.remaining).toBe(93.8);
    expect(t.change).toBe(0);
  });

  it('reports change when overpaid and never goes negative', () => {
    const t = computeInvoiceTotals({ items: [{ name: 'x', sku: '', qty: 1, unitPrice: 50, discount: 80 }], invoiceDiscount: 999, taxRate: 0.15, paid: 20 });
    expect(t.lineTotals).toEqual([0]);
    expect(t.invoiceDiscount).toBe(0);
    expect(t.grandTotal).toBe(0);
    expect(t.remaining).toBe(0);
    expect(t.change).toBe(20);
  });

  it('treats non-finite input as zero', () => {
    const t = computeInvoiceTotals({ items: [{ name: 'x', sku: '', qty: Number.NaN, unitPrice: 10, discount: 0 }], taxRate: Number.NaN, paid: Number.NaN });
    expect(t.grandTotal).toBe(0);
    expect(t.paid).toBe(0);
  });
});

describe('formatting', () => {
  it('formats currency with symbol position and decimals', () => {
    expect(formatCurrency(1000.5, { symbol: 'ج.م' })).toBe('1,000.50 ج.م');
    expect(formatCurrency(12, { symbol: 'EGP', decimals: 0, position: 'before' })).toBe('EGP 12');
  });

  it('formats date and 12-hour time with localized marker', () => {
    expect(formatInvoiceDate('2025-10-06T15:55:00', 'ar')).toEqual({ date: '2025/10/06', time: '03:55 م' });
    expect(formatInvoiceDate('2025-10-06T00:05:00', 'en')).toEqual({ date: '2025/10/06', time: '12:05 AM' });
    expect(formatInvoiceDate('bad', 'ar').date).toBe('—');
  });
});

describe('invoiceFromSale', () => {
  const profile = defaultPrintProfiles().find((x) => x.paper === 'a4')!;
  const sale: Sale = {
    id: 's1', invoiceNumber: 'INV-000123', date: '2025-10-06T15:55:00', branchId: 'b1', cashierId: 'u1', customerId: null, registerSessionId: null,
    items: [
      { id: 'i1', productId: 'p1', name: { ar: 'بوجيه' }, barcode: '4721300265985', sku: 'SKU-1', partNumber: 'CR7HSA', quantity: 2, listPrice: 60, unitPrice: 60, unitCost: 40, priceTier: 'retail1', discount: 10, discountPercent: 8.33, subtotal: 110, returnedQty: 0 },
    ],
    subtotal: 120, itemDiscounts: 10, invoiceDiscount: 10, tax: 14, total: 114, paid: 114, remaining: 0, change: 6,
    payments: [{ method: 'cash', amount: 120 }], type: 'cash', status: 'completed',
  };
  const settings = { ...DEFAULT_SETTINGS, invoice: { ...DEFAULT_SETTINGS.invoice, showTax: true, taxRate: 14 } };

  it('maps sale fields and keeps stored totals authoritative', () => {
    const inv = invoiceFromSale({ sale, profile, settings }, 'ar', posAr);
    expect(inv.items[0]).toMatchObject({ name: 'بوجيه', sku: '4721300265985', qty: 2, unitPrice: 60, discount: 10 });
    expect(inv.items[0]!.note).toContain('CR7HSA');
    expect(inv.customer.name).toBe(posAr.walkIn);
    expect(inv.paymentMethod).toBe(posAr.cash);
    expect(inv.qrUrl).toBe('/v/INV-000123');
    const t = computeInvoiceTotals(inv);
    expect(t.tax).toBe(sale.tax);
    expect(t.grandTotal).toBe(sale.total);
    expect(t.change).toBe(sale.change);
  });

  it('falls back to the effective tax rate when settings changed after the sale', () => {
    const later = { ...settings, invoice: { ...settings.invoice, taxRate: 20 } };
    const inv = invoiceFromSale({ sale, profile, settings: later }, 'ar', posAr);
    expect(computeInvoiceTotals(inv).grandTotal).toBe(sale.total);
  });

  it('does not print the price type in item notes', () => {
    const inv = invoiceFromSale({ sale: { ...sale, items: [{ ...sale.items[0]!, priceTier: 'wholesale' }] }, profile, settings }, 'ar', posAr);
    expect(inv.items[0]!.note).not.toContain(posAr.receipt.tier);
  });

  it('respects profile flags', () => {
    const inv = invoiceFromSale({ sale, profile: { ...profile, showQr: false, showCashier: false, detail: 'compact' }, settings, cashier: null }, 'ar', posAr);
    expect(inv.qrUrl).toBeUndefined();
    expect(inv.cashier).toBeUndefined();
    expect(inv.items[0]!.note).toBeUndefined();
  });

  it('builds the store profile from settings with overrides', () => {
    const store = storeProfileFrom({ settings, profile, store: { phones: ['+249 1'] } }, 'ar', posAr);
    expect(store.name).toBe(settings.company.name.ar);
    expect(store.phones).toEqual(['+249 1']);
    expect(store.warrantyNotes).toEqual([]);
    expect(store.taxNumber).toBeUndefined();
  });
});
