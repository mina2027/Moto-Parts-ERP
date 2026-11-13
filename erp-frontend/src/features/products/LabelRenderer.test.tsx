import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, defaultLabelTemplate } from '@moto/shared';
import type { Product } from '@/types';
import { LabelRenderer } from './LabelRenderer';

const product = {
  id: 'p1',
  sku: 'SKU-77',
  internalBarcode: '2000000000017',
  name: { ar: 'فلتر زيت', en: 'Oil Filter' },
  categoryId: 'c1',
  brandId: 'b1',
  unit: 'piece',
  cost: 50,
  prices: { retail1: 125, retail2: 110, wholesale: 95 },
  minStock: 1,
  isActive: true,
  compatibleModels: [],
  tags: [],
  createdAt: '',
  updatedAt: '',
} as unknown as Product;

describe('LabelRenderer', () => {
  it.each([203, 300, 600])('keeps physical label dimensions at %s printer DPI', (dpi) => {
    const t = { ...defaultLabelTemplate(), dpi };
    const { container } = render(<LabelRenderer template={t} product={product} settings={DEFAULT_SETTINGS} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('50mm');
    expect(root.style.height).toBe('25mm');
    const name = screen.getByText('فلتر زيت').parentElement!;
    expect(name.style.left).toBe('1mm');
    expect(name.style.fontSize).toBe('7pt');
  });

  it('zooms the designer preview without changing its physical print sizing', () => {
    const t = defaultLabelTemplate();
    const { container } = render(<LabelRenderer template={t} product={product} settings={DEFAULT_SETTINGS} scale={5} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.width).toBe('250px');
    expect(root.style.height).toBe('125px');
    expect(screen.getByText('فلتر زيت').parentElement!.style.left).toBe('5px');
  });

  it('shows company, product name (Arabic), tier price and barcode; hidden elements are skipped', () => {
    const t = defaultLabelTemplate();
    render(<LabelRenderer template={t} product={product} settings={DEFAULT_SETTINGS} />);
    expect(screen.getByText('فلتر زيت')).toBeInTheDocument();
    expect(screen.getByText(/125/)).toBeInTheDocument();
    expect(screen.queryByText('SKU-77')).not.toBeInTheDocument(); // sku element is visible:false by default
    expect(document.querySelector('svg')).not.toBeNull(); // barcode
    expect(screen.getByText('2000000000017')).toBeInTheDocument(); // human-readable code under bars
  });

  it('respects the price tier chosen on the price element and shows custom text', () => {
    const t = defaultLabelTemplate();
    t.elements = t.elements.map((el) => (el.type === 'price' ? { ...el, priceTier: 'wholesale' as const } : el.type === 'customText' ? { ...el, visible: true, text: 'أصلي' } : el));
    render(<LabelRenderer template={t} product={product} settings={DEFAULT_SETTINGS} />);
    expect(screen.getByText(/95/)).toBeInTheDocument();
    expect(screen.queryByText(/125/)).not.toBeInTheDocument();
    expect(screen.getByText('أصلي')).toBeInTheDocument();
  });

  it('prints the storage location and part number when those elements are added', () => {
    const t = defaultLabelTemplate();
    t.elements = [
      ...t.elements,
      { id: 'el-loc', type: 'location', x: 1, y: 20, w: 20, h: 3, fontSize: 5, fontWeight: 400, align: 'start', visible: true },
      { id: 'el-pn', type: 'partNumber', x: 25, y: 20, w: 20, h: 3, fontSize: 5, fontWeight: 400, align: 'end', visible: true },
    ];
    render(<LabelRenderer template={t} product={{ ...product, partNumber: 'HND-15400' }} settings={DEFAULT_SETTINGS} location="رف A · خانة 04" />);
    expect(screen.getByText('رف A · خانة 04')).toBeInTheDocument();
    expect(screen.getByText('HND-15400')).toBeInTheDocument();
  });

  it('leaves the location blank rather than breaking when none is known', () => {
    const t = defaultLabelTemplate();
    t.elements = [...t.elements, { id: 'el-loc', type: 'location', x: 1, y: 20, w: 20, h: 3, fontSize: 5, fontWeight: 400, align: 'start', visible: true }];
    const { container } = render(<LabelRenderer template={t} product={product} settings={DEFAULT_SETTINGS} />);
    expect(container.querySelector('[style*="position: absolute"]')).toBeTruthy();
    expect(screen.getByText('فلتر زيت')).toBeInTheDocument();
  });
});
