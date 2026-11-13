import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron';
import type { Permission, Session } from '@moto/shared';
import { IPC } from '../shared/ipc';

export function trustedDocument(url: string, entry: string): boolean {
  try {
    const actual = new URL(url), expected = new URL(entry);
    actual.hash = ''; expected.hash = '';
    return actual.href === expected.href;
  } catch { return false; }
}

export function assertSender(event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>, contents: WebContents | null, entry: string) {
  if (!contents || contents.isDestroyed() || event.sender !== contents || !event.senderFrame || event.senderFrame !== contents.mainFrame || !trustedDocument(event.senderFrame.url, entry)) throw new Error('IPC_SENDER_DENIED');
}

/** Shell links are browser URLs only; executable OS protocols and embedded credentials are denied. */
export function externalBrowserUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return raw.length <= 4096 && url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function secureNavigation(contents: WebContents, entry: string, openExternal?: (url: string) => Promise<unknown>) {
  contents.setWindowOpenHandler(({ url }) => {
    const safe = externalBrowserUrl(url);
    if (safe && openExternal) void openExternal(safe).catch(() => undefined);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => { if (!trustedDocument(url, entry)) event.preventDefault(); });
  contents.on('will-frame-navigate', (event) => { if (!event.isMainFrame || !trustedDocument(event.url, entry)) event.preventDefault(); });
  contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => { if (!isMainFrame || !trustedDocument(url, entry)) event.preventDefault(); });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

const publicChannels = new Set<string>([IPC.appVersion, IPC.appPairing, IPC.appBranchesFor, IPC.appPair, IPC.authLogin, IPC.authCached, IPC.authLogout, IPC.authLock, IPC.syncStatus]);
const permissions: Record<string, Permission[]> = {
  [IPC.appUnpair]: ['settings.edit', 'cash.open'],
  [IPC.appArchive]: ['settings.edit'],
  [IPC.appReregister]: ['settings.edit', 'cash.open'],
  [IPC.appOpenDrawer]: ['sales.create', 'cash.open', 'cash.close'],
  [IPC.syncVoid]: ['sales.cancel'],
};

export function assertChannelAccess(channel: string, session: Session | null) {
  if (publicChannels.has(channel)) return;
  if (!session) throw new Error('AUTH_REQUIRED');
  const required = permissions[channel];
  if (required && !required.some(p => session.permissions.includes(p))) throw new Error('PERMISSION_DENIED');
}

/** All main-window handlers register through the same sender and authorization boundary. */
export function createIpcBoundary(ipc: Pick<IpcMain, 'handle'>, contents: () => WebContents | null, entry: string, session: () => Session | null, validate: (channel: string, args: unknown[]) => unknown[]) {
  return {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: never[]) => unknown) {
      ipc.handle(channel, (event, ...args: unknown[]) => {
        assertSender(event, contents(), entry);
        assertChannelAccess(channel, session());
        return listener(event, ...validate(channel, args) as never[]);
      });
    },
    assertEvent(event: IpcMainEvent, channel: string) {
      assertSender(event, contents(), entry);
      assertChannelAccess(channel, session());
    },
  };
}
