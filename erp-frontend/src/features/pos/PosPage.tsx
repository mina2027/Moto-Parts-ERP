import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PosLocaleContext, PosTerminal, createPosStore, useConnectivity, usePosT } from '@moto/pos-core';
import { DEFAULT_SETTINGS, tx } from '@moto/shared';
import { Alert, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Sheet, SheetContent, SheetHeader, SheetTitle, cn } from '@moto/ui';
import { ArrowRightFromLine, Cloud, CloudOff, Languages, Lock, RefreshCw } from 'lucide-react';
import { ErrorState, PageLoading } from '@/components/shared/states';
import { DeveloperCredit } from '@/components/shared/developer-credit';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { createWebPosAdapter } from './webAdapter';
import { FontSizeControl, useFontSize } from './components/FontSizeControl';
import { CloseRegisterDialogBody, OpenRegisterScreen } from './screens/RegisterScreen';
import { LockScreen } from './screens/LockScreen';
import { displayChannelName, type DisplaySnapshot } from './customerDisplay';

const PUBLIC_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) || window.location.origin;

export default function PosPage() {
  const session = useAuthStore((s) => s.session!);
  const locale = useUiStore((s) => s.locale);
  return <PosLocaleContext.Provider value={locale}><PosShell key={`${session.user.id}.${session.user.branchId}`} /></PosLocaleContext.Provider>;
}

function PosShell() {
  const { p, locale } = usePosT();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const session = useAuthStore((s) => s.session!);
  const setLocale = useUiStore((s) => s.setLocale);
  const fontSize = useFontSize();
  const branchId = session.user.branchId;
  const [store] = React.useState(() => createPosStore(undefined, `moto-pos-web.${session.user.id}.${branchId}`));
  const [skipRegister, setSkipRegister] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const lockKey = `pos.locked.${session.user.id}.${branchId}`;
  const [locked, setLocked] = React.useState(() => {
    try { return sessionStorage.getItem(lockKey) === '1'; } catch { return false; }
  });
  const branchesQ = useQuery({ queryKey: ['pos', 'branches'], queryFn: () => api.branches.list(), staleTime: 300_000 });
  const branchName = React.useCallback((id: string) => {
    const branch = branchesQ.data?.find((b) => b.id === id);
    return branch ? tx(branch.name, locale) : id;
  }, [branchesQ.data, locale]);
  const adapter = React.useMemo(() => createWebPosAdapter({
    user: session.user, permissions: session.permissions, branchId, locale, branchName,
    navigate: (path) => path === '/cash-registers' ? setSkipRegister(false) : navigate(path),
    openCustomerDisplay: async () => {
      const display = window.open('/pos/display', 'moto-pos-customer-display', 'popup,width=1024,height=768');
      if (!display) toast.error(locale === 'ar' ? 'اسمح بالنوافذ المنبثقة لفتح شاشة العميل' : 'Allow popups to open the customer display');
      else display.focus();
    },
    refresh: async () => { await qc.invalidateQueries({ queryKey: ['pos'] }); },
  }), [session.user, session.permissions, branchId, locale, branchName, navigate, qc]);
  const status = useConnectivity(adapter);
  const sessionQ = useQuery({ queryKey: ['pos', 'session'], queryFn: () => adapter.currentSession(), refetchInterval: 30_000 });
  const settingsQ = useQuery({ queryKey: ['pos', 'settings'], queryFn: () => adapter.settings(), staleTime: 60_000 });
  const lockAfter = settingsQ.data?.pos.idleLockMinutes ?? DEFAULT_SETTINGS.pos.idleLockMinutes;
  const canOpen = session.permissions.includes('cash.open');
  const canClose = session.permissions.includes('cash.close');

  React.useEffect(() => {
    document.body.classList.add('moto-pos-mode');
    return () => document.body.classList.remove('moto-pos-mode');
  }, []);
  React.useEffect(() => {
    try { sessionStorage.setItem(lockKey, locked ? '1' : '0'); } catch { /* Keep the lock in memory. */ }
  }, [lockKey, locked]);
  React.useEffect(() => {
    if (lockAfter <= 0 || locked) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setLocked(true), lockAfter * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((event) => window.addEventListener(event, arm, true));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((event) => window.removeEventListener(event, arm, true));
    };
  }, [lockAfter, locked]);

  React.useEffect(() => {
    if (!settingsQ.data || typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(displayChannelName(session.user.id, branchId));
    const push = () => {
      const cart = store.getState();
      const snapshot: DisplaySnapshot = { lines: cart.lines, invoiceDiscount: cart.invoiceDiscount, customer: cart.customer, lastSaleId: cart.lastSaleId, settings: settingsQ.data!, locale };
      channel.postMessage({ type: 'state', snapshot });
    };
    channel.onmessage = (event) => { if (event.data?.type === 'ready') push(); };
    const unsubscribe = store.subscribe(push);
    push();
    return () => { unsubscribe(); channel.close(); };
  }, [store, session.user.id, branchId, settingsQ.data, locale]);

  const refreshShift = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['pos', 'session'] }),
      qc.invalidateQueries({ queryKey: ['pos', 'registers'] }),
      qc.invalidateQueries({ queryKey: ['sessions'] }),
      qc.invalidateQueries({ queryKey: ['registers'] }),
    ]);
  };
  const noShift = !sessionQ.isPending && !sessionQ.isError && !sessionQ.data;
  const openingShift = noShift && !skipRegister;
  const blocked = locked || closeOpen || statusOpen;
  const exitLabel = locale === 'ar' ? 'الخروج من POS' : 'Exit POS';
  const exitTarget = session.permissions.includes('reports.view') ? '/dashboard'
    : session.permissions.includes('sales.view') ? '/sales'
    : session.permissions.includes('inventory.view') ? '/inventory' : '/alerts';
  const exitButton = <Button size="xs" variant="outline" onClick={() => navigate(exitTarget)} title={locale === 'ar' ? 'العودة إلى ERP' : 'Back to ERP'}><ArrowRightFromLine /> {exitLabel}</Button>;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {!openingShift ? <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1 text-sm">
        <span className="font-semibold">MotoParts POS</span>
        <span className="num text-xs text-muted-foreground">WEB · v{__APP_VERSION__}</span>
        <button type="button" onClick={() => setStatusOpen(true)} className="ms-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
          {status.online ? <Cloud className="size-3.5 text-success" /> : <CloudOff className="size-3.5 text-destructive" />}
          <span className={cn(status.online ? 'text-success' : 'text-destructive')}>{status.syncing ? p.shell.syncing : status.online ? p.online : p.offline}</span>
          {status.syncing ? <RefreshCw className="size-3 animate-spin" /> : null}
        </button>
        <FontSizeControl {...fontSize} />
        <span className="ms-auto flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{tx(session.user.fullName, locale)}</span>
          {sessionQ.data && canClose ? <Button size="xs" variant="ghost" onClick={() => setCloseOpen(true)}><Lock /> {p.shell.closeShift}</Button> : null}
          <Button size="icon-xs" variant="ghost" onClick={() => setLocked(true)} aria-label={p.idle.lockNow} title={p.idle.lockNow}><Lock /></Button>
          <Button size="icon-xs" variant="ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} aria-label={p.shell.language}><Languages /></Button>
          {exitButton}
        </span>
      </header> : <div className="flex shrink-0 justify-end border-b bg-card px-3 py-1">{exitButton}</div>}
      {noShift && skipRegister ? <Alert variant="warning" className="rounded-none border-x-0 border-t-0 px-3 py-1.5 text-xs"><span className="flex items-center gap-2">{p.shell.noShiftBanner}<Button size="xs" variant="outline" onClick={() => setSkipRegister(false)}>{p.shell.openShift}</Button></span></Alert> : null}
      <main className="min-h-0 flex-1" {...(blocked ? { inert: '' } : {})} aria-hidden={blocked || undefined}>
        {sessionQ.isPending || settingsQ.isPending ? <PageLoading /> : sessionQ.isError || settingsQ.isError ? <ErrorState onRetry={() => { void sessionQ.refetch(); void settingsQ.refetch(); }} /> : openingShift ? (
          <OpenRegisterScreen branchId={branchId} canOpen={canOpen} onOpened={async (opened) => { qc.setQueryData(['pos', 'session'], opened); setSkipRegister(false); await refreshShift(); }} onSkip={() => setSkipRegister(true)} />
        ) : <PosTerminal adapter={adapter} store={store} verifyBaseUrl={PUBLIC_URL} printOnComplete suspended={blocked} />}
      </main>
      <DeveloperCredit className="border-t bg-card px-4 py-2" />
      <Sheet open={statusOpen} onOpenChange={setStatusOpen} modal={!locked}>
        <SheetContent className="w-[480px] sm:max-w-[480px]">
          <SheetHeader><SheetTitle className="flex items-center justify-between">
            <span>{p.shell.sync}</span>
            <Button size="sm" variant="outline" disabled={!status.online || status.syncing} onClick={() => void adapter.syncNow?.().catch((error: Error) => toast.error(error.message))}><RefreshCw className={status.syncing ? 'animate-spin' : ''} /> {p.shell.syncNow}</Button>
          </SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{p.shell.status}</div><div className={status.online ? 'text-success' : 'text-destructive'}>{status.online ? p.online : p.offline}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{p.shell.waiting}</div><div className="num font-semibold">{status.pending}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{p.shell.rejected}</div><div className="num font-semibold">{status.rejected}</div></div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">{locale === 'ar' ? 'المبيعات تُحفظ مباشرة على السيرفر. إتمام البيع يحتاج اتصالاً بالإنترنت.' : 'Sales are saved directly to the server. Checkout requires an internet connection.'}</p>
          <div className="py-10 text-center text-sm text-muted-foreground">{p.shell.noOps}</div>
        </SheetContent>
      </Sheet>
      <Dialog open={closeOpen} onOpenChange={setCloseOpen} modal={!locked}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{p.shell.closeShift}</DialogTitle></DialogHeader>
          {sessionQ.data ? <CloseRegisterDialogBody session={sessionQ.data} settings={settingsQ.data ?? DEFAULT_SETTINGS} onClosed={async () => {
            setCloseOpen(false); setSkipRegister(false); toast.success(p.shell.shiftClosed); await refreshShift();
          }} /> : null}
        </DialogContent>
      </Dialog>
      {locked ? <LockScreen session={session} onUnlock={() => setLocked(false)} /> : null}
    </div>
  );
}
