import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Globe, KeyRound, LogOut, Menu, Moon, Search, Sun, User as UserIcon, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Avatar, Kbd } from '@/components/ui/misc';
import { Sidebar } from './sidebar';
import { GlobalSearch } from './global-search';
import { ChangePasswordDialog } from './change-password-dialog';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { useT } from '@/i18n';
import { reportService } from '@/services';
import { cn, timeAgo } from '@/lib/utils';

export function Header() {
  const { t, tx, locale } = useT();
  const navigate = useNavigate();
  const session = useAuthStore((s) => s.session);
  const logout = useAuthStore((s) => s.logout);
  const { theme, setTheme, setLocale } = useUiStore();
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [mobileNav, setMobileNav] = React.useState(false);
  const [pwdOpen, setPwdOpen] = React.useState(false);

  const notifications = useQuery({ queryKey: ['notifications'], queryFn: reportService.notifications, refetchInterval: 30000 });
  const unread = notifications.data?.filter((n) => !n.read).length ?? 0;

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const user = session?.user;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3">
      <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileNav(true)} aria-label="menu">
        <Menu />
      </Button>
      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="start" className="w-64 p-0 [&>button]:text-white">
          <Sidebar mobile onNavigate={() => setMobileNav(false)} />
        </SheetContent>
      </Sheet>

      <button type="button" onClick={() => setSearchOpen(true)} className="hidden h-8 w-72 items-center gap-2 rounded-md border bg-background px-2.5 text-sm text-muted-foreground hover:bg-accent md:flex xl:w-96">
        <Search className="size-4" />
        <span className="flex-1 truncate text-start text-xs">{t('header.searchHint')}</span>
        <Kbd>Ctrl K</Kbd>
      </button>
      <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setSearchOpen(true)} aria-label={t('common.search')}>
        <Search />
      </Button>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="flex-1" />

      {/* Notifications */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="relative" aria-label={t('header.notifications')}>
            <Bell />
            {unread > 0 ? <span className="absolute -end-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">{unread}</span> : null}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-sm font-semibold">{t('header.notifications')}</span>
            <Button variant="link" size="xs" className="h-auto p-0 text-xs" onClick={async () => { await reportService.markAllRead(); notifications.refetch(); }}>{t('header.markAllRead')}</Button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {notifications.data?.length ? notifications.data.map((n) => (
              <button key={n.id} type="button" className={cn('flex w-full items-start gap-2 border-b px-3 py-2 text-start last:border-0 hover:bg-accent', !n.read && 'bg-primary/5')} onClick={async () => { await reportService.markRead(n.id); notifications.refetch(); if (n.link) navigate(n.link); }}>
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{tx(n.title)}</span>
                  <span className="block text-xs text-muted-foreground line-clamp-2">{tx(n.body)}</span>
                  <span className="block text-[10px] text-muted-foreground">{timeAgo(n.date, locale)}</span>
                </span>
              </button>
            )) : <div className="p-6 text-center text-xs text-muted-foreground">{t('header.noNotifications')}</div>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Language */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('header.language')}><Globe /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={locale} onValueChange={(v) => setLocale(v as 'ar' | 'en')}>
            <DropdownMenuRadioItem value="ar">العربية</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en">English</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Theme */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t('header.theme')}>{theme === 'dark' ? <Moon /> : theme === 'light' ? <Sun /> : <Monitor />}</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as 'light' | 'dark' | 'system')}>
            <DropdownMenuRadioItem value="light">{t('header.light')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">{t('header.dark')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">{t('header.system')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* User */}
      {user ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex items-center gap-2 rounded-md p-1 hover:bg-accent">
              <Avatar name={tx(user.fullName)} color={user.avatarColor} size="sm" />
              <span className="hidden text-start lg:block">
                <span className="block max-w-[140px] truncate text-xs font-medium leading-tight">{tx(user.fullName)}</span>
                <span className="block text-[10px] leading-tight text-muted-foreground">{t(`roles.${user.role}`)}</span>
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="text-sm">{tx(user.fullName)}</div>
              <div className="text-xs font-normal text-muted-foreground">{user.email}</div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate(`/users/${user.id}`)}><UserIcon /> {t('common.profile')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setPwdOpen(true)}><KeyRound /> {t('common.changePassword')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={async () => { await logout(); navigate('/login'); }}><LogOut /> {t('common.logout')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <ChangePasswordDialog open={pwdOpen} onOpenChange={setPwdOpen} />
    </header>
  );
}
