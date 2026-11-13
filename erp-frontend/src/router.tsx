import { lazy, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { NoPermission } from '@/components/shared/states';
import { RouteErrorBoundary } from '@/components/shared/error-boundary';
import { useAuthStore } from '@/stores/authStore';
import { HomeRedirect } from '@/features/auth/HomeRedirect';
import type { Permission } from '@/types';

const LoginPage = lazy(() => import('@/features/auth/LoginPage'));
const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage'));
const PosPage = lazy(() => import('@/features/pos/PosPage'));
const CustomerDisplayPage = lazy(() => import('@/features/pos/CustomerDisplayPage'));
const SalesListPage = lazy(() => import('@/features/sales/SalesListPage'));
const SaleDetailsPage = lazy(() => import('@/features/sales/SaleDetailsPage'));
const ReturnsPage = lazy(() => import('@/features/sales/ReturnsPage'));
const ProductsListPage = lazy(() => import('@/features/products/ProductsListPage'));
const ProductDetailsPage = lazy(() => import('@/features/products/ProductDetailsPage'));
const CompatibilityPage = lazy(() => import('@/features/products/CompatibilityPage'));
const BarcodesPage = lazy(() => import('@/features/products/BarcodesPage'));
const CategoriesPage = lazy(() => import('@/features/products/CategoriesPage'));
const InventoryPage = lazy(() => import('@/features/inventory/InventoryPage'));
const MovementsPage = lazy(() => import('@/features/inventory/MovementsPage'));
const StockCountPage = lazy(() => import('@/features/inventory/StockCountPage'));
const WarehousesPage = lazy(() => import('@/features/warehouses/WarehousesPage'));
const WarehouseDetailsPage = lazy(() => import('@/features/warehouses/WarehouseDetailsPage'));
const TransfersPage = lazy(() => import('@/features/transfers/TransfersPage'));
const TransferDetailsPage = lazy(() => import('@/features/transfers/TransferDetailsPage'));
const PurchasesPage = lazy(() => import('@/features/purchases/PurchasesPage'));
const PurchaseDetailsPage = lazy(() => import('@/features/purchases/PurchaseDetailsPage'));
const SuppliersPage = lazy(() => import('@/features/suppliers/SuppliersPage'));
const SupplierDetailsPage = lazy(() => import('@/features/suppliers/SupplierDetailsPage'));
const CustomersPage = lazy(() => import('@/features/customers/CustomersPage'));
const CustomerDetailsPage = lazy(() => import('@/features/customers/CustomerDetailsPage'));
const DebtsPage = lazy(() => import('@/features/debts/DebtsPage'));
const PricingPage = lazy(() => import('@/features/pricing/PricingPage'));
const CashRegistersPage = lazy(() => import('@/features/cash/CashRegistersPage'));
const SessionDetailsPage = lazy(() => import('@/features/cash/SessionDetailsPage'));
const ExpensesPage = lazy(() => import('@/features/expenses/ExpensesPage'));
const UsersPage = lazy(() => import('@/features/users/UsersPage'));
const UserDetailsPage = lazy(() => import('@/features/users/UserDetailsPage'));
const RolesPage = lazy(() => import('@/features/users/RolesPage'));
const BranchesPage = lazy(() => import('@/features/branches/BranchesPage'));
const BranchDetailsPage = lazy(() => import('@/features/branches/BranchDetailsPage'));
const ReportsPage = lazy(() => import('@/features/reports/ReportsPage'));
const ReportViewPage = lazy(() => import('@/features/reports/ReportViewPage'));
const AccountingPage = lazy(() => import('@/features/reports/AccountingPage'));
const WhatsAppPage = lazy(() => import('@/features/whatsapp/WhatsAppPage'));
const AuditLogsPage = lazy(() => import('@/features/audit/AuditLogsPage'));
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'));
const LabelDesignerPage = lazy(() => import('@/features/products/LabelDesignerPage'));
const DeadStockPage = lazy(() => import('@/features/reports/DeadStockPage'));
const AlertsPage = lazy(() => import('@/features/notifications/AlertsPage'));
const VerifyInvoicePage = lazy(() => import('@/features/public/VerifyInvoicePage'));

function RequireAuth() {
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <AppLayout />;
}

function Guard({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const ok = useAuthStore((s) => s.hasPermission(permission));
  return ok ? <>{children}</> : <NoPermission />;
}

const g = (permission: Permission | Permission[], el: ReactNode) => <Guard permission={permission}>{el}</Guard>;

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage />, errorElement: <RouteErrorBoundary /> },
  { path: '/v/:id', element: <VerifyInvoicePage />, errorElement: <RouteErrorBoundary /> },
  {
    path: '/',
    element: <RequireAuth />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <HomeRedirect /> },
      { path: 'dashboard', element: g('reports.view', <DashboardPage />) },
      { path: 'pos', element: g('sales.create', <PosPage />) },
      { path: 'pos/display', element: g('sales.create', <CustomerDisplayPage />) },
      { path: 'sales', element: g('sales.view', <Outlet />), children: [
        { index: true, element: <SalesListPage /> },
        { path: 'returns', element: g('returns.create', <ReturnsPage />) },
        { path: ':id', element: <SaleDetailsPage /> },
      ] },
      { path: 'products', element: g('inventory.view', <Outlet />), children: [
        { index: true, element: <ProductsListPage /> },
        { path: 'categories', element: <CategoriesPage /> },
        { path: 'compatibility', element: <CompatibilityPage /> },
        { path: 'barcodes', element: <BarcodesPage /> },
        { path: 'labels/designer', element: <LabelDesignerPage /> },
        { path: ':id', element: <ProductDetailsPage /> },
      ] },
      { path: 'inventory', element: g('inventory.view', <Outlet />), children: [
        { index: true, element: <InventoryPage /> },
        { path: 'movements', element: <MovementsPage /> },
        { path: 'counts/:id', element: <StockCountPage /> },
      ] },
      { path: 'warehouses', element: g('inventory.view', <Outlet />), children: [
        { index: true, element: <WarehousesPage /> },
        { path: ':id', element: <WarehouseDetailsPage /> },
      ] },
      { path: 'transfers', element: g('inventory.transfer', <Outlet />), children: [
        { index: true, element: <TransfersPage /> },
        { path: ':id', element: <TransferDetailsPage /> },
      ] },
      { path: 'purchases', element: g('purchases.view', <Outlet />), children: [
        { index: true, element: <PurchasesPage /> },
        { path: ':id', element: <PurchaseDetailsPage /> },
      ] },
      { path: 'suppliers', element: g('suppliers.view', <Outlet />), children: [
        { index: true, element: <SuppliersPage /> },
        { path: ':id', element: <SupplierDetailsPage /> },
      ] },
      { path: 'customers', element: g('customers.view', <Outlet />), children: [
        { index: true, element: <CustomersPage /> },
        { path: ':id', element: <CustomerDetailsPage /> },
      ] },
      { path: 'debts', element: g('customers.credit', <DebtsPage />) },
      { path: 'pricing', element: g(['prices.edit', 'prices.view_cost'], <PricingPage />) },
      { path: 'cash-registers', element: g(['cash.open', 'cash.close'], <Outlet />), children: [
        { index: true, element: <CashRegistersPage /> },
        { path: 'sessions/:id', element: <SessionDetailsPage /> },
      ] },
      { path: 'expenses', element: g('expenses.view', <ExpensesPage />) },
      { path: 'users', element: g('users.view', <Outlet />), children: [
        { index: true, element: <UsersPage /> },
        { path: ':id', element: <UserDetailsPage /> },
      ] },
      { path: 'roles', element: g('users.roles', <RolesPage />) },
      { path: 'branches', element: g('branches.view', <Outlet />), children: [
        { index: true, element: <BranchesPage /> },
        { path: ':id', element: <BranchDetailsPage /> },
      ] },
      // dead-stock is reachable by warehouse staff (inventory.view) as well as report viewers.
      { path: 'reports/dead-stock', element: g(['reports.view', 'inventory.view'], <DeadStockPage />) },
      { path: 'reports', element: g('reports.view', <Outlet />), children: [
        { index: true, element: <ReportsPage /> },
        { path: ':key', element: <ReportViewPage /> },
      ] },
      { path: 'alerts', element: <AlertsPage /> },
      { path: 'accounting', element: g('reports.financial', <AccountingPage />) },
      { path: 'whatsapp', element: g('whatsapp.send', <WhatsAppPage />) },
      { path: 'audit-logs', element: g('audit.view', <AuditLogsPage />) },
      { path: 'settings', element: g('settings.view', <SettingsPage />) },
      { path: '*', element: <HomeRedirect /> },
    ],
  },
]);
