import type { LucideIcon } from 'lucide-react';
import {
  LayoutDashboard, Receipt, Package, Boxes, Warehouse, ArrowLeftRight, ShoppingBag, Truck, Users, HandCoins, Tags, Wallet, ReceiptText, UserCog, Building2, BarChart3,
  MessageCircle, ScrollText, Settings, Calculator, Bike, Barcode as BarcodeIcon, Undo2, ShieldCheck, Snowflake, BellRing, FolderTree, ScanLine,
} from 'lucide-react';
import type { Permission } from '@/types';

export interface NavItem {
  key: string;
  labelKey: string;
  path: string;
  icon: LucideIcon;
  permission?: Permission | Permission[];
  children?: { labelKey: string; path: string; permission?: Permission | Permission[] }[];
}

export interface NavGroup {
  labelKey: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: 'nav.groupMain',
    items: [
      { key: 'dashboard', labelKey: 'nav.dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'reports.view' },
    ],
  },
  {
    labelKey: 'nav.groupOps',
    items: [
      { key: 'pos', labelKey: 'nav.pos', path: '/pos', icon: ScanLine, permission: 'sales.create' },
      { key: 'sales', labelKey: 'nav.sales', path: '/sales', icon: Receipt, permission: 'sales.view' },
      { key: 'returns', labelKey: 'nav.returns', path: '/sales/returns', icon: Undo2, permission: 'returns.create' },
      { key: 'purchases', labelKey: 'nav.purchases', path: '/purchases', icon: ShoppingBag, permission: 'purchases.view' },
      { key: 'transfers', labelKey: 'nav.transfers', path: '/transfers', icon: ArrowLeftRight, permission: 'inventory.transfer' },
    ],
  },
  {
    labelKey: 'nav.groupInventory',
    items: [
      { key: 'products', labelKey: 'nav.products', path: '/products', icon: Package, permission: 'inventory.view' },
      { key: 'categories', labelKey: 'nav.categories', path: '/products/categories', icon: FolderTree, permission: 'inventory.view' },
      { key: 'compatibility', labelKey: 'nav.compatibility', path: '/products/compatibility', icon: Bike, permission: 'inventory.view' },
      { key: 'barcodes', labelKey: 'nav.barcodes', path: '/products/barcodes', icon: BarcodeIcon, permission: 'inventory.view' },
      { key: 'inventory', labelKey: 'nav.inventory', path: '/inventory', icon: Boxes, permission: 'inventory.view' },
      { key: 'warehouses', labelKey: 'nav.warehouses', path: '/warehouses', icon: Warehouse, permission: 'inventory.view' },
      { key: 'pricing', labelKey: 'nav.pricing', path: '/pricing', icon: Tags, permission: ['prices.edit', 'prices.view_cost'] },
    ],
  },
  {
    labelKey: 'nav.groupFinance',
    items: [
      { key: 'debts', labelKey: 'nav.debts', path: '/debts', icon: HandCoins, permission: 'customers.credit' },
      { key: 'cash', labelKey: 'nav.cashRegisters', path: '/cash-registers', icon: Wallet, permission: ['cash.open', 'cash.close'] },
      { key: 'expenses', labelKey: 'nav.expenses', path: '/expenses', icon: ReceiptText, permission: 'expenses.view' },
      { key: 'accounting', labelKey: 'nav.accounting', path: '/accounting', icon: Calculator, permission: 'reports.financial' },
      { key: 'reports', labelKey: 'nav.reports', path: '/reports', icon: BarChart3, permission: 'reports.view' },
      { key: 'deadStock', labelKey: 'upgrade.deadStock', path: '/reports/dead-stock', icon: Snowflake, permission: ['reports.view', 'inventory.view'] },
      { key: 'alerts', labelKey: 'upgrade.alertsCenter', path: '/alerts', icon: BellRing },
    ],
  },
  {
    labelKey: 'nav.groupPeople',
    items: [
      { key: 'customers', labelKey: 'nav.customers', path: '/customers', icon: Users, permission: 'customers.view' },
      { key: 'suppliers', labelKey: 'nav.suppliers', path: '/suppliers', icon: Truck, permission: 'suppliers.view' },
      { key: 'users', labelKey: 'nav.users', path: '/users', icon: UserCog, permission: 'users.view' },
      { key: 'roles', labelKey: 'nav.roles', path: '/roles', icon: ShieldCheck, permission: 'users.roles' },
      { key: 'branches', labelKey: 'nav.branches', path: '/branches', icon: Building2, permission: 'branches.view' },
    ],
  },
  {
    labelKey: 'nav.groupSystem',
    items: [
      { key: 'whatsapp', labelKey: 'nav.whatsapp', path: '/whatsapp', icon: MessageCircle, permission: 'whatsapp.send' },
      { key: 'audit', labelKey: 'nav.auditLogs', path: '/audit-logs', icon: ScrollText, permission: 'audit.view' },
      { key: 'settings', labelKey: 'nav.settings', path: '/settings', icon: Settings, permission: 'settings.view' },
    ],
  },
];

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
