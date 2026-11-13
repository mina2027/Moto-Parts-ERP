import { create } from 'zustand';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { Customer, ID, LocalizedText, PaymentMethod, PaymentSplit, PriceTier, ProductPrices, SalePriceTier, SaleType } from '@moto/shared';
import { PRICE_TIERS, clampPriceTier, defaultTierForCustomer, round2, saleLineDiscount } from '@moto/shared';

export interface CartLine {
  productId: ID;
  name: LocalizedText;
  barcode: string;
  sku: string;
  partNumber?: string;
  /** Selected catalog tier price. */
  listPrice: number;
  unitPrice: number;
  unitCost: number;
  priceTier: SalePriceTier;
  quantity: number;
  discountPercent: number;
  /** Fixed discount on the entire line, in the invoice currency. */
  discount?: number;
  available: number;
}

export interface HeldCart {
  id: ID;
  heldAt: string;
  lines: CartLine[];
  customer: Customer | null;
  saleType?: SaleType;
  priceTier?: PriceTier;
  explicitPriceTier?: boolean;
  invoiceDiscount: number;
  note: string;
}

export interface PosState {
  lines: CartLine[];
  customer: Customer | null;
  invoiceDiscount: number;
  saleType: SaleType;
  notes: string;
  payments: PaymentSplit[];
  /** Default tier applied to newly added lines. Never leaves `allowedTiers`. */
  priceTier: PriceTier;
  /** An explicit whole-cart choice takes precedence over automatic customer special prices. */
  explicitPriceTier: boolean;
  /** Tiers the signed-in user may sell at; set once from their permissions. */
  allowedTiers: PriceTier[];
  /** Tier a cart falls back to when no customer forces one (settings.pos.defaultPriceTier). */
  defaultTier: PriceTier;
  held: HeldCart[];
  lastSaleId: ID | null;
  configureTiers: (opts: { allowedTiers: PriceTier[]; defaultTier: PriceTier }) => void;
  addLine: (line: Omit<CartLine, 'quantity'> & { quantity?: number }) => void;
  setQty: (productId: ID, qty: number) => void;
  setLineDiscount: (productId: ID, value: number, mode?: 'amount') => void;
  setInvoiceDiscount: (amount: number) => void;
  setLineTier: (productId: ID, tier: SalePriceTier, price: number) => void;
  replaceLine: (productId: ID, line: Omit<CartLine, 'quantity'> & { quantity?: number }) => void;
  removeLine: (productId: ID) => void;
  removeLast: () => void;
  setCustomer: (c: Customer | null) => void;
  setSaleType: (type: SaleType) => void;
  setNotes: (notes: string) => void;
  setPriceTier: (m: PriceTier) => void;
  /** Applies one permitted tier to every line atomically; missing prices leave the cart unchanged. */
  applyPriceTier: (tier: PriceTier, prices: Record<ID, ProductPrices>) => boolean;
  setPayments: (p: PaymentSplit[]) => void;
  setPayment: (method: PaymentMethod, amount: number) => void;
  hold: (note?: string) => void;
  resume: (id: ID) => void;
  dropHeld: (id: ID) => void;
  clear: () => void;
  setLastSale: (id: ID | null) => void;
}

export function createPosStore(storage?: PersistStorage<Partial<PosState>>, name = 'moto-pos') {
  return create<PosState>()(
    persist(
      (set, get) => ({
        lines: [],
        customer: null,
        invoiceDiscount: 0,
        saleType: 'cash',
        notes: '',
        payments: [],
        priceTier: 'retail1',
        explicitPriceTier: false,
        allowedTiers: [...PRICE_TIERS],
        defaultTier: 'retail1',
        held: [],
        lastSaleId: null,
        configureTiers: ({ allowedTiers, defaultTier }) =>
          set((s) => {
            const allowed = allowedTiers.length ? allowedTiers : [...PRICE_TIERS];
            const fallback = clampPriceTier(defaultTier, allowed);
            // A tier restored from storage may belong to a user who has since signed out.
            return { allowedTiers: allowed, defaultTier: fallback, priceTier: clampPriceTier(s.priceTier, allowed, fallback) };
          }),
        addLine: (line) =>
          set((s) => {
            const existing = s.lines.find((l) => l.productId === line.productId);
            if (existing) return { lines: s.lines.map((l) => (l.productId === line.productId ? { ...l, quantity: l.quantity + (line.quantity ?? 1) } : l)) };
            return { lines: [...s.lines, { ...line, discountPercent: 0, quantity: line.quantity ?? 1 }] };
          }),
        setQty: (productId, qty) => set((s) => ({ lines: qty <= 0 ? s.lines.filter((l) => l.productId !== productId) : s.lines.map((l) => (l.productId === productId ? { ...l, quantity: qty } : l)) })),
        setLineDiscount: (productId, value) => {
          if (!Number.isFinite(value) || value < 0) return;
          set((s) => ({ lines: s.lines.map(l => l.productId === productId ? { ...l, discount: round2(value), discountPercent: 0 } : l) }));
        },
        setInvoiceDiscount: (amount) => { if (Number.isFinite(amount) && amount >= 0) set({ invoiceDiscount: round2(amount) }); },
        setLineTier: (productId, tier, price) => set((s) => ({ lines: s.lines.map((l) => (l.productId === productId ? { ...l, priceTier: tier, listPrice: price, unitPrice: price } : l)) })),
        replaceLine: (productId, line) =>
          set((s) => {
            const old = s.lines.find((l) => l.productId === productId);
            const qty = line.quantity ?? old?.quantity ?? 1;
            const without = s.lines.filter((l) => l.productId !== productId && l.productId !== line.productId);
            return { lines: [...without, { ...line, discountPercent: 0, quantity: qty }] };
          }),
        removeLine: (productId) => set((s) => ({ lines: s.lines.filter((l) => l.productId !== productId) })),
        removeLast: () => set((s) => ({ lines: s.lines.slice(0, -1) })),
        setCustomer: (customer) => set((s) => ({ customer, priceTier: s.explicitPriceTier ? s.priceTier : clampPriceTier(defaultTierForCustomer(customer?.type, s.defaultTier), s.allowedTiers, s.defaultTier) })),
        setSaleType: (saleType) => set({ saleType, payments: [] }),
        setNotes: (notes) => set({ notes }),
        setPriceTier: (priceTier) => set((s) => ({ priceTier: clampPriceTier(priceTier, s.allowedTiers, s.defaultTier) })),
        applyPriceTier: (tier, prices) => {
          const state = get();
          if (!state.allowedTiers.includes(tier) || state.lines.some((line) => !prices[line.productId] || !Number.isFinite(prices[line.productId][tier]) || prices[line.productId][tier] < 0)) return false;
          set({ priceTier: tier, explicitPriceTier: true, lines: state.lines.map((line) => ({ ...line, priceTier: tier, unitPrice: prices[line.productId][tier], listPrice: prices[line.productId][tier] })) });
          return true;
        },
        setPayments: (payments) => set({ payments }),
        setPayment: (method, amount) =>
          set((s) => {
            const others = s.payments.filter((p) => p.method !== method);
            return { payments: amount > 0 ? [...others, { method, amount }] : others };
          }),
        hold: (note) =>
          set((s) =>
            s.lines.length
              ? { held: [...s.held, { id: `H-${Date.now().toString(36).toUpperCase()}`, heldAt: new Date().toISOString(), lines: s.lines, customer: s.customer, saleType: s.saleType, priceTier: s.priceTier, explicitPriceTier: s.explicitPriceTier, invoiceDiscount: s.invoiceDiscount, note: note ?? s.notes }], lines: [], customer: null, invoiceDiscount: 0, payments: [], saleType: 'cash', notes: '', priceTier: s.defaultTier, explicitPriceTier: false }
              : s,
          ),
        resume: (id) =>
          set((s) => {
            const h = s.held.find((x) => x.id === id);
            if (!h) return s;
            const remaining = s.held.filter((x) => x.id !== id);
            const current = s.lines.length ? [...remaining, { id: `H-${Date.now().toString(36).toUpperCase()}`, heldAt: new Date().toISOString(), lines: s.lines, customer: s.customer, saleType: s.saleType, priceTier: s.priceTier, explicitPriceTier: s.explicitPriceTier, invoiceDiscount: s.invoiceDiscount, note: s.notes }] : remaining;
            return { held: current, lines: h.lines, customer: h.customer, invoiceDiscount: h.invoiceDiscount, payments: [], saleType: h.saleType === 'credit' ? 'credit' : 'cash', notes: h.note ?? '', priceTier: clampPriceTier(h.priceTier ?? defaultTierForCustomer(h.customer?.type, s.defaultTier), s.allowedTiers, s.defaultTier), explicitPriceTier: h.explicitPriceTier === true };
          }),
        dropHeld: (id) => set((s) => ({ held: s.held.filter((x) => x.id !== id) })),
        // The next customer must not inherit the previous one's tier.
        clear: () => set((s) => ({ lines: [], customer: null, invoiceDiscount: 0, payments: [], saleType: 'cash', notes: '', priceTier: s.defaultTier, explicitPriceTier: false })),
        setLastSale: (lastSaleId) => set({ lastSaleId }),
      }),
      // `storage` must stay off the options object when absent: an explicit `undefined` overwrites zustand's
      // localStorage default and silently disables persistence, losing held invoices on restart.
      { name, ...(storage ? { storage } : {}), merge: (persisted, current) => {
        const saved = persisted as Partial<PosState> | undefined;
        const restore = (lines: CartLine[] = []) => lines.map(l => l.priceTier === 'manual' ? { ...l, priceTier: 'retail1' as const, unitPrice: l.listPrice } : l);
        return { ...current, ...saved, explicitPriceTier: saved?.explicitPriceTier === true, saleType: saved?.saleType === 'credit' ? 'credit' : 'cash', notes: typeof saved?.notes === 'string' ? saved.notes : '', invoiceDiscount: saved?.invoiceDiscount ?? 0, lines: restore(saved?.lines), held: (saved?.held ?? []).map(h => ({ ...h, lines: restore(h.lines) })) };
      }, partialize: (s) => ({ held: s.held, lines: s.lines, customer: s.customer, saleType: s.saleType, notes: s.notes, invoiceDiscount: s.invoiceDiscount, lastSaleId: s.lastSaleId, priceTier: s.priceTier, explicitPriceTier: s.explicitPriceTier }) },
    ),
  );
}

export type PosStore = ReturnType<typeof createPosStore>;

/** Round each line discount before totaling, matching online and offline sale calculations. */
export function cartTotals(lines: (Pick<CartLine, 'unitPrice' | 'quantity'> & Partial<Pick<CartLine, 'unitCost' | 'discount' | 'discountPercent'>>)[], invoiceDiscount = 0) {
  const subtotal = round2(lines.reduce((a, l) => a + l.unitPrice * l.quantity, 0));
  const itemDiscounts = round2(lines.reduce((a, l) => a + saleLineDiscount(l), 0));
  const taxable = round2(subtotal - itemDiscounts - invoiceDiscount);
  const tax = 0;
  const total = taxable;
  const cost = round2(lines.reduce((a, l) => a + (l.unitCost ?? 0) * l.quantity, 0));
  const qty = lines.reduce((a, l) => a + l.quantity, 0);
  return { subtotal, itemDiscounts, taxable, tax, total, cost, qty };
}
