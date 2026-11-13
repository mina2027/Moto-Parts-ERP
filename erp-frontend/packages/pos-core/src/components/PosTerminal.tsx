import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AlternativeSuggestion, Customer, PaymentSplit, PriceTier, PrintProfile, Sale, SalePriceTier, SpecialPrice } from '@moto/shared';
import { allowedPriceTiers, clampPriceTier, productCategoryIds, round2, saleLineDiscount, uuid } from '@moto/shared';
import { Alert, Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Kbd, Sheet, SheetContent, SheetHeader, SheetTitle, SimpleTooltip, Textarea, cn } from '@moto/ui';
import { Ban, Banknote, Barcode as BarcodeIcon, ChevronDown, ChevronUp, CreditCard, HandCoins, HelpCircle, Monitor, PackageSearch, PanelBottomClose, PanelBottomOpen, PanelRightClose, PanelRightOpen, PauseCircle, PlayCircle, Printer, ReceiptText, Trash2, Undo2, User, UserX, X } from 'lucide-react';
import type { PosAdapter, PosProduct } from '../adapter';
import { PosLocaleContext, formatDateTime, formatMoney, usePosT } from '../i18n';
import { cartTotals, createPosStore, type CartLine, type PosStore } from '../store';
import { useScannerWedge } from '../hooks/useScannerWedge';
import { AlternativesDialog } from './AlternativesDialog';
import { CashDrawerDialog } from './CashDrawerDialog';
import { CollectDebtDialog } from './CollectDebtDialog';
import { ConnectivityBadge, useConnectivity } from './ConnectivityBadge';
import { CustomerPicker } from './CustomerPicker';
import { PaymentDialog } from './PaymentDialog';
import { DiscountDialog } from './DiscountDialog';
import { PrintDialog } from './PrintDialog';
import { InvoiceSizeSelector } from './InvoiceSizeSelector';
import { ReturnDialog } from './ReturnDialog';
import { ProductChooser } from './ProductChooser';
import { ProductFilters } from './ProductFilters';
import { EMPTY_FILTERS, filterCatalog, type CatalogFilters } from '../catalogFilter';
import { SalesDialog } from './SalesDialog';
import { TierChooser, tierBadgeLabel } from './TierChooser';
import { InvoiceDocument, pageStyleFor } from '../print/templates';
import { checkoutProfileForSize, type InvoiceSize } from '../print/profiles';
import './PosTerminal.css';

export interface PosTerminalProps {
  adapter: PosAdapter;
  store?: PosStore;
  /** Base URL used in the QR fallback link. */
  verifyBaseUrl?: string;
  className?: string;
  /** Desktop checkout: choose an invoice size in the payment dialog and print after saving. */
  printOnComplete?: boolean;
  /** Host dialogs and the idle lock keep the cart mounted while suspending scanner/shortcuts. */
  suspended?: boolean;
}

/** Keeps a broken invoice template from unmounting the whole terminal — the sale is already saved. */
class RenderGuard extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error('invoice template failed to render', error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Remembers a UI preference on this device for this user; falls back to memory when storage is blocked. */
function usePersistedFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [value, setValue] = React.useState(() => {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw === null || raw === undefined ? initial : raw === '1';
    } catch {
      return initial;
    }
  });
  const set = React.useCallback(
    (v: boolean) => {
      setValue(v);
      try {
        globalThis.localStorage?.setItem(key, v ? '1' : '0');
      } catch {
        /* private mode — keep the in-memory value */
      }
    },
    [key],
  );
  return [value, set];
}

function specialFor(list: SpecialPrice[], customerId: string | null, productId: string): number | null {
  if (!customerId) return null;
  const now = Date.now();
  const sp = list.find((s) => s.customerId === customerId && s.productId === productId && new Date(s.validFrom).getTime() <= now && (!s.validTo || new Date(s.validTo).getTime() >= now));
  return sp?.price ?? null;
}

export function PosTerminal({ adapter, store, verifyBaseUrl, className, printOnComplete, suspended }: PosTerminalProps) {
  return (
    <PosLocaleContext.Provider value={adapter.locale}>
      <PosTerminalInner adapter={adapter} store={store} verifyBaseUrl={verifyBaseUrl} className={className} printOnComplete={printOnComplete} suspended={suspended} />
    </PosLocaleContext.Provider>
  );
}

const defaultStore = createPosStore();

function PosTerminalInner({ adapter, store = defaultStore, verifyBaseUrl, className, printOnComplete, suspended }: PosTerminalProps) {
  const { p, tx, locale } = usePosT();
  const qc = useQueryClient();
  const pos = store();
  const has = (perm: string) => adapter.permissions.includes(perm as never);
  const canWholesale = has('prices.wholesale');
  const canItemDiscount = has('discounts.item');
  const canInvoiceDiscount = has('discounts.invoice');
  const canTransfer = has('inventory.transfer');
  const allowedTiers = React.useMemo(() => allowedPriceTiers(canWholesale), [canWholesale]);

  const connectivity = useConnectivity(adapter);
  const canDrawer = has('cash.open') || has('cash.close');
  const canCollect = has('customers.credit') || has('sales.create');

  const settingsQ = useQuery({ queryKey: ['pos', 'settings'], queryFn: () => adapter.settings(), staleTime: 60_000 });
  const settings = settingsQ.data;
  const defaultTier = settings?.pos.defaultPriceTier;
  const configureTiers = pos.configureTiers;
  React.useEffect(() => {
    if (defaultTier) configureTiers({ allowedTiers, defaultTier });
  }, [configureTiers, allowedTiers, defaultTier]);
  const totals = cartTotals(pos.lines, pos.invoiceDiscount);
  const maxDiscountAmount = has('discounts.unlimited') ? Number.POSITIVE_INFINITY : settings?.pos.maxDiscountAmount ?? 0;
  const discountLimit = maxDiscountAmount;
  const discountError = (pos.invoiceDiscount > 0 && !canInvoiceDiscount) || (pos.lines.some(l => saleLineDiscount(l) > 0) && !canItemDiscount)
    ? p.discountNotAllowed
    : totals.total < 0 || round2(totals.itemDiscounts + pos.invoiceDiscount) > discountLimit + 0.01 || pos.lines.some(l => saleLineDiscount(l) > round2(l.unitPrice * l.quantity))
      ? p.discountExceeds : null;
  const customersQ = useQuery({ queryKey: ['pos', 'customers'], queryFn: () => adapter.customers(), staleTime: 60_000 });
  const specialQ = useQuery({ queryKey: ['pos', 'specialPrices'], queryFn: () => adapter.specialPrices(), staleTime: 60_000 });
  // Refresh after returning to the terminal even if a category-change notification was missed.
  const catalogQ = useQuery({ queryKey: ['pos', 'catalog'], queryFn: () => adapter.catalog(), staleTime: 30_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const productDiscountExceeded = pos.lines.some((line) => {
    const product = catalogQ.data?.find((item) => item.id === line.productId);
    const productMax = product?.maxDiscountAmount && product.maxDiscountAmount > 0 ? Math.min(maxDiscountAmount, product.maxDiscountAmount) : maxDiscountAmount;
    const gross = line.unitPrice * line.quantity;
    return saleLineDiscount(line) > round2(gross) || saleLineDiscount(line) > productMax + 0.01;
  });
  const discountErrorWithProduct = productDiscountExceeded ? p.discountExceeds : discountError;
  const metadataQ = useQuery({ queryKey: ['pos', 'catalogMeta'], queryFn: () => adapter.catalogMeta!(), enabled: Boolean(adapter.catalogMeta), staleTime: 60_000, refetchOnWindowFocus: 'always', refetchOnReconnect: 'always' });
  const categoryNames = React.useMemo(() => new Map((metadataQ.data?.categories ?? []).map((category) => [category.id, tx(category.name)])), [metadataQ.data?.categories, tx]);
  const categoryLabel = (product?: PosProduct) => productCategoryIds(product).map((id) => categoryNames.get(id)).filter(Boolean).join(locale === 'ar' ? '، ' : ', ') || '—';
  const brandNames = React.useMemo(() => new Map((metadataQ.data?.brands ?? []).map((brand) => [brand.id, tx(brand.name)])), [metadataQ.data?.brands, tx]);
  const brandLabel = (product?: PosProduct) => brandNames.get(product?.brandId ?? '') || '—';
  const sessionQ = useQuery({ queryKey: ['pos', 'session'], queryFn: () => adapter.currentSession(), refetchInterval: 30_000 });
  // Unfinished legacy carts must use a current catalog price before checkout.
  React.useEffect(() => {
    if (!catalogQ.data || !specialQ.data) return;
    for (const line of pos.lines) {
      const product = catalogQ.data.find(p => p.id === line.productId);
      if (!product) continue;
      const special = specialFor(specialQ.data, pos.customer?.id ?? null, line.productId);
      const tier = line.priceTier === 'special' && special != null ? 'special' : allowedTiers.includes(line.priceTier as PriceTier) ? line.priceTier as PriceTier : pos.priceTier;
      const price = tier === 'special' ? special! : product.prices[tier];
      if (line.priceTier !== tier || line.unitPrice !== price || line.listPrice !== price) pos.setLineTier(line.productId, tier, price);
    }
  }, [catalogQ.data, specialQ.data, pos.lines, pos.customer?.id, pos.priceTier, pos.setLineTier, allowedTiers]);

  const [payOpen, setPayOpen] = React.useState(false);
  const [reprintOpen, setReprintOpen] = React.useState(false);
  const [custOpen, setCustOpen] = React.useState(false);
  const [heldOpen, setHeldOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [printError, setPrintError] = React.useState<{ message: string; size: InvoiceSize } | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [collectOpen, setCollectOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);
  const [salesOpen, setSalesOpen] = React.useState(false);
  const [productFor, setProductFor] = React.useState<string | null>(null);
  const [knownProducts, setKnownProducts] = React.useState<Record<string, PosProduct>>({});
  const [tierBusy, setTierBusy] = React.useState(false);
  const tierApplying = React.useRef(false);
  const [receiptSale, setReceiptSale] = React.useState<Sale | null>(null);
  React.useEffect(() => {
    if (!pos.lastSaleId || receiptSale?.id === pos.lastSaleId) return;
    let active = true;
    void adapter.lastSale(pos.lastSaleId).then((sale) => { if (active) setReceiptSale(sale); }).catch(() => undefined);
    return () => { active = false; };
  }, [adapter, pos.lastSaleId, receiptSale?.id]);
  const [selectedLine, setSelectedLine] = React.useState<string | null>(null);
  const [tierFor, setTierFor] = React.useState<string | null>(null);
  const [discountFor, setDiscountFor] = React.useState<{ productId?: string } | null>(null);
  const [altFor, setAltFor] = React.useState<PosProduct | null>(null);
  const hiddenPrintRef = React.useRef<HTMLDivElement | null>(null);
  const [silentPrint, setSilentPrint] = React.useState<{ sale: Sale; profile: PrintProfile } | null>(null);
  const [printBusy, setPrintBusy] = React.useState(false);
  const printing = React.useRef(false);
  const lastPrintSize = React.useRef<InvoiceSize>('small');
  // Resolved by the hidden print root's ref callback, so printing never races the render.
  const printReady = React.useRef<(() => void) | null>(null);

  // A blocking overlay stops the scanner; the tier popover only claims the bare number keys.
  const dialogOpen = payOpen || reprintOpen || custOpen || heldOpen || helpOpen || cancelOpen || printBusy || tierBusy || Boolean(printError) || drawerOpen || collectOpen || returnOpen || salesOpen || Boolean(productFor) || Boolean(altFor) || Boolean(discountFor);
  const keyboardCaptured = dialogOpen || Boolean(tierFor);

  // Panel visibility is per user and device.
  const [panelOpen, setPanelOpen] = usePersistedFlag(`pos.panelOpen.${adapter.user.id}`, true);
  const [quickOpen, setQuickOpen] = usePersistedFlag(`pos.quickProductsOpen.${adapter.user.id}`, true);
  const [filtersOpen, setFiltersOpen] = usePersistedFlag(`pos.filtersOpen.${adapter.user.id}`, true);
  const [quickLimit, setQuickLimit] = React.useState(24);
  const [filters, setFilters] = React.useState<CatalogFilters>({ ...EMPTY_FILTERS });
  const filteredProducts = React.useMemo(() => filterCatalog(catalogQ.data ?? [], filters, { categories: metadataQ.data?.categories, tier: pos.priceTier, locale }), [catalogQ.data, filters, metadataQ.data?.categories, pos.priceTier, locale]);
  const changeFilters = (value: CatalogFilters) => { setFilters(value); setQuickLimit(24); };
  const quickProducts = React.useMemo(() => filteredProducts.filter((product) => product.isQuickProduct !== false), [filteredProducts]);

  const altQ = useQuery({ queryKey: ['pos', 'alternatives', altFor?.id], queryFn: () => adapter.alternatives(altFor!.id), enabled: Boolean(altFor) });

  const resolvePrice = React.useCallback(
    (prod: PosProduct, tier: PriceTier): { price: number; tier: SalePriceTier } => {
      const sp = specialFor(specialQ.data ?? [], pos.customer?.id ?? null, prod.id);
      if (sp != null && !pos.explicitPriceTier) return { price: sp, tier: 'special' };
      const t = clampPriceTier(tier, allowedTiers);
      return { price: prod.prices[t], tier: t };
    },
    [specialQ.data, pos.customer, pos.explicitPriceTier, allowedTiers],
  );

  const applyCustomerTier = async (tier: PriceTier) => {
    if (!allowedTiers.includes(tier) || tierApplying.current) return;
    tierApplying.current = true;
    setTierBusy(true);
    setTierFor(null);
    try {
      const products = { ...knownProducts, ...Object.fromEntries((catalogQ.data ?? []).map((product) => [product.id, product])) };
      const missing = [...new Set(store.getState().lines.filter((line) => !products[line.productId]).map((line) => line.productId))];
      const fetched = await Promise.all(missing.map(async (id) => {
        const product = await adapter.product(id);
        if (!product || product.id !== id) throw new Error(p.priceTypeApplyError);
        return product;
      }));
      for (const product of fetched) products[product.id] = product;
      const prices = Object.fromEntries(Object.values(products).map((product) => [product.id, product.prices]));
      if (!store.getState().applyPriceTier(tier, prices)) throw new Error(p.priceTypeApplyError);
      if (fetched.length) setKnownProducts((known) => ({ ...known, ...Object.fromEntries(fetched.map((product) => [product.id, product])) }));
    } catch {
      toast.error(p.priceTypeApplyError);
    } finally {
      tierApplying.current = false;
      setTierBusy(false);
    }
  };

  const addProduct = React.useCallback(
    (prod: PosProduct, qty = 1, tierOverride?: PriceTier) => {
      if (!settings || tierApplying.current) return;
      const available = prod.available;
      const existing = pos.lines.find((l) => l.productId === prod.id);
      const nextQty = (existing?.quantity ?? 0) + qty;
      if (available <= 0) {
        toast.error(p.outOfStock, { description: tx(prod.name) });
        setAltFor(prod);
        return;
      }
      if (nextQty > available) {
        toast.warning(p.insufficientStock, { description: `${tx(prod.name)} — ${p.inStock}: ${available}` });
        return;
      }
      const { price, tier } = resolvePrice(prod, tierOverride ?? pos.priceTier);
      setPanelOpen(true);
      setKnownProducts((products) => ({ ...products, [prod.id]: prod }));
      pos.addLine({ productId: prod.id, name: prod.name, barcode: prod.internalBarcode, sku: prod.sku, partNumber: prod.partNumber, listPrice: price, unitPrice: price, unitCost: prod.lastPurchaseCost || prod.purchasePrice, priceTier: tier, discountPercent: 0, available, quantity: qty });
      setSelectedLine(prod.id);
      if (settings.pos.showTierChooserOnScan && !existing && tier !== 'special') setTierFor(prod.id);
    },
    [settings, pos, resolvePrice, p, tx, setPanelOpen],
  );

  const setQuantity = (line: CartLine, quantity: number) => {
    if (!settings || !Number.isFinite(quantity) || quantity <= 0) return;
    const available = catalogQ.data?.find((prod) => prod.id === line.productId)?.available ?? knownProducts[line.productId]?.available ?? line.available;
    if (quantity > available) {
      toast.warning(p.insufficientStock, { description: `${tx(line.name)} — ${p.inStock}: ${available}` });
      return;
    }
    pos.setQty(line.productId, quantity);
  };

  const chooseProduct = (prod: PosProduct, productId?: string) => {
    if (!settings) return;
    const old = pos.lines.find((line) => line.productId === productId);
    if (!old) { setProductFor(null); addProduct(prod); return; }
    if (old.productId === prod.id) { setProductFor(null); return; }
    const existing = pos.lines.find((line) => line.productId === prod.id);
    const quantity = old.quantity + (existing?.quantity ?? 0);
    if (quantity > prod.available) {
      toast.warning(p.insufficientStock, { description: `${tx(prod.name)} — ${p.inStock}: ${prod.available}` });
      return;
    }
    const tier = allowedTiers.includes(old.priceTier as PriceTier) ? old.priceTier as PriceTier : pos.priceTier;
    const resolved = resolvePrice(prod, tier);
    setKnownProducts((products) => ({ ...products, [prod.id]: prod }));
    if (existing) {
      pos.removeLine(old.productId);
      pos.setQty(prod.id, quantity);
    } else {
      pos.replaceLine(old.productId, { productId: prod.id, name: prod.name, barcode: prod.internalBarcode, sku: prod.sku, partNumber: prod.partNumber, listPrice: resolved.price, unitPrice: resolved.price, unitCost: prod.lastPurchaseCost || prod.purchasePrice, priceTier: resolved.tier, discountPercent: 0, available: prod.available, quantity });
    }
    setSelectedLine(prod.id);
    setProductFor(null);
  };

  useScannerWedge(
    (code) => {
      // A second scan beats an open tier popover, which would otherwise eat the barcode's digits.
      setTierFor(null);
      adapter.lookup(code).then((r) => {
        const prod = r.products[0];
        if (prod && r.products.length === 1) {
          if (r.legacyHit) toast.info(p.legacyBarcodeHint);
          addProduct(prod);
        } else if (r.products.length > 1) {
          setPanelOpen(true);
          setProductFor('new');
        } else {
          toast.error(p.productNotFound, { description: code });
        }
      }).catch((e: Error) => toast.error(e.message));
    },
    { enabled: !dialogOpen && !suspended },
  );

  const insufficientLine = () => pos.lines.find(line => line.quantity > (catalogQ.data?.find(product => product.id === line.productId)?.available ?? knownProducts[line.productId]?.available ?? line.available));

  // ---- complete ----
  const complete = useMutation({
    mutationFn: async (input: { payments: PaymentSplit[]; size: InvoiceSize }) => {
      if (insufficientLine()) throw new Error(p.insufficientStock);
      if (discountErrorWithProduct) throw new Error(discountErrorWithProduct);
      const sale = await adapter.createSale({
        branchId: adapter.branchId,
        cashierId: adapter.user.id,
        customerId: pos.customer?.id ?? null,
        registerSessionId: sessionQ.data?.id ?? null,
        items: pos.lines.map((l) => ({ productId: l.productId, name: l.name, barcode: l.barcode, sku: l.sku, partNumber: l.partNumber, quantity: l.quantity, listPrice: l.listPrice, unitPrice: l.unitPrice, unitCost: l.unitCost, priceTier: l.priceTier, discountPercent: l.discountPercent, discount: saleLineDiscount(l) })),
        invoiceDiscount: pos.invoiceDiscount,
        payments: input.payments,
        type: pos.saleType,
        notes: pos.notes.trim() || undefined,
      });
      return sale;
    },
    onSuccess: async (sale, input) => {
      const offline = !adapter.connectivity().online;
      toast.success(p.saleCompleted, { description: `${sale.invoiceNumber} — ${formatMoney(sale.total, locale, settings?.currency.symbol)}${offline ? ` · ${p.savedOffline}` : ''}` });
      pos.clear();
      pos.setLastSale(sale.id);
      setPayOpen(false);
      setReceiptSale(sale);
      qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
      qc.invalidateQueries({ queryKey: ['pos', 'customers'] });
      qc.invalidateQueries({ queryKey: ['pos', 'session'] });
      qc.invalidateQueries({ queryKey: ['pos', 'recentSales'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      if (settings?.pos.openDrawerOnSale && sale.payments.some((x) => x.method === 'cash')) adapter.openDrawer?.().catch(() => toast.warning(p.drawerUnavailable));
      if (printOnComplete) {
        printing.current = true;
        setPrintBusy(true);
        setPrintError(null);
        lastPrintSize.current = input.size;
        try {
          await printSale(sale, input.size);
        } finally {
          printing.current = false;
          setPrintBusy(false);
        }
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const printSale = React.useCallback(
    async (sale: Sale, size: InvoiceSize) => {
      try {
        const profile = { ...checkoutProfileForSize(size), name: size === 'small' ? p.smallInvoice : p.largeInvoice };
        hiddenPrintRef.current = null;
        const mounted = new Promise<void>((resolve) => { printReady.current = resolve; });
        setSilentPrint({ sale, profile });
        // Bounded so a render that never lands cannot wedge the sale behind an unresolved promise.
        await Promise.race([mounted, new Promise((r) => setTimeout(r, 3000))]);
        await Promise.race([document.fonts?.ready ?? Promise.resolve(), new Promise((resolve) => setTimeout(resolve, 3000))]);
        const el = hiddenPrintRef.current;
        if (!el) {
          // Printing anyway would send the whole POS screen to the thermal printer.
          throw new Error(p.printFailed);
        }
        const outcome = await adapter.print(el, profile);
        if (outcome?.status === 'cancelled') toast.info(p.printCancelled);
        else if (outcome?.status === 'saved') toast.success(p.pdfSaved);
        else toast.success(p.printSent);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setReceiptSale(sale);
        setPrintError({ message, size });
      } finally {
        printReady.current = null;
        setSilentPrint(null);
      }
    },
    [adapter, p],
  );

  const reprint = async (size: InvoiceSize) => {
    if (!pos.lastSaleId || printing.current || submitting.current) return;
    printing.current = true;
    lastPrintSize.current = size;
    setPrintBusy(true);
    setPrintError(null);
    try {
      const s = receiptSale?.id === pos.lastSaleId ? receiptSale : await adapter.lastSale(pos.lastSaleId);
      if (!s) { toast.error(p.noLastInvoice); return; }
      setReceiptSale(s);
      await printSale(s, size);
    } catch (error) {
      setPrintError({ message: error instanceof Error ? error.message : String(error), size });
    } finally {
      printing.current = false;
      setPrintBusy(false);
    }
  };

  // The cart can empty while the dialog is up (sale completed, invoice held) — it must not linger on a zero total.
  const cartSize = pos.lines.length;
  React.useEffect(() => {
    if (payOpen && !cartSize) setPayOpen(false);
  }, [payOpen, cartSize]);

  // Two confirms in one tick (double click, scanner's trailing Enter) must not bill twice;
  // `complete.isPending` only flips on the next render, so the guard has to be a ref.
  const submitting = React.useRef(false);

  const openPayment = () => {
    if (!pos.lines.length || !settings || submitting.current || printing.current || tierApplying.current) return;
    if (discountErrorWithProduct) { toast.warning(discountErrorWithProduct); return; }
    if (pos.saleType === 'credit' && !pos.customer) { toast.warning(p.creditRequiresCustomer); setCustOpen(true); return; }
    const short = insufficientLine();
    if (short) { toast.warning(p.insufficientStock, { description: tx(short.name) }); return; }
    setPayOpen(true);
  };

  // ---- shortcuts ----
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (suspended) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // An open dialog owns the keyboard: F4/F10/Delete used to mutate the cart underneath it,
      // so a held invoice could empty the cart while the payment dialog still showed its total.
      if (keyboardCaptured && e.key !== 'F1') return;
      if (e.key === 'F1') { e.preventDefault(); setHelpOpen((o) => !o); }
      else if (e.key === 'F3') { e.preventDefault(); setCustOpen(true); }
      else if (e.key === 'F4') { e.preventDefault(); if (pos.lines.length) { pos.hold(); toast.info(p.invoiceHeld); } }
      else if (e.key === 'F6') { e.preventDefault(); setHeldOpen(true); }
      else if (e.key === 'F7') { e.preventDefault(); void adapter.openCustomerDisplay?.(); }
      else if (e.key === 'F8') { e.preventDefault(); if (pos.lastSaleId) setReprintOpen(true); }
      else if (e.key === 'F9') { e.preventDefault(); openPayment(); }
      else if (e.key === 'F10') { e.preventDefault(); if (pos.lines.length) setCancelOpen(true); }
      else if (e.altKey && (e.key === 'a' || e.key === 'A') && selectedLine) { e.preventDefault(); const l = pos.lines.find((x) => x.productId === selectedLine); if (l) adapter.product(l.productId).then((prod) => prod && setAltFor(prod)); }
      else if (e.key === 'Delete' && !inInput && selectedLine) { e.preventDefault(); pos.removeLine(selectedLine); setSelectedLine(null); }
      else if (e.key === '+' && !inInput && selectedLine) { e.preventDefault(); const l = pos.lines.find((x) => x.productId === selectedLine); if (l) setQuantity(l, l.quantity + 1); }
      else if (e.key === '-' && !inInput && selectedLine) { e.preventDefault(); const l = pos.lines.find((x) => x.productId === selectedLine); if (l) setQuantity(l, l.quantity - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pickAlternative = (alt: AlternativeSuggestion, mode: 'replace' | 'add', tier: PriceTier) => {
    const prod: PosProduct = { ...alt.product, available: alt.qtyAvailable };
    const old = mode === 'replace' && altFor ? pos.lines.find(l => l.productId === altFor.id) : undefined;
    const requested = old?.quantity ?? (pos.lines.find(l => l.productId === prod.id)?.quantity ?? 0) + 1;
    if (requested > prod.available) { toast.warning(p.insufficientStock, { description: tx(prod.name) }); return; }
    setKnownProducts(products => ({ ...products, [prod.id]: prod }));
    const { price, tier: t } = resolvePrice(prod, tier);
    const line: Omit<CartLine, 'quantity'> = { productId: prod.id, name: prod.name, barcode: prod.internalBarcode, sku: prod.sku, partNumber: prod.partNumber, listPrice: price, unitPrice: price, unitCost: prod.lastPurchaseCost || prod.purchasePrice, priceTier: t, discountPercent: 0, available: prod.available };
    if (mode === 'replace' && altFor && pos.lines.some((l) => l.productId === altFor.id)) pos.replaceLine(altFor.id, line);
    else pos.addLine({ ...line, quantity: 1 });
    setSelectedLine(prod.id);
    setAltFor(null);
  };

  if (!settings) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">…</div>;
  const sym = settings.currency.symbol;
  const m = (v: number, d?: number) => formatMoney(v, locale, sym, d ?? settings.currency.decimals);
  const registerClosed = !sessionQ.isLoading && !sessionQ.data;

  const cashierLine = (l: CartLine) => {
    const lineDiscount = saleLineDiscount(l);
    const lineNet = round2(l.unitPrice * l.quantity - lineDiscount);
    const selected = selectedLine === l.productId;
    const prod = catalogQ.data?.find((c) => c.id === l.productId) ?? knownProducts[l.productId];
    const prodPrices = prod?.prices;
    const available = prod?.available ?? l.available;
    return (
      <tr key={l.productId} onClick={() => setSelectedLine(l.productId)} className={cn('border-b text-sm transition-colors last:border-0', selected ? 'bg-primary/10' : 'hover:bg-muted/50')}>
        <td className="px-2 py-1.5">
          <ProductChooser open={productFor === l.productId} onOpenChange={(open) => { setTierFor(null); setProductFor(open ? l.productId : null); }} catalog={filteredProducts} categoryLabel={categoryLabel} brandLabel={brandLabel} loading={catalogQ.isPending} error={catalogQ.isError} onRetry={() => void catalogQ.refetch()} settings={settings} tier={pos.priceTier} sort={filters.sort} current={l.productId} label={tx(l.name)} onPick={(prod) => chooseProduct(prod, l.productId)} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 break-words text-xs text-muted-foreground">
            {l.partNumber ? <span>{p.receipt.partNumber}: <bdi className="num">{l.partNumber}</bdi></span> : null}
            {prod?.size ? <span>{p.productSize}: <bdi className="num">{prod.size}</bdi></span> : null}
            <span>{p.catalogFilters.category}: {categoryLabel(prod)}</span>
            <span>{p.catalogFilters.brand}: {brandLabel(prod)}</span>
            <span>{p.stock}: <bdi className="num">{available}</bdi></span>
            <span>{p.shelf}: {prod?.location || '—'}</span>
            <SimpleTooltip content={`${p.alternatives} (Alt+A)`}>
              <button type="button" onClick={(e) => { e.stopPropagation(); adapter.product(l.productId).then((prod) => prod && setAltFor(prod)); }} className="rounded p-0.5 hover:bg-accent" aria-label={p.alternatives}>
                <PackageSearch className="size-3" />
              </button>
            </SimpleTooltip>
          </div>
        </td>
        <td className="px-2 py-1.5 text-center">
          <div className="inline-flex items-stretch overflow-hidden rounded-md border bg-background" dir="ltr">
            <input type="number" value={l.quantity} min={1} max={available} onChange={(e) => setQuantity(l, Number(e.target.value))} aria-label={`${p.quantity}: ${tx(l.name)}`} className="pos-quantity-input w-10 bg-transparent text-center text-sm tabular focus:outline-none focus:ring-1 focus:ring-ring" onClick={(e) => e.stopPropagation()} />
            <div className="flex flex-col border-s">
              <button type="button" className="px-1 py-0.5 hover:bg-accent disabled:opacity-40" aria-label={`${p.increaseQuantity}: ${tx(l.name)}`} disabled={l.quantity >= available} onClick={(e) => { e.stopPropagation(); setQuantity(l, l.quantity + 1); }}><ChevronUp className="size-3.5" /></button>
              <button type="button" className="border-t px-1 py-0.5 hover:bg-accent disabled:opacity-40" aria-label={`${p.decreaseQuantity}: ${tx(l.name)}`} disabled={l.quantity <= 1} onClick={(e) => { e.stopPropagation(); setQuantity(l, l.quantity - 1); }}><ChevronDown className="size-3.5" /></button>
            </div>
          </div>
        </td>
        <td className="px-2 py-1.5 text-end">
          <div className="flex flex-col items-stretch gap-1">
            <TierChooser
              open={tierFor === l.productId}
              onOpenChange={(o) => setTierFor(o ? l.productId : null)}
              prices={prodPrices ?? { retail1: l.listPrice, retail2: l.listPrice, wholesale: l.listPrice }}
              current={l.priceTier}
              specialPrice={specialFor(specialQ.data ?? [], pos.customer?.id ?? null, l.productId)}
              settings={settings}
              allowedTiers={allowedTiers}
              onPick={(tier, price) => pos.setLineTier(l.productId, tier, price)}
            >
              <button type="button" aria-label={`${p.selectPrice}: ${tx(l.name)}`} disabled={!prodPrices} onClick={(e) => { e.stopPropagation(); setProductFor(null); setTierFor(l.productId); }} className="flex items-center justify-between gap-1 rounded-md border bg-background px-2 py-1.5 text-start hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span><span className="block text-xs">{tierBadgeLabel(settings, l.priceTier, p, locale)}</span><span className="block text-sm font-semibold num">{m(l.unitPrice)}</span></span><ChevronDown className="size-3.5 shrink-0" />
              </button>
            </TierChooser>
          </div>
        </td>
        <td className="px-2 py-1.5 text-end">
          <div className="font-medium num">{m(lineNet)}</div>
          {canItemDiscount || lineDiscount > 0 ? <button type="button" aria-label={`${p.lineDiscount}: ${tx(l.name)}`} disabled={suspended || complete.isPending} onClick={(event) => { event.stopPropagation(); setProductFor(null); setTierFor(null); setDiscountFor({ productId: l.productId }); }} className="mt-1 rounded px-1 py-0.5 text-xs text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.discount}{lineDiscount > 0 ? `: ${m(lineDiscount)}` : ' +'}</button> : null}
        </td>
        <td className="px-1 py-1.5"><Button variant="ghost" size="icon-xs" onClick={(e) => { e.stopPropagation(); pos.removeLine(l.productId); }} aria-label={p.delete}><X /></Button></td>
      </tr>
    );
  };

  const printCtx = (sale: Sale) => ({
    sale,
    settings,
    branchName: adapter.branchName?.(sale.branchId),
    cashier: adapter.user,
    customer: (customersQ.data ?? []).find((c) => c.id === sale.customerId) ?? null,
    products: Object.fromEntries((catalogQ.data ?? []).map((c) => [c.id, c])),
    brands: Object.fromEntries((metadataQ.data?.brands ?? []).map((b) => [b.id, b])),
    categories: Object.fromEntries((metadataQ.data?.categories ?? []).map((c) => [c.id, c])),
    terminalCode: adapter.terminalCode,
    verifyBaseUrl,
  });

  return (
    <div className={cn('flex h-full min-w-0 flex-col overflow-hidden', className)}>
      {/* Left */}
      <div className="flex min-h-0 flex-1 flex-col bg-background">
        <div className="flex flex-wrap items-center gap-2 border-b p-2">
          <label className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2 py-1 text-sm font-medium">
            <span>{p.customerPriceType}</span>
            <select aria-label={p.customerPriceType} value={pos.priceTier} disabled={dialogOpen || Boolean(tierFor) || suspended} onChange={(event) => void applyCustomerTier(event.target.value as PriceTier)} className="h-9 w-36 rounded-md border border-input bg-background px-2 text-start text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
              {allowedTiers.map((tier) => <option key={tier} value={tier}>{tx(settings.pricing.tierLabels[tier])}</option>)}
            </select>
            <span className="text-xs font-normal text-muted-foreground" role={tierBusy ? 'status' : undefined}>{tierBusy ? p.loading : p.priceTypeAllProducts}</span>
          </label>
          {adapter.recentSales && has('sales.view') ? <Button variant="outline" onClick={() => { setProductFor(null); setTierFor(null); setSalesOpen(true); }}><ReceiptText />{p.salesHistory.title}</Button> : null}
          {adapter.cashMovement && canDrawer ? <SimpleTooltip content={p.drawer.title}><Button variant="outline" size="icon" onClick={() => setDrawerOpen(true)} aria-label={p.drawer.title}><Banknote /></Button></SimpleTooltip> : null}
          {adapter.collectDebt && canCollect ? <SimpleTooltip content={p.collect.title}><Button variant="outline" size="icon" onClick={() => setCollectOpen(true)} aria-label={p.collect.title}><HandCoins /></Button></SimpleTooltip> : null}
          <SimpleTooltip content={`${p.shortcuts} (F1)`}><Button variant="outline" size="icon" onClick={() => setHelpOpen(true)} aria-label={p.shortcuts}><HelpCircle /></Button></SimpleTooltip>
          {adapter.openCustomerDisplay ? <SimpleTooltip content={`${p.customerDisplay} (F7)`}><Button variant="outline" size="icon" onClick={() => void adapter.openCustomerDisplay?.()} aria-label={p.customerDisplay}><Monitor /></Button></SimpleTooltip> : null}
        </div>
        <ProductFilters value={filters} onChange={changeFilters} open={filtersOpen} onOpenChange={setFiltersOpen} metadata={metadataQ.data} disabled={keyboardCaptured || suspended} />

        {registerClosed ? (
          <div className="p-3">
            <Alert variant="warning" title={p.registerClosed}>
              <div className="flex flex-wrap items-center gap-2">
                <span>{p.registerClosedDesc}</span>
                <Button size="xs" variant="outline" onClick={() => adapter.navigate('/cash-registers')}>{p.openRegister}</Button>
              </div>
            </Alert>
          </div>
        ) : null}
        {connectivity.unregistered ? <div className="px-3 pt-2"><Alert variant="destructive" title={p.unregistered}>{p.unregisteredDesc}</Alert></div> : !connectivity.online ? <div className="px-3 pt-2"><Alert variant="warning">{adapter.offlineNotice ?? p.offlineNotice}</Alert></div> : null}

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-2 text-xs font-medium text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 py-2"><PackageSearch className="size-3.5" /> {p.products}</span>
            <Button size="xs" variant="outline" onClick={() => setQuickOpen(!quickOpen)} disabled={!panelOpen} aria-label={quickOpen ? p.quickProducts.hide : p.quickProducts.show} aria-expanded={quickOpen} aria-controls="pos-quick-products-panel">
              {quickOpen ? <PanelRightClose /> : <PanelRightOpen />} {quickOpen ? p.quickProducts.hide : p.quickProducts.show}
            </Button>
          </div>
          <span className="flex items-center gap-1">
            <SimpleTooltip content={panelOpen ? p.hidePanel : p.showPanel}>
              <Button size="xs" variant="outline" onClick={() => setPanelOpen(!panelOpen)} aria-label={panelOpen ? p.hidePanel : p.showPanel} aria-expanded={panelOpen} aria-controls="pos-products-panel">
                {panelOpen ? <PanelBottomClose /> : <PanelBottomOpen />} {panelOpen ? p.hidePanel : p.showPanel}
              </Button>
            </SimpleTooltip>
            <ConnectivityBadge adapter={adapter} compact />
          </span>
        </div>
        <div dir="rtl" className={cn('pos-workspace min-h-0 flex-1', !panelOpen && 'pos-products-collapsed')}>
        <div id="pos-products-panel" dir="rtl" className={cn('pos-catalog bg-card', !quickOpen && 'pos-quick-collapsed')} role="region" aria-label={p.products} aria-hidden={!panelOpen}>
          <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="pos-product-lines min-h-0 overflow-auto">
            <table className="w-full min-w-[30rem] table-fixed" aria-label={p.products}>
              <thead className="sticky top-0 z-10 bg-muted/90 text-[11px] text-muted-foreground backdrop-blur">
                <tr><th className="px-2 py-1.5 text-start font-medium">{p.product}</th><th className="w-20 px-2 py-1.5 text-center font-medium">{p.quantity}</th><th className="w-32 px-2 py-1.5 text-end font-medium">{p.price}</th><th className="w-28 px-2 py-1.5 text-end font-medium">{p.lineValue}</th><th className="w-8"><span className="sr-only">{p.delete}</span></th></tr>
              </thead>
              <tbody>{pos.lines.map(cashierLine)}<tr>
                <td className="p-2"><ProductChooser open={productFor === 'new'} onOpenChange={(open) => { setTierFor(null); setProductFor(open ? 'new' : null); }} catalog={filteredProducts} categoryLabel={categoryLabel} brandLabel={brandLabel} loading={catalogQ.isPending} error={catalogQ.isError} onRetry={() => void catalogQ.refetch()} settings={settings} tier={pos.priceTier} sort={filters.sort} onPick={(prod) => chooseProduct(prod)} /></td>
                <td className="p-2 text-center text-muted-foreground">—</td><td className="p-2 text-end text-muted-foreground">—</td><td className="p-2 text-end text-muted-foreground">—</td><td />
              </tr></tbody>
            </table>
            {pos.lines.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
                <BarcodeIcon className="size-10 opacity-30" />
                <div className="text-sm font-medium">{p.emptyCart}</div>
                <div className="text-xs">{p.selectProduct} · {p.emptyCartHint}</div>
              </div>
            ) : null}
          </div>
          <section id="pos-quick-products-panel" dir={locale === 'ar' ? 'rtl' : 'ltr'} hidden={!quickOpen} className="pos-quick-products bg-card" aria-label={p.quickProducts.title}>
            <h3 className="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-sm font-semibold"><PackageSearch className="size-4 shrink-0" />{p.quickProducts.title}</h3>
            <div id="pos-quick-products-grid" className="min-h-0 flex-1 overflow-auto p-2">
              {catalogQ.isPending ? <div role="status" className="p-3 text-sm text-muted-foreground">{p.loading}</div> : catalogQ.isError ? (
                <div className="p-3 text-sm"><p role="alert">{p.catalogLoadError}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void catalogQ.refetch()}>{p.retryPrint}</Button></div>
              ) : quickProducts.length === 0 ? <div className="p-3 text-sm text-muted-foreground">{p.noProducts}</div> : (
                <div className="pos-quick-grid">
                  {quickProducts.slice(0, quickLimit).map((prod) => {
                    const quantity = pos.lines.find((line) => line.productId === prod.id)?.quantity ?? 0;
                    return (
                      <button key={prod.id} type="button" aria-label={`${p.quickProducts.add}: ${tx(prod.name)}`} disabled={prod.available - quantity < 1} onClick={() => addProduct(prod)} className="flex min-w-0 flex-col gap-1 rounded-md border bg-background p-2 text-start hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                        <span className="break-words text-sm font-medium">{tx(prod.name)}</span>
                        <span className="text-sm font-semibold num">{m(resolvePrice(prod, pos.priceTier).price)}</span>
                        <span className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground"><span>{p.catalogFilters.category}: {categoryLabel(prod)}</span><span>{p.catalogFilters.brand}: {brandLabel(prod)}</span><span>{p.stock}: <bdi className="num">{prod.available}</bdi></span><span>{p.shelf}: {prod.location || '—'}</span></span>
                      </button>
                    );
                  })}
                </div>
              )}
              {quickProducts.length > quickLimit ? <Button type="button" size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setQuickLimit((limit) => limit + 24)}>{p.showMore}</Button> : null}
            </div>
          </section>
      </div>

      {/* Invoice customer, totals and checkout controls. Product editing belongs to the products panel. */}
      <div dir={locale === 'ar' ? 'rtl' : 'ltr'} className="pos-cart flex min-h-0 min-w-0 flex-col bg-card" role="region" aria-label={p.invoiceDetails}>
        <div className="border-b px-3 py-2 text-sm font-semibold">{p.invoiceDetails}</div>
        <div className="flex items-center gap-2 border-b p-2">
          <Button variant={pos.customer ? 'secondary' : 'outline'} size="sm" className="h-9 flex-1 justify-start gap-2 overflow-hidden" onClick={() => setCustOpen(true)}>
            {pos.customer ? <User className="shrink-0" /> : <UserX className="shrink-0 text-muted-foreground" />}
            <span className="truncate">{pos.customer ? tx(pos.customer.name) : p.walkIn}</span>
            {pos.customer ? <Badge variant="outline" className="ms-auto shrink-0">{p.types[pos.customer.type]}</Badge> : <Kbd className="ms-auto">F3</Kbd>}
          </Button>
          {pos.customer ? <Button variant="ghost" size="icon-sm" onClick={() => pos.setCustomer(null)} aria-label={p.clear}><X /></Button> : null}

        </div>

        <div className="grid grid-cols-2 gap-1 border-b p-2">
          <Button size="sm" variant={pos.saleType === 'cash' ? 'default' : 'outline'} aria-pressed={pos.saleType === 'cash'} disabled={dialogOpen || suspended} onClick={() => pos.setSaleType('cash')}><Banknote /> {p.cashSale}</Button>
          <Button size="sm" variant={pos.saleType === 'credit' ? 'default' : 'outline'} aria-pressed={pos.saleType === 'credit'} disabled={dialogOpen || suspended} onClick={() => pos.setSaleType('credit')}><CreditCard /> {p.creditSale}</Button>
        </div>
        <div className="shrink-0 border-t bg-muted/30 p-3">
          <div className="space-y-1 text-sm">
            {totals.itemDiscounts > 0 || pos.invoiceDiscount > 0 ? <>
              <div className="flex justify-between gap-1"><span>{p.beforeDiscount}</span><span className="num">{m(totals.subtotal)}</span></div>
              {totals.itemDiscounts > 0 ? <div className="flex justify-between gap-1 text-muted-foreground"><span>{p.itemDiscount}</span><span className="num">−{m(totals.itemDiscounts)}</span></div> : null}
            </> : null}
            {canInvoiceDiscount || pos.invoiceDiscount > 0 ? <div className="flex items-center justify-between gap-1"><button type="button" onClick={() => { setProductFor(null); setTierFor(null); setDiscountFor({}); }} disabled={!pos.lines.length || suspended || complete.isPending} className="rounded py-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{p.invoiceDiscount}{pos.invoiceDiscount > 0 ? '' : ' +'}</button><span className="num">{pos.invoiceDiscount > 0 ? `−${m(pos.invoiceDiscount)}` : m(0)}</span></div> : null}
            {discountErrorWithProduct ? <Alert variant="destructive">{discountErrorWithProduct}</Alert> : null}
            <div className="flex flex-wrap items-baseline justify-between gap-1 border-t pt-2"><span className="text-base font-semibold">{p.total}</span><span className="text-2xl font-bold tabular num">{m(totals.total)}</span></div>
          </div>
          <div className="pos-invoice-actions mt-3 grid grid-cols-4 gap-1.5">
            <Button variant="outline" size="sm" onClick={() => { pos.hold(); toast.info(p.invoiceHeld); }} disabled={!pos.lines.length} className="h-12 flex-col gap-0 text-[11px]"><PauseCircle /> {p.holdInvoice} <Kbd className="h-4 text-[9px]">F4</Kbd></Button>
            <Button variant="outline" size="sm" onClick={() => setHeldOpen(true)} className="relative h-12 flex-col gap-0 text-[11px]"><PlayCircle /> {p.resumeInvoice} <Kbd className="h-4 text-[9px]">F6</Kbd>{pos.held.length ? <span className="absolute -end-1 -top-1 flex size-4 items-center justify-center rounded-full bg-warning text-[10px] text-white">{pos.held.length}</span> : null}</Button>
            <Button variant="outline" size="sm" onClick={() => (adapter.createSaleReturn ? setReturnOpen(true) : adapter.navigate('/sales/returns'))} className="h-12 flex-col gap-0 text-[11px]" disabled={!has('returns.create')}><Undo2 /> {p.returnSale}</Button>
            <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)} disabled={!pos.lines.length} className="h-12 flex-col gap-0 text-[11px] text-destructive hover:text-destructive"><Ban /> {p.cancelInvoice} <Kbd className="h-4 text-[9px]">F10</Kbd></Button>
          </div>
          <div className="mt-2">
            <Button size="lg" className="h-12 w-full text-base" onClick={openPayment} disabled={!pos.lines.length || registerClosed || complete.isPending || printBusy || tierBusy || Boolean(discountErrorWithProduct)}>
              <CreditCard /> {p.completeSale} <Kbd className="ms-2 bg-white/20 text-white">F9</Kbd>
            </Button>
          </div>
          <div className="mt-3 border-t pt-2" aria-live="polite">
            <div className="mb-2 text-xs text-muted-foreground">{printBusy ? p.printSending : receiptSale ? <>{p.printLastInvoice}: <bdi className="num font-semibold text-foreground">{receiptSale.invoiceNumber}</bdi></> : p.noLastInvoice}</div>
            <Button variant="outline" className="w-full" disabled={!pos.lastSaleId || printBusy || complete.isPending} onClick={() => setReprintOpen(true)}><Printer /> {p.reprintReceipt} <Kbd>F8</Kbd></Button>
          </div>
        </div>
        <section className="pos-invoice-notes shrink-0 border-t p-3" aria-label={p.notes}>
          <label htmlFor="pos-invoice-notes" className="mb-2 block text-sm font-semibold">{p.notes}</label>
          <Textarea id="pos-invoice-notes" value={pos.notes} onChange={(event) => pos.setNotes(event.target.value)} placeholder={p.notesPlaceholder} rows={4} disabled={keyboardCaptured || suspended} className="min-h-24 resize-y" data-scanner-ignore />
        </section>
      </div>
      </div>
      </div>

      {/* Dialogs */}
      {discountFor && (() => {
        const line = discountFor.productId ? pos.lines.find(l => l.productId === discountFor.productId) : undefined;
        if (discountFor.productId && !line) return null;
        const base = line ? round2(line.unitPrice * line.quantity) : round2(totals.subtotal - totals.itemDiscounts);
        const currentAmount = line ? saleLineDiscount(line) : pos.invoiceDiscount;
        const otherDiscounts = totals.itemDiscounts + pos.invoiceDiscount - currentAmount;
        const permitted = line ? canItemDiscount : canInvoiceDiscount;
        const lineLimit = line ? (line && catalogQ.data?.find((product) => product.id === line.productId)?.maxDiscountAmount || discountLimit) : base;
        const maxAmount = permitted ? Math.max(0, Math.min(base, discountLimit - otherDiscounts, lineLimit)) : 0;
        return <DiscountDialog title={line ? `${p.lineDiscount}: ${tx(line.name)}` : p.invoiceDiscount} base={base} maxAmount={round2(maxAmount)} initialValue={currentAmount} formatMoney={m} onClose={() => setDiscountFor(null)} onApply={(value) => { if (line) pos.setLineDiscount(line.productId, value); else pos.setInvoiceDiscount(value); setDiscountFor(null); }} />;
      })()}
      {adapter.recentSales && has('sales.view') ? <SalesDialog open={salesOpen} onOpenChange={setSalesOpen} adapter={adapter} settings={settings} customers={customersQ.data ?? []} /> : null}
      <PrintDialog open={reprintOpen} onOpenChange={setReprintOpen} title={p.reprintReceipt} initialSize={lastPrintSize.current} onPrint={reprint} />
      {/* Native printing can interrupt animationend. Unmount payment immediately so its portal cannot trap the empty cart. */}
      {payOpen && cartSize > 0 ? <PaymentDialog open onOpenChange={setPayOpen} total={totals.total} settings={settings} saleType={pos.saleType} customer={(customersQ.data ?? []).find(c => c.id === pos.customer?.id) ?? pos.customer} loading={complete.isPending} printOnConfirm={printOnComplete} onConfirm={(payments, size) => { if (submitting.current || printing.current) return; submitting.current = true; complete.mutate({ payments, size }, { onSettled: () => { submitting.current = false; } }); }} /> : null}
      <CustomerPicker open={custOpen} onOpenChange={setCustOpen} customers={customersQ.data ?? []} currencySymbol={sym} onSelect={(c: Customer | null) => { pos.setCustomer(c); setCustOpen(false); }} onCreate={async (i) => { const c = await adapter.createCustomer(i); qc.invalidateQueries({ queryKey: ['pos', 'customers'] }); return c; }} />
      <AlternativesDialog
        open={Boolean(altFor)}
        onOpenChange={(o) => !o && setAltFor(null)}
        requested={altFor}
        requestedAvailable={altFor?.available ?? 0}
        suggestions={altQ.data}
        loading={altQ.isLoading}
        settings={settings}
        tier={pos.priceTier}
        allowedTiers={allowedTiers}
        canTransfer={canTransfer}
        inCart={Boolean(altFor && pos.lines.some((l) => l.productId === altFor.id))}
        branchName={adapter.branchName}
        onPick={pickAlternative}
        onRequestTransfer={adapter.requestTransfer ? (alt, branchId) => { void adapter.requestTransfer?.(alt.product.id, branchId, 1).then(() => toast.success(p.transferRequested)).catch((e: Error) => toast.error(e.message)); setAltFor(null); } : undefined}
      />
      {adapter.cashMovement ? (
        <CashDrawerDialog
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          session={sessionQ.data ?? null}
          settings={settings}
          onPost={async (i) => { await adapter.cashMovement!(i); toast.success(p.drawer.posted); await qc.invalidateQueries({ queryKey: ['pos', 'session'] }); }}
        />
      ) : null}
      {adapter.collectDebt ? (
        <CollectDebtDialog
          open={collectOpen}
          onOpenChange={setCollectOpen}
          customers={customersQ.data ?? []}
          preselected={pos.customer}
          settings={settings}
          onCollect={async (i) => { await adapter.collectDebt!(i); toast.success(p.collect.done); await Promise.all([qc.invalidateQueries({ queryKey: ['pos', 'customers'] }), qc.invalidateQueries({ queryKey: ['pos', 'session'] })]); }}
        />
      ) : null}
      {adapter.createSaleReturn ? (
        <ReturnDialog
          open={returnOpen}
          onOpenChange={setReturnOpen}
          settings={settings}
          findInvoice={(inv) => adapter.saleByInvoice?.(inv) ?? Promise.resolve(null)}
          recentSales={() => adapter.recentSales?.(30) ?? Promise.resolve([])}
          onSubmit={(i) => adapter.createSaleReturn!({ ...i, registerSessionId: sessionQ.data?.id ?? null })}
          onDone={(ret) => {
            toast.success(p.returns.done, { description: `${ret.invoiceNumber} — ${m(ret.refundAmount)}` });
            qc.invalidateQueries({ queryKey: ['pos', 'session'] });
            qc.invalidateQueries({ queryKey: ['pos', 'customers'] });
            qc.invalidateQueries({ queryKey: ['pos', 'catalog'] });
            qc.invalidateQueries({ queryKey: ['pos', 'recentSales'] });
          }}
        />
      ) : null}
      <Dialog open={Boolean(printError)} onOpenChange={(open) => !open && setPrintError(null)}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{p.printFailed}</DialogTitle><DialogDescription>{printError?.message}</DialogDescription></DialogHeader>
          <p className="text-sm text-muted-foreground">{p.invoiceStillSaved} <bdi className="num">{receiptSale?.invoiceNumber}</bdi></p>
          {printError ? <InvoiceSizeSelector value={printError.size} onChange={(size) => setPrintError((current) => current ? { ...current, size } : null)} disabled={printBusy} /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPrintError(null)}>{p.close}</Button>
            <Button onClick={() => { const size = printError!.size; void reprint(size); }}>{p.retryPrint}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{p.confirmCancel}</DialogTitle><DialogDescription>{p.confirmCancelDesc}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>{p.cancel}</Button>
            <Button variant="destructive" onClick={() => { pos.clear(); setCancelOpen(false); toast.info(p.invoiceCancelled); }}>{p.cancelInvoice}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet open={heldOpen} onOpenChange={setHeldOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{p.heldInvoices}</SheetTitle></SheetHeader>
          <div className="mt-4 space-y-2">
            {pos.held.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">{p.noHeld}</div> : pos.held.map((h) => {
              const ht = cartTotals(h.lines, h.invoiceDiscount);
              return (
                <div key={h.id} className="rounded-md border p-3">
                  <div className="flex items-center justify-between text-sm"><span className="font-medium num">{h.id}</span><span className="font-semibold num">{m(ht.total)}</span></div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(h.heldAt)} · {h.lines.length} {p.items} · {h.customer ? tx(h.customer.name) : p.walkIn}</div>
                  <div className="mt-2 flex gap-2">
                    <Button size="sm" onClick={() => { pos.resume(h.id); setHeldOpen(false); }}><PlayCircle /> {p.resumeInvoice}</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => pos.dropHeld(h.id)}><Trash2 /> {p.delete}</Button>
                  </div>
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent>
          <SheetHeader><SheetTitle>{p.shortcuts}</SheetTitle></SheetHeader>
          <div className="mt-4 grid gap-1.5 text-sm">
            {Object.entries(p.shortcutsList).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between rounded border px-2 py-1"><span>{v}</span><Kbd>{k === 'plusMinus' ? '+ / −' : k === 'digits' ? '1 2 3' : k === 'A' ? 'Alt+A' : k}</Kbd></div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Off-screen print area: visible only when printing (web) or captured by the host (desktop). */}
      {silentPrint ? (
        <div className="print-area pos-print-root fixed -left-[10000px] top-0 print:static print:left-0" aria-hidden>
          <style>{pageStyleFor(silentPrint.profile)}</style>
          <RenderGuard>
            <InvoiceDocument
              ref={(el: HTMLDivElement | null) => {
                hiddenPrintRef.current = el;
                if (el) printReady.current?.();
              }}
              {...printCtx(silentPrint.sale)}
              profile={silentPrint.profile}
            />
          </RenderGuard>
        </div>
      ) : null}
    </div>
  );
}

export { uuid };
