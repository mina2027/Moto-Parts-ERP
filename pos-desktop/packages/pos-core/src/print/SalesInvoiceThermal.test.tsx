import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { SalesInvoiceThermal } from './SalesInvoiceThermal';
import { SAMPLE_INVOICE, SAMPLE_STORE } from '../test/fixtures/sampleInvoice';

describe('SalesInvoiceThermal', () => {
  it('preserves the full invoice details even for callers using the legacy compact prop', () => {
    const invoice = {
      ...SAMPLE_INVOICE,
      customer: { ...SAMPLE_INVOICE.customer, id: 'CUS-123', saleType: 'credit' as const, balance: 200 },
      terminal: 'POS-2',
      items: [{ ...SAMPLE_INVOICE.items[0], discount: 5, note: 'رقم القطعة: PART-123' }],
      invoiceDiscount: 10,
      paid: 0,
    };
    const store = { ...SAMPLE_STORE, taxNumber: 'TAX-123', warrantyNotes: ['ضمان عيوب الصناعة.', 'الاستبدال بأصل الفاتورة.'] };
    const { container } = render(<SalesInvoiceThermal invoice={invoice} store={store} compact />);
    const receipt = container.querySelector('.mpt')!;
    const styles = receipt.querySelector('style')!.textContent!;
    expect(styles).toContain('filter: grayscale(1)');
    expect(styles).toContain('filter: grayscale(1) contrast(1.15)');
    expect(styles).not.toContain('#FFF8E1');
    expect(styles).not.toContain('watermark');
    expect(receipt.querySelector('.mpt-watermark')).toBeNull();
    for (const detail of [invoice.number, invoice.branch, invoice.cashier, invoice.terminal,
      invoice.items[0].note, store.slogan, store.taxNumber, ...store.warrantyNotes,
      ...store.brandLogos.map(brand => brand.name)]) {
      expect(receipt.textContent).toContain(detail);
    }
    expect(receipt.textContent).not.toContain(invoice.items[0].sku);
    expect(receipt.textContent).toContain('آجل');
    expect(receipt.textContent).toContain('200.00 ج.م');
    expect(receipt.textContent).toContain('-5.00 ج.م');
    expect(receipt.textContent).toContain('-10.00 ج.م');
    expect(receipt.textContent).toContain('17.25 ج.م');
    expect(receipt.querySelector('.mpt-warranty li')!.textContent).toBe(store.warrantyNotes[0]);
    expect(receipt.querySelectorAll('.mpt-sign-box')).toHaveLength(1);
    expect(receipt.querySelector('.mpt-reviewed')).toBeTruthy();
  });
});
