import type { RendererSession } from '../../shared/ipc';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PosLocaleContext, PosTerminal, createPosStore, usePosT } from '@moto/pos-core';
import type { AppSettings, Locale, RegisterSession } from '@moto/shared';
import { DEFAULT_SETTINGS, tx } from '@moto/shared';
import { Alert, Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, cn } from '@moto/ui';
import { Cloud, CloudOff, Languages, Lock, LogOut, RefreshCw, Download } from 'lucide-react';
import { createIpcAdapter } from './ipcAdapter';
import { ErrorBoundary } from './ErrorBoundary';
import { FontSizeControl, useFontSize } from './components/FontSizeControl';
import { PairingScreen } from './screens/PairingScreen';
import { LoginScreen } from './screens/LoginScreen';
import { LockScreen } from './screens/LockScreen';
import { SyncPanel } from './screens/SyncPanel';
import { CloseRegisterDialogBody, OpenRegisterScreen } from './screens/RegisterScreen';
import type { ConnectivityInfo, PairingInfo } from '../../shared/ipc';

const store = createPosStore(undefined, 'moto-pos-desktop');

export function App() {
  const fontSize = useFontSize();
  const [locale, setLocale] = React.useState<Locale>((localStorage.getItem('locale') as Locale) || 'ar');
  React.useEffect(() => {
    document.documentElement.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', locale);
    localStorage.setItem('locale', locale);
  }, [locale]);
  return (
    <PosLocaleContext.Provider value={locale}>
      <ErrorBoundary>
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <Shell locale={locale} setLocale={setLocale} fontSize={fontSize} />
          </div>
          <footer dir="ltr" className="shrink-0 border-t bg-card px-4 py-2 text-center text-xs text-muted-foreground print:hidden">
            Developed by Mina Magdy
          </footer>
        </div>
      </ErrorBoundary>
    </PosLocaleContext.Provider>
  );
}

/** Minutes of no keyboard/mouse activity before the terminal locks itself. 0 disables it. */
function idleMinutes(settings: AppSettings | undefined): number {
  return settings?.pos.idleLockMinutes ?? DEFAULT_SETTINGS.pos.idleLockMinutes;
}

function Shell({ locale, setLocale, fontSize }: { locale: Locale; setLocale: (l: Locale) => void; fontSize: ReturnType<typeof useFontSize> }) {
  const { p } = usePosT();
  const qc = useQueryClient();
  const [pairing, setPairing] = React.useState<PairingInfo | null>(null);
  const [session, setSession] = React.useState<RendererSession | null>(null);
  const [status, setStatus] = React.useState<ConnectivityInfo>({ online: false, syncing: false, unregistered: false, pending: 0, rejected: 0, lastSyncAt: null, lastPullAt: null, error: null });
  const [syncOpen, setSyncOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [skipRegister, setSkipRegister] = React.useState(false);
  const [updateReady, setUpdateReady] = React.useState(false);
  const [version, setVersion] = React.useState('');
  const lockTerminal = React.useCallback(() => {
    void window.pos.auth.lock().then(() => setLocked(true));
  }, []);

  React.useEffect(() => {
    void window.pos.app.pairing().then(setPairing);
    void window.pos.auth.cachedSession().then((s) => s && setSession(s));
    void window.pos.sync.status().then(setStatus);
    void window.pos.app.version().then(setVersion);
    const off1 = window.pos.sync.onStatus(setStatus);
    const off2 = window.pos.sync.onDataChanged((what) => {
      if (what === 'update-ready') setUpdateReady(true);
      if (what === 'auth-locked') setLocked(true);
      qc.invalidateQueries({ queryKey: ['pos'] });
      qc.invalidateQueries({ queryKey: ['outbox'] });
    });
    return () => {
      off1();
      off2();
    };
  }, [qc]);

  const sessionQ = useQuery({ queryKey: ['pos', 'session'], queryFn: () => window.pos.data.currentSession(), enabled: Boolean(session) });
  const settingsQ = useQuery({ queryKey: ['pos', 'settings'], queryFn: () => window.pos.data.settings(), enabled: Boolean(session), staleTime: 60_000 });
  const branchesQ = useQuery({ queryKey: ['pos', 'branches'], queryFn: () => window.pos.data.branches(), enabled: Boolean(session), staleTime: 300_000 });
  const branchName = React.useCallback(
    (id: string) => {
      const b = branchesQ.data?.find((x) => x.id === id);
      return b ? tx(b.name, locale) : id;
    },
    [branchesQ.data, locale],
  );

  // Idle lock: any real input resets the timer, so it never fires mid-transaction.
  const lockAfter = idleMinutes(settingsQ.data);
  React.useEffect(() => {
    if (!session || lockAfter <= 0 || locked) return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lockTerminal, lockAfter * 60_000);
    };
    const events: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'wheel', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, arm, true));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm, true));
    };
  }, [session, lockAfter, locked]);

  // Customer display mirror: push cart state on every store change.
  React.useEffect(() => store.subscribe((s) => window.pos.display.push({ lines: s.lines, invoiceDiscount: s.invoiceDiscount, customer: s.customer, lastSaleId: s.lastSaleId })), []);

  const adapter = React.useMemo(
    () =>
      session && pairing?.terminal
        ? createIpcAdapter({
            user: session.user,
            permissions: session.permissions,
            branchId: pairing.branchId ?? session.user.branchId,
            terminalCode: pairing.terminal.code,
            locale,
            branchName,
            navigate: (path) => {
              if (path === '/cash-registers') setSkipRegister(false);
            },
          })
        : null,
    [session, pairing, locale, branchName],
  );

  if (!pairing) return null;
  if (!pairing.paired) return <PairingScreen onPaired={(info) => { setPairing(info); toast.success(p.shell.paired); }} />;
  if (!session) return <LoginScreen pairing={pairing} online={status.online} onLogin={(next) => { qc.clear(); setSession(next); }} onUnpair={async () => { await window.pos.app.unpair(); qc.clear(); setPairing(await window.pos.app.pairing()); }} />;
  if (!sessionQ.isLoading && !sessionQ.data && !skipRegister) {
    return <OpenRegisterScreen defaultRegisterId={pairing.terminal?.registerId ?? null} onOpened={() => qc.invalidateQueries({ queryKey: ['pos', 'session'] })} onSkip={() => setSkipRegister(true)} />;
  }

  const noShift = !sessionQ.isLoading && !sessionQ.data;

  return (
    <div className="flex h-full flex-col">
      <header className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-1 text-sm">
        <span className="font-semibold">MotoParts POS</span>
        <span className="num text-xs text-muted-foreground">{pairing.terminal?.code} · v{version}</span>
        <button type="button" onClick={() => setSyncOpen(true)} className="ms-2 inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs hover:bg-accent">
          {status.online && !status.unregistered ? <Cloud className="size-3.5 text-success" /> : <CloudOff className="size-3.5 text-destructive" />}
          <span className={cn(status.online && !status.unregistered ? 'text-success' : 'text-destructive')}>
            {status.unregistered ? p.unregistered : status.syncing ? p.shell.syncing : status.online ? p.online : p.offline}
          </span>
          {status.pending ? <Badge variant="warning" className="h-4 px-1 text-[10px] num">{status.pending}</Badge> : null}
          {status.rejected ? <Badge variant="destructive" className="h-4 px-1 text-[10px] num">{status.rejected}</Badge> : null}
          {status.syncing ? <RefreshCw className="size-3 animate-spin" /> : null}
        </button>
        {updateReady ? <Button size="xs" variant="secondary" onClick={() => window.pos.app.quitAndInstall()}><Download /> {p.shell.updateReady}</Button> : null}
        <FontSizeControl {...fontSize} />
        <span className="ms-auto flex items-center gap-1">
          <span className="text-xs text-muted-foreground">{tx(session.user.fullName, locale)}</span>
          {sessionQ.data ? <Button size="xs" variant="ghost" onClick={() => setCloseOpen(true)}><Lock /> {p.shell.closeShift}</Button> : null}
          <Button size="icon-xs" variant="ghost" onClick={lockTerminal} aria-label={p.idle.lockNow} title={p.idle.lockNow}><Lock /></Button>
          <Button size="icon-xs" variant="ghost" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')} aria-label={p.shell.language}><Languages /></Button>
          <Button size="icon-xs" variant="ghost" onClick={async () => { await window.pos.auth.logout(); qc.clear(); setSession(null); }} aria-label={p.shell.logout}><LogOut /></Button>
        </span>
      </header>
      {noShift ? (
        <Alert variant="warning" className="rounded-none border-x-0 border-t-0 px-3 py-1.5 text-xs">
          <span className="flex items-center gap-2">
            {p.shell.noShiftBanner}
            <Button size="xs" variant="outline" onClick={() => setSkipRegister(false)}>{p.shell.openShift}</Button>
          </span>
        </Alert>
      ) : null}
      <main className="min-h-0 flex-1">{adapter ? <PosTerminal adapter={adapter} store={store} verifyBaseUrl={pairing.serverUrl} printOnComplete suspended={locked || closeOpen || syncOpen} /> : null}</main>
      <SyncPanel open={syncOpen} onOpenChange={setSyncOpen} status={status} onReregistered={setPairing} onSessionCleared={() => { qc.clear(); setSession(null); }} />
      <Dialog open={closeOpen} onOpenChange={setCloseOpen}>
        <DialogContent size="sm">
          <DialogHeader><DialogTitle>{p.shell.closeShift}</DialogTitle></DialogHeader>
          {sessionQ.data ? (
            <CloseRegisterDialogBody
              session={sessionQ.data as RegisterSession}
              settings={settingsQ.data ?? DEFAULT_SETTINGS}
              onClosed={() => { setCloseOpen(false); toast.success(p.shell.shiftClosed); qc.invalidateQueries({ queryKey: ['pos', 'session'] }); }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
      {locked ? <LockScreen session={session} onUnlock={() => setLocked(false)} /> : null}
    </div>
  );
}
