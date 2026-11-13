import { expect, it, vi } from 'vitest';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { Session } from '@moto/shared';
import { DEFAULT_SETTINGS } from '@moto/shared';
import { IPC } from '../shared/ipc';
import { assertSender, createIpcBoundary, externalBrowserUrl, secureNavigation, trustedDocument } from './ipcSecurity';
import { validateIpcArgs } from './ipcValidation';
import { projectDisplaySettings, projectDisplayState, projectSession } from './displayProjection';
import { invokeData } from './dataAccess';

const entry = 'file:///C:/synthetic/index.html';
const session = { user: { id: 'synthetic', branchId: 'br-1' }, permissions: ['sales.create'], token: 'private-token', refreshToken: 'private-refresh', expiresAt: '' } as Session;
function fixture() {
  const frame = { url: entry };
  const contents = { mainFrame: frame, isDestroyed: () => false } as unknown as WebContents;
  const event = { sender: contents, senderFrame: frame } as unknown as IpcMainInvokeEvent;
  const handlers = new Map<string, (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown>();
  const ipc = { handle: (channel: string, listener: (e: IpcMainInvokeEvent, ...a: unknown[]) => unknown) => handlers.set(channel, listener) } as unknown as IpcMain;
  let current: Session | null = session;
  const boundary = createIpcBoundary(ipc, () => contents, entry, () => current, validateIpcArgs);
  return { event, contents, frame, handlers, boundary, logout: () => { current = null; } };
}
it('allows the exact main document and rejects query, sibling and foreign navigation', () => {
  expect(trustedDocument(`${entry}#cart`, entry)).toBe(true);
  for (const url of [`${entry}?code=x`, 'file:///C:/synthetic/display.html', 'https://evil.invalid', 'data:text/html,x']) expect(trustedDocument(url, entry)).toBe(false);
});
it('denies forged windows, subframes, navigated documents and absent frames before handler execution', () => {
  const f = fixture(); const mutate = vi.fn(); f.boundary.handle(IPC.appOpenDisplay, mutate);
  for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { url: entry } }, { ...f.event, senderFrame: null }]) expect(() => f.handlers.get(IPC.appOpenDisplay)!(event as IpcMainInvokeEvent)).toThrow('IPC_SENDER_DENIED');
  f.frame.url = 'https://evil.invalid'; expect(() => f.handlers.get(IPC.appOpenDisplay)!(f.event)).toThrow('IPC_SENDER_DENIED');
  expect(mutate).not.toHaveBeenCalled();
});
it('requires a session for data, outbox, retry, printing and updates after logout', () => {
  const f = fixture(); f.logout();
  for (const channel of [IPC.data, IPC.syncOutbox, IPC.syncRetry, IPC.appPrintHtml, IPC.appQuitAndInstall]) {
    const action = vi.fn(); f.boundary.handle(channel, action);
    expect(() => f.handlers.get(channel)!(f.event)).toThrow('AUTH_REQUIRED'); expect(action).not.toHaveBeenCalled();
  }
});
it('preserves trusted login/bootstrap and denies cashier unpair or cancel privileges', () => {
  const f = fixture(); const login = vi.fn(); f.boundary.handle(IPC.authLogin, login); f.logout();
  f.handlers.get(IPC.authLogin)!(f.event, { username: 'audit', password: 'synthetic' }); expect(login).toHaveBeenCalledOnce();
  const g = fixture(); for (const channel of [IPC.appUnpair, IPC.appArchive, IPC.syncVoid]) { g.boundary.handle(channel, vi.fn()); expect(() => g.handlers.get(channel)!(g.event)).toThrow('PERMISSION_DENIED'); }
});
it('only launches HTTPS browser links without credentials', () => {
  expect(externalBrowserUrl('https://wa.me/000?text=synthetic')).toBe('https://wa.me/000?text=synthetic');
  for (const url of ['file:///C:/Windows/x.exe', 'javascript:alert(1)', 'ms-settings:privacy', 'http://example.invalid', 'https://user:pass@example.invalid', 'bad']) expect(externalBrowserUrl(url)).toBeNull();
});
it('attaches actual Electron navigation and popup guards including frame and redirect events', () => {
  const events = new Map<string, (...args: unknown[]) => void>();
  let popup: (args: { url: string }) => { action: string };
  const open = vi.fn(async () => undefined);
  const contents = { on: (channel: string, callback: (...args: unknown[]) => void) => events.set(channel, callback), setWindowOpenHandler: (handler: typeof popup) => { popup = handler; } } as unknown as WebContents;
  secureNavigation(contents, entry, open);
  const preventDefault = vi.fn(); events.get('will-navigate')!({ preventDefault }, 'file:///C:/private.txt'); expect(preventDefault).toHaveBeenCalledOnce();
  events.get('will-frame-navigate')!({ preventDefault, isMainFrame: false, url: entry });
  events.get('will-redirect')!({ preventDefault }, 'https://evil.invalid', false, true); expect(preventDefault).toHaveBeenCalledTimes(3);
  expect(popup!({ url: 'ms-settings:privacy' })).toEqual({ action: 'deny' }); expect(open).not.toHaveBeenCalled();
  popup!({ url: 'https://wa.me/000' }); expect(open).toHaveBeenCalledWith('https://wa.me/000');
});
it('validates credentials, pairing URLs and bounded finite print geometry before dispatch', () => {
  const f = fixture(); const print = vi.fn(); f.boundary.handle(IPC.appPrintHtml, print);
  const job = { html: '<div>synthetic</div>', silent: false, copies: 1, widthMm: 80, heightMm: null };
  for (const invalid of [{ ...job, widthMm: NaN }, { ...job, copies: -1 }, { ...job, html: 'x'.repeat(2_000_001) }, { ...job, heightMm: Infinity }]) expect(() => f.handlers.get(IPC.appPrintHtml)!(f.event, invalid)).toThrow('INVALID_IPC_ARGUMENT');
  f.handlers.get(IPC.appPrintHtml)!(f.event, job); expect(print).toHaveBeenCalledOnce();
  expect(() => validateIpcArgs(IPC.authLogin, [{ username: '', password: 'x' }])).toThrow('INVALID_IPC_ARGUMENT');
  expect(() => validateIpcArgs(IPC.appBranchesFor, [{ serverUrl: 'file:///private', username: 'audit', password: 'x' }])).toThrow('INVALID_SERVER_URL');
  expect(() => validateIpcArgs(IPC.appBranchesFor, [{ serverUrl: 'https://other.invalid', username: 'audit', password: 'x' }])).toThrow('INVALID_IPC_ARGUMENT');
});
it('rejects invalid IPC sale quantities and foreign writes without changing stock or queuing operations', async () => {
  const write = vi.fn(); const base = { branchId: 'br-1', items: [{ productId: 'p', name: { ar: 'synthetic' }, unitPrice: 10, quantity: 1 }], payments: [{ method: 'cash', amount: 10 }], type: 'cash' };
  for (const quantity of [-1, 0, NaN, Infinity]) await expect(invokeData({ createSale: write }, session, 'br-1', 'createSale', { ...base, items: [{ ...base.items[0], quantity }] })).rejects.toThrow('INVALID_IPC_ARGUMENT');
  await expect(invokeData({ createSale: write }, session, 'br-1', 'createSale', { ...base, branchId: 'br-2' })).rejects.toThrow('BRANCH_DENIED');
  expect(write).not.toHaveBeenCalled();
  await invokeData({ createSale: write }, session, 'br-1', 'createSale', base); expect(write).toHaveBeenCalledOnce();
});
it('requires quick-grid and transfer permissions locally before the upstream request', async () => {
  const write = vi.fn();
  await expect(invokeData({ requestTransfer: write }, session, 'br-1', 'requestTransfer', { productId: 'p', fromBranchId: 'br-2', quantity: 1 })).rejects.toThrow('PERMISSION_DENIED');
  await expect(invokeData({ saveQuickProduct: write }, session, 'br-1', 'saveQuickProduct', { productId: 'p' })).rejects.toThrow('PERMISSION_DENIED');
  expect(write).not.toHaveBeenCalled();
});
it('projects display totals and customer name without balances, costs, contacts or stock', () => {
  const result = projectDisplayState({ lines: [{ productId: 'p', name: { ar: 'synthetic' }, quantity: 1, unitPrice: 10, discountPercent: 0, unitCost: 4, available: 50 }], customer: { name: { ar: 'customer' }, balance: 100, phone: '000' }, invoiceDiscount: 0, lastSaleId: null });
  expect(result.lines[0]).not.toHaveProperty('unitCost'); expect(result.lines[0]).not.toHaveProperty('available'); expect(result.customer).toEqual({ name: { ar: 'customer' } });
  expect(() => projectDisplayState({ ...result, invoiceDiscount: NaN })).toThrow();
  expect(Object.keys(projectDisplaySettings(DEFAULT_SETTINGS)).sort()).toEqual(['company', 'currency', 'invoice']);
});
it('removes access and refresh tokens from the renderer session response', () => {
  expect(projectSession(session)).toEqual({ user: session.user, permissions: session.permissions, expiresAt: '' });
  expect(projectSession(null)).toBeNull();
});
it('rejects a destroyed trusted window', () => {
  const f = fixture(); vi.spyOn(f.contents, 'isDestroyed').mockReturnValue(true);
  expect(() => assertSender(f.event, f.contents, entry)).toThrow('IPC_SENDER_DENIED');
});
