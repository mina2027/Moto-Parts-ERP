import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeftRight, BarChart3, Boxes, Building2, HandCoins, Package, Receipt, ReceiptText, ShoppingBag, TrendingUp, Truck, Undo2, Users, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '@/components/shared/page';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import type { Permission } from '@/types';

export type ReportKey = 'sales' | 'profit' | 'purchases' | 'inventory' | 'productMovement' | 'topProducts' | 'lowStock' | 'customerDebts' | 'supplierBalances' | 'employees' | 'branchPerformance' | 'expenses' | 'cashRegisters' | 'returns';

export const REPORTS: { key: ReportKey; icon: LucideIcon; category: 'sales' | 'inventory' | 'finance' | 'people'; permission?: Permission }[] = [
  { key: 'sales', icon: Receipt, category: 'sales' },
  { key: 'profit', icon: TrendingUp, category: 'sales', permission: 'reports.financial' },
  { key: 'topProducts', icon: BarChart3, category: 'sales' },
  { key: 'returns', icon: Undo2, category: 'sales' },
  { key: 'purchases', icon: ShoppingBag, category: 'inventory', permission: 'purchases.view' },
  { key: 'inventory', icon: Boxes, category: 'inventory', permission: 'inventory.view' },
  { key: 'productMovement', icon: ArrowLeftRight, category: 'inventory', permission: 'inventory.view' },
  { key: 'lowStock', icon: AlertTriangle, category: 'inventory', permission: 'inventory.view' },
  { key: 'customerDebts', icon: HandCoins, category: 'finance' },
  { key: 'supplierBalances', icon: Truck, category: 'finance', permission: 'reports.financial' },
  { key: 'expenses', icon: ReceiptText, category: 'finance', permission: 'expenses.view' },
  { key: 'cashRegisters', icon: Wallet, category: 'finance' },
  { key: 'employees', icon: Users, category: 'people' },
  { key: 'branchPerformance', icon: Building2, category: 'people' },
];

export default function ReportsPage() {
  const { t } = useT();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const cats = ['sales', 'inventory', 'finance', 'people'] as const;
  return (
    <div>
      <PageHeader title={t('reports.title')} subtitle={t('reports.subtitle')} />
      {cats.map((c) => {
        const items = REPORTS.filter((r) => r.category === c && (!r.permission || hasPermission(r.permission)));
        if (!items.length) return null;
        return (
          <div key={c} className="mb-5">
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(`reports.categories.${c}`)}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {items.map((r) => (
                <Link key={r.key} to={`/reports/${r.key}`} className="group flex items-start gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary hover:bg-accent/40">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-hover:bg-primary group-hover:text-white"><r.icon className="size-5" /></div>
                  <div className="min-w-0"><div className="font-medium">{t(`reports.${r.key}`)}</div><div className="mt-0.5 text-xs text-muted-foreground">{t(`reports.descriptions.${r.key}`)}</div></div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground"><Package className="size-4" /> {t('reports.exportHint')}</div>
    </div>
  );
}
