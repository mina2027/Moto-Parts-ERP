import { DEFAULT_SETTINGS } from '@moto/shared';
import type { Invoice, StoreProfile } from '../../print/invoiceModel';

const branding = DEFAULT_SETTINGS.receipt;

/** Test fixture; never exported by the runtime package. */
export const SAMPLE_STORE: StoreProfile = {
  name: 'موتو بارتس',
  subtitle: branding.subtitle.ar,
  tagline: branding.tagline.ar,
  phones: ['+249 123 456 789', '+249 987 654 321'],
  address: 'الخرطوم - شارع الستين، فرع رقم (1)',
  brandLogos: branding.brandLogos,
  slogan: branding.slogan.ar,
  warrantyNotes: branding.warrantyNotes.map((x) => x.ar),
  thanks: 'شكراً لتعاملكم معنا',
};

export const SAMPLE_INVOICE: Invoice = {
  number: 'INV-011550',
  issuedAt: '2025-10-06T15:55:00',
  branch: 'الفرع الرئيسي',
  cashier: 'أحمد محمد',
  customer: { name: 'عميل نقدي', saleType: 'cash' },
  items: [
    { name: 'مقبض يد (فرعدة) مطاط', sku: '6221134059773', qty: 1, unitPrice: 30, discount: 0 },
    { name: 'بوجيه NGK CR7HSA', sku: '4721300265985', qty: 1, unitPrice: 60, discount: 0 },
    { name: 'زيت محرك مرنول 3000 20W50 - 1 لتر', sku: '6233159992608', qty: 2, unitPrice: 165, discount: 0 },
    { name: 'جنيرز كامة CG125 (82) وصلة', sku: '6228622966367', qty: 1, unitPrice: 95, discount: 0 },
    { name: 'جنيرز كامة DID 428 وصلة', sku: '6221963519083', qty: 1, unitPrice: 270, discount: 0 },
    { name: 'تيل فرامل أمامي CG125', sku: '6229297995533', qty: 1, unitPrice: 85, discount: 0 },
  ],
  invoiceDiscount: 0,
  taxRate: 0.15,
  paid: 1000.5,
  paymentMethod: 'نقدي',
  qrUrl: 'https://example.com/v/INV-011550',
  showBarcode: true,
  reviewed: true,
  currency: { symbol: 'ج.م', decimals: 2, position: 'after' },
};
