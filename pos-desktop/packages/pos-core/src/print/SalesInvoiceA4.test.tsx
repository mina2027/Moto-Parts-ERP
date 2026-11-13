import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, defaultPrintProfiles, type Sale } from '@moto/shared';
import { SalesInvoiceA4 } from './SalesInvoiceA4';
import { InvoiceDocument } from './templates';
import { SAMPLE_INVOICE, SAMPLE_STORE } from '../test/fixtures/sampleInvoice';

describe('SalesInvoiceA4', () => {
  it('renders the sample invoice as a self-contained RTL document', async () => {
    const { container } = render(<SalesInvoiceA4 invoice={SAMPLE_INVOICE} store={SAMPLE_STORE} />);
    const root = container.querySelector('.mpi')!;
    expect(root.getAttribute('dir')).toBe('rtl');
    const styles = root.querySelector('style')!.textContent!;
    expect(styles).toContain('url(data:font/woff2;base64,');
    expect(styles).not.toContain('watermark');
    expect(root.querySelector('.mpi-watermark')).toBeNull();
    expect(screen.getByText('فاتورة مبيعات')).toBeTruthy();
    expect(screen.getAllByText('INV-011550').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(screen.getByText('330.00')).toBeTruthy();
    expect(screen.getByText('870.00 ج.م')).toBeTruthy();
    expect(screen.getByText('130.50 ج.م')).toBeTruthy();
    expect(screen.getAllByText('1,000.50 ج.م')).toHaveLength(2);
    expect(screen.getByText('تم المراجعة')).toBeTruthy();
    expect(screen.getByText('امسح الكود لمشاهدة الفاتورة')).toBeTruthy();
    await screen.findByLabelText('QR code');
  });

  it('hides optional parts and shows the balance due', () => {
    const { container } = render(
      <SalesInvoiceA4 invoice={{ ...SAMPLE_INVOICE, qrUrl: undefined, cashier: undefined, reviewed: false, taxRate: 0, paid: 500 }} store={SAMPLE_STORE} />,
    );
    expect(screen.queryByText('امسح الكود لمشاهدة الفاتورة')).toBeNull();
    expect(screen.queryByText('اسم الكاشير')).toBeNull();
    expect(screen.queryByText('تم المراجعة')).toBeNull();
    expect(container.textContent).not.toContain('الضريبة');
    expect(screen.getByText('370.00 ج.م')).toBeTruthy();
  });

  it('is used by InvoiceDocument for A4 profiles', async () => {
    const profile = defaultPrintProfiles().find((x) => x.paper === 'a4')!;
    const sale: Sale = {
      id: 's1', invoiceNumber: 'INV-9', date: '2025-10-06T10:00:00', branchId: 'b1', cashierId: 'u1', customerId: null, registerSessionId: null,
      items: [{ id: 'i1', productId: 'p1', name: { ar: 'تيل فرامل' }, barcode: '622', sku: 'S', quantity: 1, listPrice: 85, unitPrice: 85, unitCost: 50, priceTier: 'retail1', discount: 0, discountPercent: 0, subtotal: 85, returnedQty: 0 }],
      subtotal: 85, itemDiscounts: 0, invoiceDiscount: 0, tax: 0, total: 85, paid: 85, remaining: 0, change: 0, payments: [{ method: 'cash', amount: 85 }], type: 'cash', status: 'completed',
    };
    const { container } = render(<InvoiceDocument sale={sale} profile={profile} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector('.mpi')).toBeTruthy();
    expect(screen.getByText('تيل فرامل')).toBeTruthy();
    await screen.findByLabelText('QR code');
  });
});
