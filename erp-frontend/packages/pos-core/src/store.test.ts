import { describe, expect, it } from 'vitest';
import type { Customer } from '@moto/shared';
import { allowedPriceTiers, resolveSalePrice } from '@moto/shared';
import { cartTotals, createPosStore, type CartLine } from './store';

const line = (over: Partial<CartLine> = {}): Omit<CartLine, 'quantity'> & { quantity?: number } => ({
  productId: 'p1',
  name: { ar: 'فلتر' },
  barcode: '2000000000017',
  sku: 'SKU-1',
  listPrice: 100,
  unitPrice: 100,
  unitCost: 50,
  priceTier: 'retail1',
  discountPercent: 0,
  available: 10,
  ...over,
});
const customer = (type: Customer['type']): Customer => ({ id: 'c1', code: 'C1', name: { ar: 'عميل' }, phone: '0100', whatsapp: '0100', address: { ar: '' }, type, creditLimit: 0, balance: 0, branchId: 'br-1', isActive: true, createdAt: '', updatedAt: '' });

describe('pos store — cart & tiers', () => {
  it('preserves invoice notes through restart, hold and switching held invoices', () => {
    const first = createPosStore(undefined, 'invoice-notes');
    first.getState().addLine(line());
    first.getState().setNotes('تسليم غداً\nالاتصال أولاً');
    const restarted = createPosStore(undefined, 'invoice-notes');
    expect(restarted.getState().notes).toBe('تسليم غداً\nالاتصال أولاً');
    restarted.getState().hold();
    const heldId = restarted.getState().held[0].id;
    expect(restarted.getState().notes).toBe('');
    restarted.getState().addLine(line({ productId: 'p2' }));
    restarted.getState().setNotes('ملاحظات العميل الثاني');
    restarted.getState().resume(heldId);
    expect(restarted.getState().notes).toBe('تسليم غداً\nالاتصال أولاً');
    expect(restarted.getState().held[0].note).toBe('ملاحظات العميل الثاني');
    restarted.getState().clear();
    expect(restarted.getState().notes).toBe('');
  });
  it('adds lines, merges duplicates by quantity, and removes at qty 0', () => {
    const s = createPosStore(undefined, 'test-1');
    s.getState().addLine(line());
    s.getState().addLine(line({ quantity: 2 }));
    expect(s.getState().lines).toHaveLength(1);
    expect(s.getState().lines[0]!.quantity).toBe(3);
    s.getState().setQty('p1', 0);
    expect(s.getState().lines).toHaveLength(0);
  });

  it('switching a line tier updates both list and unit price without a manual-price action', () => {
    const s = createPosStore(undefined, 'test-2');
    s.getState().addLine(line());
    s.getState().setLineTier('p1', 'wholesale', 80);
    expect(s.getState().lines[0]).toMatchObject({ priceTier: 'wholesale', listPrice: 80, unitPrice: 80 });
    expect(s.getState()).not.toHaveProperty('setLinePrice');
  });

  it('applies one permitted tier to the whole cart while preserving quantities', () => {
    const s = createPosStore(undefined, 'bulk-tier');
    s.getState().addLine(line({ quantity: 2 }));
    s.getState().addLine(line({ productId: 'p2', quantity: 3, priceTier: 'special', unitPrice: 35 }));
    const prices = { p1: { retail1: 100, retail2: 90, wholesale: 80 }, p2: { retail1: 60, retail2: 50, wholesale: 45 } };
    expect(s.getState().applyPriceTier('wholesale', prices)).toBe(true);
    expect(s.getState().lines).toMatchObject([{ productId: 'p1', quantity: 2, priceTier: 'wholesale', unitPrice: 80, listPrice: 80 }, { productId: 'p2', quantity: 3, priceTier: 'wholesale', unitPrice: 45, listPrice: 45 }]);
    expect(cartTotals(s.getState().lines).total).toBe(295);
    expect(s.getState()).toMatchObject({ priceTier: 'wholesale', explicitPriceTier: true });
  });

  it('leaves every price unchanged if any product price is missing or the tier is forbidden', () => {
    const s = createPosStore(undefined, 'bulk-tier-invalid');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(false), defaultTier: 'retail1' });
    s.getState().addLine(line());
    s.getState().addLine(line({ productId: 'p2' }));
    const prices = { p1: { retail1: 100, retail2: 90, wholesale: 80 }, p2: { retail1: 60, retail2: 50, wholesale: 45 } };
    const before = s.getState();
    expect(s.getState().applyPriceTier('wholesale', prices)).toBe(false);
    expect(s.getState().applyPriceTier('retail2', { p1: prices.p1 })).toBe(false);
    expect(s.getState().applyPriceTier('retail2', { ...prices, p2: { ...prices.p2, retail2: NaN } })).toBe(false);
    expect(s.getState()).toBe(before);
  });

  it('restores the whole-cart tier after restart and hold, then resets it for the next invoice', () => {
    const prices = { p1: { retail1: 100, retail2: 90, wholesale: 80 } };
    const first = createPosStore(undefined, 'bulk-tier-persist');
    first.getState().addLine(line());
    first.getState().applyPriceTier('retail2', prices);
    first.getState().setCustomer(customer('wholesale'));
    expect(first.getState().priceTier).toBe('retail2');
    const restarted = createPosStore(undefined, 'bulk-tier-persist');
    expect(restarted.getState()).toMatchObject({ priceTier: 'retail2', explicitPriceTier: true });
    restarted.getState().hold();
    expect(restarted.getState()).toMatchObject({ priceTier: 'retail1', explicitPriceTier: false });
    restarted.getState().resume(restarted.getState().held[0].id);
    expect(restarted.getState()).toMatchObject({ priceTier: 'retail2', explicitPriceTier: true, lines: [{ priceTier: 'retail2', unitPrice: 90 }] });
    restarted.getState().clear();
    expect(restarted.getState()).toMatchObject({ priceTier: 'retail1', explicitPriceTier: false });
  });

  it('selecting a customer picks the default tier by customer type', () => {
    const s = createPosStore(undefined, 'test-3');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(true), defaultTier: 'retail1' });
    s.getState().setCustomer(customer('wholesale'));
    expect(s.getState().priceTier).toBe('wholesale');
    s.getState().setCustomer(customer('workshop'));
    expect(s.getState().priceTier).toBe('retail2');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(true), defaultTier: 'retail2' });
    s.getState().setCustomer(customer('retail'));
    expect(s.getState().priceTier).toBe('retail2');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(true), defaultTier: 'retail1' });
    s.getState().setCustomer(null);
    expect(s.getState().priceTier).toBe('retail1');
  });

  it('never selects a tier the user may not sell at', () => {
    const s = createPosStore(undefined, 'test-3b');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(false), defaultTier: 'retail1' });
    // A wholesale customer must not silently arm a wholesale price the cashier cannot charge.
    s.getState().setCustomer(customer('wholesale'));
    expect(s.getState().priceTier).toBe('retail1');
    s.getState().setPriceTier('wholesale');
    expect(s.getState().priceTier).toBe('retail1');
    s.getState().setPriceTier('retail2');
    expect(s.getState().priceTier).toBe('retail2');
  });

  it('re-configuring demotes a tier restored from storage that the new user cannot use', () => {
    const s = createPosStore(undefined, 'test-3c');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(true), defaultTier: 'retail1' });
    s.getState().setPriceTier('wholesale');
    expect(s.getState().priceTier).toBe('wholesale');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(false), defaultTier: 'retail2' });
    expect(s.getState().priceTier).toBe('retail2');
  });

  it('clearing the cart drops the previous customer tier', () => {
    const s = createPosStore(undefined, 'test-3d');
    s.getState().configureTiers({ allowedTiers: allowedPriceTiers(true), defaultTier: 'retail1' });
    s.getState().setCustomer(customer('wholesale'));
    expect(s.getState().priceTier).toBe('wholesale');
    s.getState().clear();
    expect(s.getState().customer).toBeNull();
    expect(s.getState().priceTier).toBe('retail1');
  });

  it('hold / resume round-trips the cart and clears the active one', () => {
    const s = createPosStore(undefined, 'test-4');
    s.getState().addLine(line());
    s.getState().hold('later');
    expect(s.getState().lines).toHaveLength(0);
    expect(s.getState().held).toHaveLength(1);
    s.getState().resume(s.getState().held[0]!.id);
    expect(s.getState().lines).toHaveLength(1);
    expect(s.getState().invoiceDiscount).toBe(0);
    expect(s.getState().held).toHaveLength(0);
  });

  it('persists the cart so a held invoice survives an app restart', () => {
    const first = createPosStore(undefined, 'test-persist');
    first.getState().addLine(line());
    first.getState().hold('later');
    first.getState().addLine(line({ productId: 'p2' }));
    expect(localStorage.getItem('test-persist')).toBeTruthy();

    const restarted = createPosStore(undefined, 'test-persist');
    expect(restarted.getState().held).toHaveLength(1);
    expect(restarted.getState().held[0]!.note).toBe('later');
    expect(restarted.getState().lines.map((l) => l.productId)).toEqual(['p2']);
  });

  it('restores discounts and replaces legacy manual prices with catalog prices', () => {
    const legacyLine = { ...line(), quantity: 2, priceTier: 'manual', unitPrice: 75, discountPercent: 20 };
    localStorage.setItem('legacy-cart', JSON.stringify({ state: { lines: [legacyLine], saleType: 'credit', invoiceDiscount: 20, held: [{ id: 'h1', heldAt: '', lines: [legacyLine], invoiceDiscount: 30, customer: null, note: '' }] }, version: 0 }));
    const restarted = createPosStore(undefined, 'legacy-cart');
    expect(restarted.getState().invoiceDiscount).toBe(20);
    expect(restarted.getState().saleType).toBe('credit');
    expect(restarted.getState().lines[0]).toMatchObject({ unitPrice: 100, priceTier: 'retail1', discountPercent: 20 });
    restarted.getState().resume('h1');
    expect(restarted.getState().invoiceDiscount).toBe(30);
    expect(cartTotals(restarted.getState().lines, restarted.getState().invoiceDiscount).total).toBe(130);
  });

  it('defaults to cash and setPayment upserts by method', () => {
    const s = createPosStore(undefined, 'test-5');
    s.getState().setPayment('cash', 50);
    s.getState().setPayment('card', 20);
    s.getState().setPayment('cash', 30);
    expect(s.getState().payments).toEqual([{ method: 'card', amount: 20 }, { method: 'cash', amount: 30 }]);
    expect(s.getState().saleType).toBe('cash');
    s.getState().setSaleType('credit');
    expect(s.getState()).toMatchObject({ saleType: 'credit', payments: [] });
  });
  it('preserves credit selection after restart and hold, and resets the next invoice to cash', () => {
    const s = createPosStore(undefined, 'credit-cart');
    s.getState().addLine(line());
    s.getState().setCustomer(customer('retail'));
    s.getState().setSaleType('credit');
    const restarted = createPosStore(undefined, 'credit-cart');
    expect(restarted.getState().saleType).toBe('credit');
    restarted.getState().hold();
    expect(restarted.getState().saleType).toBe('cash');
    restarted.getState().resume(restarted.getState().held[0].id);
    expect(restarted.getState().saleType).toBe('credit');
    restarted.getState().clear();
    expect(restarted.getState()).toMatchObject({ saleType: 'cash', customer: null, lines: [] });
  });
});

describe('cartTotals', () => {
  it('subtracts rounded item discounts before the invoice discount', () => {
    const lines: CartLine[] = [
      { ...line(), quantity: 3, unitPrice: 33.333, discountPercent: 10 },
      { ...line({ productId: 'p2', unitPrice: 20, unitCost: 10 }), quantity: 1 },
    ];
    const t = cartTotals(lines, 5);
    expect(t.subtotal).toBe(120);
    expect(t.itemDiscounts).toBe(10);
    expect(t.total).toBe(105);
    expect(t.cost).toBe(160);
    expect(t.qty).toBe(4);
    expect(t.tax).toBe(0);
  });

  it('rounds discounts per line without introducing tax', () => {
    const lines: CartLine[] = [
      { ...line({ unitPrice: 10.005 }), quantity: 1, discountPercent: 10 },
      { ...line({ productId: 'p2', unitPrice: 10.005 }), quantity: 1, discountPercent: 10 },
    ];
    const t = cartTotals(lines);
    expect(t.itemDiscounts).toBe(2);
    expect(t.taxable).toBe(18.01);
    expect(t.tax).toBe(0);
    expect(t.total).toBe(18.01);
    expect(cartTotals(lines).tax).toBe(0);
  });
});

describe('discount persistence and editing', () => {
  it('preserves both discount types through restart, hold and switching invoices', () => {
    localStorage.removeItem('discount-cart');
    const first = createPosStore(undefined, 'discount-cart');
    first.getState().addLine(line({ quantity: 2 }));
    first.getState().setLineDiscount('p1', 10);
    first.getState().setInvoiceDiscount(5);
    const restarted = createPosStore(undefined, 'discount-cart');
    expect(cartTotals(restarted.getState().lines, restarted.getState().invoiceDiscount).total).toBe(175);
    restarted.getState().hold();
    const heldId = restarted.getState().held[0].id;
    expect(restarted.getState().invoiceDiscount).toBe(0);
    restarted.getState().addLine(line({ productId: 'p2' }));
    restarted.getState().setLineDiscount('p2', 7, 'amount');
    restarted.getState().setInvoiceDiscount(3);
    restarted.getState().resume(heldId);
    expect(restarted.getState().held[0]).toMatchObject({ invoiceDiscount: 3, lines: [{ discount: 7 }] });
    expect(cartTotals(restarted.getState().lines, restarted.getState().invoiceDiscount).total).toBe(175);
    restarted.getState().clear();
    expect(restarted.getState()).toMatchObject({ lines: [], invoiceDiscount: 0 });
  });

  it('keeps a fixed amount per line and recalculates percentages when quantity or tier changes', () => {
    const store = createPosStore(undefined, 'discount-edits');
    store.getState().addLine(line());
    store.getState().setLineDiscount('p1', 10, 'amount');
    store.getState().setQty('p1', 2);
    expect(cartTotals(store.getState().lines).total).toBe(190);
    store.getState().setLineDiscount('p1', 10);
    store.getState().applyPriceTier('retail2', { p1: { retail1: 100, retail2: 90, wholesale: 80 } });
    expect(cartTotals(store.getState().lines).total).toBe(162);
    store.getState().setLineDiscount('p1', 0, 'amount');
    expect(cartTotals(store.getState().lines).total).toBe(180);
  });
});

describe('resolveSalePrice', () => {
  const product = { prices: { retail1: 100, retail2: 90, wholesale: 80 } };
  it('special price wins over tier', () => {
    expect(resolveSalePrice({ product, tier: 'wholesale', specialPrice: 70 })).toEqual({ price: 70, tier: 'special' });
  });
  it('otherwise returns the requested tier price', () => {
    expect(resolveSalePrice({ product, tier: 'retail2' })).toEqual({ price: 90, tier: 'retail2' });
  });
});
