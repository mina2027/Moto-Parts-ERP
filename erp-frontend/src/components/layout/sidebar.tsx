import { NavLink, useLocation } from 'react-router-dom';
import { Bike, ChevronsLeft } from 'lucide-react';
import { NAV_GROUPS } from '@/config/navigation';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { SimpleTooltip } from '@/components/ui/misc';

export function Sidebar({ mobile, onNavigate }: { mobile?: boolean; onNavigate?: () => void }) {
  const { t } = useT();
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const collapsed = useUiStore((s) => s.sidebarCollapsed) && !mobile;
  const toggle = useUiStore((s) => s.toggleSidebar);
  const location = useLocation();

  return (
    <aside className={cn('flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200', collapsed ? 'w-14' : 'w-60')}>
      <div className={cn('flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-3', collapsed && 'justify-center px-0')}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Bike className="size-5" />
        </div>
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{t('app.name')}</div>
          </div>
        ) : null}
      </div>

      <nav className="flex-1 overflow-y-auto overflow-x-hidden py-2" aria-label="main">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((it) => !it.permission || hasPermission(it.permission));
          if (!items.length) return null;
          return (
            <div key={group.labelKey} className="mb-2">
              {!collapsed ? <div className="px-4 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50">{t(group.labelKey)}</div> : <div className="mx-3 my-2 border-t border-sidebar-border" />}
              <ul className="space-y-0.5 px-2">
                {items.map((item) => {
                  const active = location.pathname === item.path || (item.path !== '/dashboard' && location.pathname.startsWith(item.path + '/') && !NAV_GROUPS.flatMap((g) => g.items).some((o) => o.path !== item.path && o.path.startsWith(item.path + '/') && location.pathname.startsWith(o.path)));
                  const link = (
                    <NavLink
                      to={item.path}
                      onClick={onNavigate}
                      className={cn('flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors hover:bg-sidebar-accent hover:text-white', active && 'bg-primary/90 text-white hover:bg-primary', collapsed && 'justify-center px-0')}
                      aria-current={active ? 'page' : undefined}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
                    </NavLink>
                  );
                  return <li key={item.key}>{collapsed ? <SimpleTooltip content={t(item.labelKey)} side="right">{link}</SimpleTooltip> : link}</li>;
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {!mobile ? (
        <button type="button" onClick={toggle} className="flex h-10 shrink-0 items-center justify-center border-t border-sidebar-border text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-white" aria-label={t('header.toggleSidebar')}>
          <ChevronsLeft className={cn('size-4 transition-transform rtl:rotate-180', collapsed && 'rotate-180 rtl:rotate-0')} />
        </button>
      ) : null}
    </aside>
  );
}
