import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { branchService, customerService, productService, supplierService, inventoryService } from '@/services';
import { useT } from '@/i18n';
import { useAuthStore } from '@/stores/authStore';
import type { ID } from '@/types';

const STALE = 5 * 60_000;

/** Centralized reference-data lookups (names by id), API-backed via react-query. */
export function useLookups() {
  const { tx } = useT();
  const enabled = useAuthStore((s) => s.status === 'authenticated');
  const can = useAuthStore((s) => s.hasPermission);
  // Each lookup is gated by the same permissions the API route enforces so no page spams 403s.
  const branches = useQuery({ queryKey: ['branches'], queryFn: branchService.list, staleTime: STALE, enabled: enabled && can(['branches.view', 'sales.create', 'inventory.view']) });
  const users = useQuery({ queryKey: ['users', 'all'], queryFn: branchService.allUsers, staleTime: STALE, enabled: enabled && can(['users.view', 'sales.view', 'inventory.view', 'reports.view']) });
  const brands = useQuery({ queryKey: ['brands'], queryFn: productService.brands, staleTime: STALE, enabled });
  const categories = useQuery({ queryKey: ['categories'], queryFn: productService.categories, staleTime: STALE, enabled });
  const suppliers = useQuery({ queryKey: ['suppliers', 'all'], queryFn: supplierService.all, staleTime: STALE, enabled: enabled && can(['suppliers.view', 'purchases.view', 'inventory.view']) });
  const warehouses = useQuery({ queryKey: ['warehouses', 'all'], queryFn: () => inventoryService.warehouses(), staleTime: STALE, enabled: enabled && can(['inventory.view', 'sales.create', 'reports.view', 'purchases.view']) });
  const customers = useQuery({ queryKey: ['customers', 'all'], queryFn: customerService.all, staleTime: 60_000, enabled: enabled && can(['customers.view', 'sales.create']) });
  // Historical documents still need archived names, but operational pickers only offer live products.
  const products = useQuery({ queryKey: ['products', 'all', 'history'], queryFn: () => productService.all(undefined, true), staleTime: 60_000, enabled: enabled && can(['inventory.view', 'sales.create', 'reports.view', 'purchases.view', 'customers.view']) });
  const models = useQuery({ queryKey: ['models'], queryFn: productService.models, staleTime: STALE, enabled });
  const expenseCategories = useQuery({ queryKey: ['expenseCategories'], queryFn: branchService.expenseCategories, staleTime: STALE, enabled: enabled && can(['expenses.view', 'expenses.create', 'reports.view', 'cash.close']) });
  const registers = useQuery({ queryKey: ['registers', 'all'], queryFn: () => branchService.registers(), staleTime: STALE, enabled: enabled && can(['cash.open', 'cash.close', 'sales.create']) });

  const branchName = useCallback((id?: ID | null) => tx(branches.data?.find((b) => b.id === id)?.name) || '—', [branches.data, tx]);
  const userName = useCallback((id?: ID | null) => tx(users.data?.find((u) => u.id === id)?.fullName) || '—', [users.data, tx]);
  const brandName = useCallback((id?: ID | null) => tx(brands.data?.find((b) => b.id === id)?.name) || '—', [brands.data, tx]);
  const categoryName = useCallback((id?: ID | null) => tx(categories.data?.find((c) => c.id === id)?.name) || '—', [categories.data, tx]);
  const supplierName = useCallback((id?: ID | null) => tx(suppliers.data?.find((s) => s.id === id)?.name) || '—', [suppliers.data, tx]);
  const warehouseName = useCallback((id?: ID | null) => tx(warehouses.data?.find((w) => w.id === id)?.name) || '—', [warehouses.data, tx]);
  const customerName = useCallback((id?: ID | null) => (id ? tx(customers.data?.find((c) => c.id === id)?.name) || '—' : null), [customers.data, tx]);
  const productName = useCallback((id?: ID | null) => tx(products.data?.find((p) => p.id === id)?.name) || '—', [products.data, tx]);
  const product = useCallback((id?: ID | null) => products.data?.find((p) => p.id === id), [products.data]);
  const modelName = useCallback((id?: ID | null) => tx(models.data?.find((m) => m.id === id)?.name) || '—', [models.data, tx]);
  const expenseCategoryName = useCallback((id?: ID | null) => tx(expenseCategories.data?.find((c) => c.id === id)?.name) || '—', [expenseCategories.data, tx]);
  const registerName = useCallback((id?: ID | null) => tx(registers.data?.find((r) => r.id === id)?.name) || '—', [registers.data, tx]);

  // Labels carry the full path so a deep tree stays unambiguous in a flat <select>.
  const categoryOptions = useMemo(() => {
    const list = categories.data ?? [];
    const byId = new Map(list.map((c) => [c.id, c]));
    const path = (c: (typeof list)[number]) => [...c.ancestors.map((a) => tx(byId.get(a)?.name)).filter(Boolean), tx(c.name)].join(' › ');
    return list
      .filter((c) => c.isActive)
      .map((c) => ({ value: c.id, label: path(c) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [categories.data, tx]);

  const categoryPath = useCallback(
    (id?: ID | null) => {
      const list = categories.data ?? [];
      const c = list.find((x) => x.id === id);
      if (!c) return '—';
      const byId = new Map(list.map((x) => [x.id, x]));
      return [...c.ancestors.map((a) => tx(byId.get(a)?.name)).filter(Boolean), tx(c.name)].join(' › ');
    },
    [categories.data, tx],
  );

  const options = useMemo(
    () => ({
      branches: (branches.data ?? []).map((b) => ({ value: b.id, label: tx(b.name) })),
      activeBranches: (branches.data ?? []).filter((b) => b.isActive).map((b) => ({ value: b.id, label: tx(b.name) })),
      users: (users.data ?? []).map((u) => ({ value: u.id, label: tx(u.fullName) })),
      brands: (brands.data ?? []).map((b) => ({ value: b.id, label: tx(b.name) })),
      categories: categoryOptions,
      suppliers: (suppliers.data ?? []).map((s) => ({ value: s.id, label: tx(s.name) })),
      warehouses: (warehouses.data ?? []).map((w) => ({ value: w.id, label: tx(w.name) })),
      customers: (customers.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: tx(c.name) })),
      // Keywords let a scanned barcode resolve the product in purchases, transfers and stock counts.
      products: (products.data ?? []).filter((p) => p.isActive && !p.deletedAt).map((p) => ({
        value: p.id,
        label: `${tx(p.name)} (${p.sku})`,
        sublabel: [p.internalBarcode, p.partNumber].filter(Boolean).join(' · '),
        keywords: [p.internalBarcode, p.legacyBarcode, p.partNumber, p.sku].filter((x): x is string => Boolean(x)),
      })),
      models: (models.data ?? []).map((m) => ({ value: m.id, label: tx(m.name) })),
      expenseCategories: (expenseCategories.data ?? []).map((c) => ({ value: c.id, label: tx(c.name) })),
    }),
    [branches.data, users.data, brands.data, categoryOptions, suppliers.data, warehouses.data, customers.data, products.data, models.data, expenseCategories.data, tx],
  );

  return {
    branches: branches.data ?? [],
    users: users.data ?? [],
    brands: brands.data ?? [],
    categories: categories.data ?? [],
    suppliers: suppliers.data ?? [],
    warehouses: warehouses.data ?? [],
    customers: customers.data ?? [],
    products: products.data ?? [],
    models: models.data ?? [],
    expenseCategories: expenseCategories.data ?? [],
    registers: registers.data ?? [],
    branchName, userName, brandName, categoryName, categoryPath, supplierName, warehouseName, customerName, productName, product, modelName, expenseCategoryName, registerName,
    options,
  };
}
