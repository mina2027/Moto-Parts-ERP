import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, PAPER_SIZES, defaultPrintProfiles, type PaperKind, type PrintProfile, type Product, type Sale } from '@moto/shared';
import { PosLocaleContext } from '../i18n';
import { InvoiceDocument, pageStyleFor } from './templates';
import { checkoutProfileForSize, profileForSize } from './profiles';

const sale: Sale = {
  id: 's1',
  invoiceNumber: 'INV-1001',
  date: '2026-02-03T11:30:00.000Z',
  branchId: 'br-1',
  cashierId: 'usr-1',
  customerId: null,
  registerSessionId: null,
  items: [
    { id: 'i1', productId: 'p1', name: { ar: 'بستم CG125' }, barcode: 'MP000011', sku: 'SKU-1', partNumber: 'HND-13011', quantity: 2, listPrice: 350, unitPrice: 350, unitCost: 220, priceTier: 'retail1', discount: 0, discountPercent: 0, subtotal: 700, returnedQty: 0 },
    { id: 'i2', productId: 'p2', name: { ar: 'تيل فرامل أمامي' }, barcode: 'MP000022', sku: 'SKU-2', partNumber: 'HND-06430', quantity: 1, listPrice: 85, unitPrice: 85, unitCost: 45, priceTier: 'wholesale', discount: 5, discountPercent: 0, subtotal: 80, returnedQty: 0 },
  ],
  subtotal: 785,
  itemDiscounts: 5,
  invoiceDiscount: 0,
  tax: 0,
  total: 780,
  paid: 800,
  remaining: 0,
  change: 20,
  payments: [{ method: 'cash', amount: 800 }],
  type: 'cash',
  status: 'completed',
};

const profileFor = (paper: PaperKind, extra: Partial<PrintProfile> = {}): PrintProfile => ({
  ...defaultPrintProfiles().find((x) => x.paper === paper)!,
  ...extra,
});

const papers: PaperKind[] = ['thermal80', 'a4'];

describe('invoice templates across every paper size', () => {
  it.each([
    ['a4', 'compact', 'ar'], ['a4', 'detailed', 'ar'],
    ['a4', 'compact', 'en'], ['a4', 'detailed', 'en'],
    ['thermal80', 'compact', 'ar'], ['thermal80', 'detailed', 'en'],
  ] as const)('prints brand and category columns only on %s in %s mode (%s)', (paper, detail, locale) => {
    const product: Product = {
      id: 'p1', name: sale.items[0]!.name, internalBarcode: 'MP000011', sku: 'SKU-1', partNumber: 'HND-13011',
      brandId: 'brand1', categoryId: 'category1', categoryIds: ['category1', 'category2'], supplierId: '',
      purchasePrice: 220, lastPurchaseCost: 220, prices: { retail1: 350, retail2: 350, wholesale: 350 },
      minStock: 0, unit: { ar: 'قطعة' }, compatibleModelIds: [], alternativeProductIds: [], isActive: true, createdAt: '', updatedAt: '',
    };
    const brand = { id: 'brand1', name: { ar: 'ماركة الاختبار', en: 'Test brand' }, country: { ar: '' } };
    const categories = [
      { id: 'category1', name: { ar: 'فئة أولى', en: 'First category' }, parentId: null, ancestors: [], sortOrder: 0, isActive: true },
      { id: 'category2', name: { ar: 'فئة ثانية', en: 'Second category' }, parentId: null, ancestors: [], sortOrder: 1, isActive: true },
    ];
    const { container } = render(
      <PosLocaleContext.Provider value={locale}>
        <InvoiceDocument sale={sale} profile={profileFor(paper, { detail })} settings={DEFAULT_SETTINGS}
          products={{ p1: product }} brands={{ brand1: brand }} categories={Object.fromEntries(categories.map((c) => [c.id, c]))} />
      </PosLocaleContext.Provider>,
    );
    const table = container.querySelector('table')!;
    const cells = table.querySelector('tbody tr')!.querySelectorAll('td');
    if (paper === 'a4') {
      const headings = Array.from(table.querySelectorAll('thead th'), (th) => th.textContent);
      expect(headings.slice(2, 4)).toEqual(locale === 'ar' ? ['الماركة', 'الفئة'] : ['Brand', 'Category']);
      expect(cells).toHaveLength(8);
      expect(cells[2]!.textContent).toBe(locale === 'ar' ? 'ماركة الاختبار' : 'Test brand');
      expect(cells[3]!.textContent).toBe(locale === 'ar' ? 'فئة أولى، فئة ثانية' : 'First category, Second category');
      expect(cells[4]!.textContent).toBe('2');
      const missing = table.querySelectorAll('tbody tr')[1]!.querySelectorAll('td');
      expect(missing[2]!.textContent).toBe('—');
      expect(missing[3]!.textContent).toBe('—');
    } else {
      expect(table.querySelectorAll('thead th')).toHaveLength(5);
      expect(table.textContent).not.toContain(locale === 'ar' ? 'ماركة الاختبار' : 'Test brand');
      expect(table.textContent).not.toContain(locale === 'ar' ? 'فئة أولى' : 'First category');
    }
    expect(table.textContent).not.toContain(locale === 'ar' ? 'الباركود / SKU' : 'Barcode / SKU');
    for (const item of sale.items) {
      expect(table.textContent).not.toContain(item.barcode);
      expect(table.textContent).not.toContain(item.sku);
    }
  });

  it('spans all eight columns for an empty large invoice', () => {
    const { container } = render(<InvoiceDocument sale={{ ...sale, items: [] }} profile={profileFor('a4')} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector('.mpi-empty td')!.getAttribute('colspan')).toBe('8');
  });

  it.each(papers)('prints saved multiline invoice notes on %s', (paper) => {
    const notes = 'تسليم غداً\nالاتصال قبل التسليم <script>';
    const { container } = render(<InvoiceDocument sale={{ ...sale, notes }} profile={profileFor(paper)} settings={DEFAULT_SETTINGS} />);
    const section = container.querySelector('.mpi-notes, .mpt-notes')!;
    expect(section.textContent).toContain(notes);
    expect(section.querySelector('script')).toBeNull();
    expect(section.querySelector('div')!.style.whiteSpace).toBe('pre-wrap');
  });
  it.each([
    ['small', 'thermal80', '.mpt', 'width: 80mm', '@page { size: 80mm 240mm; margin: 0mm; }'],
    ['large', 'a4', '.mpi', 'width: 210mm', '@page { size: 210mm 297mm; margin: 0mm; }'],
  ] as const)('renders the %s selection using the saved %s paper dimensions', (size, oldPaper, selector, width, page) => {
    const profile = profileForSize([profileFor(oldPaper)], size, null);
    const { container } = render(<InvoiceDocument sale={sale} profile={profile} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector(selector)).toBeTruthy();
    expect(container.querySelector('style')!.textContent).toContain(width);
    expect(pageStyleFor(profile)).toContain(page);
  });

  it.each(papers)('renders %s with the invoice number, items and total', (paper) => {
    const { container } = render(<InvoiceDocument sale={sale} profile={profileFor(paper)} settings={DEFAULT_SETTINGS} />);
    expect(container.textContent).toContain('INV-1001');
    expect(container.textContent).toContain('بستم CG125');
    expect(container.textContent).toContain('780');
  });

  it.each(papers)('%s declares RTL for Arabic', (paper) => {
    const { container } = render(<InvoiceDocument sale={sale} profile={profileFor(paper)} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
  });

  it.each(papers)('%s pins @page to the real paper dimensions', (paper) => {
    const css = pageStyleFor(profileFor(paper));
    const size = PAPER_SIZES[paper];
    expect(css).toContain(`${size.widthMm}mm`);
    expect(css).toContain(`${size.heightMm === 'auto' ? size.widthMm * 3 : size.heightMm}mm`);
  });

  it('sizes browser roll pages to the measured content height', () => {
    expect(pageStyleFor(profileFor('thermal80'), 420)).toContain('@page { size: 80mm 420mm; margin: 0mm; }');
    expect(pageStyleFor(profileFor('a4'), 420)).toContain('@page { size: 210mm 297mm; margin: 0mm; }');
  });

  it('detailed mode prints the part number, compact mode does not', () => {
    const detailed = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { detail: 'detailed', showPartNumber: true })} settings={DEFAULT_SETTINGS} />);
    expect(detailed.container.textContent).toContain('HND-13011');
    detailed.unmount();

    const compact = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { detail: 'compact', showPartNumber: true })} settings={DEFAULT_SETTINGS} />);
    expect(compact.container.textContent).not.toContain('HND-13011');
  });

  it.each(papers)('%s carries the branded invoice identity', (paper) => {
    const { container } = render(<InvoiceDocument sale={sale} profile={profileFor(paper)} settings={DEFAULT_SETTINGS} />);
    const root = container.querySelector('.mpi, .mpt')!;
    expect(root).toBeTruthy();
    // Shared invoice banner, table heading and grand-total bar.
    expect(container.querySelector('.mpi-banner, .mpt-banner')).toBeTruthy();
    expect(container.querySelector('.mpi-table, .mpt-table')).toBeTruthy();
    expect(container.querySelector('.mpi-grand, .mpt-grand')).toBeTruthy();
    expect(container.textContent).toContain('\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0628\u064a\u0639\u0627\u062a');
  });

  it.each([
    ['checkout', checkoutProfileForSize('small')],
    ['saved compact', profileFor('thermal80', { detail: 'compact', showPartNumber: false, showCompatibility: false })],
  ] as const)('keeps warranty, exchange and item details in the %s small invoice', (_label, profile) => {
    const warrantyNotes = ['الضمان يشمل عيوب الصناعة.', 'الاستبدال خلال 14 يوم مع أصل الفاتورة.'];
    const { container } = render(<InvoiceDocument sale={sale} profile={profile} settings={DEFAULT_SETTINGS} store={{ warrantyNotes }} />);
    const receipt = container.querySelector('.mpt')!;
    for (const note of warrantyNotes) expect(receipt.textContent).toContain(note);
    expect(receipt.textContent).toContain('HND-13011');
    expect(receipt.textContent).not.toContain('MP000011');
    expect(receipt.textContent).toContain('HND-06430');
    expect(receipt.querySelectorAll('.mpt-sign-box')).toHaveLength(1);
    expect(receipt.querySelectorAll('.mpt-sign-line')).toHaveLength(2);
  });

  it('keeps the A4 canvas at full paper size inside narrow preview containers', () => {
    const { container } = render(<InvoiceDocument sale={sale} profile={profileFor('a4')} settings={DEFAULT_SETTINGS} />);
    const css = container.querySelector('style')!.textContent!;
    expect(css).toContain('width: 210mm');
    expect(css).toContain('min-height: 297mm');
    expect(css).toContain('max-width: none');
  });

  it.each(['thermal80'] as const)('%s uses the narrow roll layout', (paper) => {
    const { container } = render(<InvoiceDocument sale={sale} profile={profileFor(paper)} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector('.mpt')).toBeTruthy();
    expect(container.querySelector('.mpi')).toBeNull();
    expect(container.querySelector('style')!.textContent).toContain(`width: ${PAPER_SIZES[paper].widthMm}mm`);
  });
});

describe('company and review stamps', () => {
  it('shows the company stamp on A4 when enabled and hides it when off', () => {
    const on = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showStamp: true })} settings={DEFAULT_SETTINGS} />);
    expect(screen.getByText('توقيع المراجع')).toBeTruthy();
    expect(on.container.querySelector('.mpi-stamp')).toBeTruthy();
    on.unmount();

    const off = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showStamp: false, showReviewStamp: false })} settings={DEFAULT_SETTINGS} />);
    expect(off.container.querySelector('.mpi-stamp')).toBeNull();
    expect(off.container.querySelector('.mpi-reviewed')).toBeNull();
  });

  it('stamps the thermal receipt from the same profile flags', () => {
    const on = render(<InvoiceDocument sale={sale} profile={profileFor('thermal80', { showStamp: true, showReviewStamp: true })} settings={DEFAULT_SETTINGS} />);
    expect(on.container.querySelector('.mpt-stamp')).toBeTruthy();
    expect(on.container.querySelector('.mpt-reviewed')).toBeTruthy();
    on.unmount();

    const off = render(<InvoiceDocument sale={sale} profile={profileFor('thermal80', { showStamp: false, showReviewStamp: false })} settings={DEFAULT_SETTINGS} />);
    expect(off.container.querySelector('.mpt-stamp')).toBeNull();
    expect(off.container.querySelector('.mpt-reviewed')).toBeNull();
  });

  it('shows the review stamp only when the profile asks for it', () => {
    const off = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showReviewStamp: false })} settings={DEFAULT_SETTINGS} />);
    expect(off.container.textContent).not.toContain('تم المراجعة');
    off.unmount();

    render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showReviewStamp: true })} settings={DEFAULT_SETTINGS} />);
    expect(screen.getByText('تم المراجعة')).toBeTruthy();
  });

  it('drives the branded A4 stamps from the profile', () => {
    const off = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showStamp: false, showReviewStamp: false })} settings={DEFAULT_SETTINGS} />);
    expect(off.container.querySelector('.mpi-stamp')).toBeNull();
    expect(off.container.querySelector('.mpi-reviewed')).toBeNull();
    off.unmount();

    const on = render(<InvoiceDocument sale={sale} profile={profileFor('a4', { showStamp: true, showReviewStamp: true })} settings={DEFAULT_SETTINGS} />);
    expect(on.container.querySelector('.mpi-stamp')).toBeTruthy();
    expect(on.container.querySelector('.mpi-reviewed')).toBeTruthy();
  });
});
