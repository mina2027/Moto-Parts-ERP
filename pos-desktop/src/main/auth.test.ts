import { beforeEach, expect, it, vi } from 'vitest';
import type { ApiClient } from '@moto/api-client';
import type { Session } from '@moto/shared';
import type { LocalDb } from './db/database';
const storage = vi.hoisted(() => ({ available: true }));
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => storage.available,
  encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
  decryptString: (value: Buffer) => {
    if (!value.toString().startsWith('encrypted:')) throw new Error('Invalid encrypted data');
    return value.toString().slice(10);
  },
} }));
import { AuthStore } from './auth';
const session = { token: 'synthetic-access-token', refreshToken: 'synthetic-refresh-token', permissions: ['sales.create'], user: { id: 'u1', username: 'cashier', branchId: 'br-1' } } as Session;
let values: Map<string, string>;
let db: LocalDb;
beforeEach(() => {
  storage.available = true;
  values = new Map();
  db = { getMeta: (key: string) => values.get(key) ?? null, setMeta: (key: string, value: string | null) => value == null ? values.delete(key) : values.set(key, value) } as LocalDb;
});
it('never writes readable tokens when OS encryption is unavailable', () => {
  storage.available = false;
  const auth = new AuthStore(db);
  auth.setSession(session);
  expect(auth.token()).toBe(session.token);
  expect(values.has('session')).toBe(false);
});
it('rejects an old plaintext token cache when encryption is unavailable', () => {
  values.set('session', Buffer.from(JSON.stringify(session)).toString('base64'));
  storage.available = false;
  expect(new AuthStore(db).current()).toBeNull();
  expect(values.has('session')).toBe(false);
});
it('retains multiple encrypted offline profiles across logout without keeping tokens', async () => {
  const secondSession = { ...session, token: 'second-access-token', refreshToken: 'second-refresh-token', user: { ...session.user, id: 'u2', username: 'manager' } } as Session;
  const api = { auth: { login: vi.fn().mockResolvedValueOnce(session).mockResolvedValueOnce(secondSession) } } as unknown as ApiClient;
  const auth = new AuthStore(db);
  await auth.login(api, true, 'cashier', 'synthetic-password');
  await auth.login(api, true, 'manager', 'manager-password');
  auth.logout();
  const profile = values.get('offline_profiles')!;
  const plain = Buffer.from(profile, 'base64').toString();
  expect(plain).not.toContain(session.token);
  expect(plain).not.toContain(session.refreshToken);
  const restarted = new AuthStore(db);
  expect((await restarted.login(null, false, 'cashier', 'synthetic-password')).user.id).toBe('u1');
  expect((await restarted.login(null, false, 'manager', 'manager-password')).user.id).toBe('u2');
  await expect(restarted.login(null, false, 'cashier', 'wrong-password')).rejects.toThrow('OFFLINE_LOGIN_FAILED');
});
it('keeps an encrypted refresh token available for reconnecting after offline login', async () => {
  const refreshed = { ...session, token: 'refreshed-access-token', refreshToken: 'refreshed-refresh-token' };
  const auth = new AuthStore(db);
  await auth.login({ auth: { login: async () => session } } as unknown as ApiClient, true, 'cashier', 'synthetic-password');

  const offline = new AuthStore(db);
  await offline.login(null, false, 'cashier', 'synthetic-password');
  expect(offline.token()).toBe('');
  expect(offline.refreshToken()).toBe(session.refreshToken);
  expect(await offline.refresh({ auth: { refresh: async () => refreshed } } as unknown as ApiClient)).toBe(refreshed.token);
  expect(offline.token()).toBe(refreshed.token);
});
it('re-authenticates an offline login automatically when the server returns', async () => {
  const onlineApi = { auth: { login: vi.fn(async () => session) } } as unknown as ApiClient;
  const auth = new AuthStore(db);
  await auth.login(onlineApi, true, 'cashier', 'synthetic-password');

  const offline = new AuthStore(db);
  await offline.login(null, false, 'cashier', 'synthetic-password');
  const verified = { ...session, token: 'server-verified-token', refreshToken: 'server-verified-refresh' };
  const reconnectApi = { auth: { login: vi.fn(async () => verified) } } as unknown as ApiClient;

  expect(await offline.reconnect(reconnectApi)).toBe(true);
  expect(reconnectApi.auth.login).toHaveBeenCalledWith('cashier', 'synthetic-password');
  expect(offline.token()).toBe(verified.token);
  expect(offline.refreshToken()).toBe(verified.refreshToken);
});
it('allows online login without persisting credentials when encryption is unavailable', async () => {
  storage.available = false;
  const api = { auth: { login: vi.fn(async () => session) } } as unknown as ApiClient;
  const auth = new AuthStore(db);
  expect(await auth.login(api, true, 'cashier', 'synthetic-password')).toEqual(session);
  expect(values.has('session')).toBe(false);
  expect(values.has('offline_profiles')).toBe(false);
  expect(values.has('pw:cashier')).toBe(false);
  auth.logout();
  await expect(auth.login(null, false, 'cashier', 'synthetic-password')).rejects.toThrow('OFFLINE_LOGIN_FAILED');
});
it('keeps offline authorization valid indefinitely without extending its verification timestamp', async () => {
  const auth = new AuthStore(db);
  await auth.login({ auth: { login: async () => session } } as unknown as ApiClient, true, 'cashier', 'synthetic-password');
  const verified = Number(values.get('auth_verified_at'));
  vi.spyOn(Date, 'now').mockReturnValue(verified + 365 * 24 * 3600_000);
  expect((await auth.login(null, false, 'cashier', 'synthetic-password')).user.id).toBe('u1');
  expect(Number(values.get('auth_verified_at'))).toBe(verified);
  expect(auth.current()?.user.id).toBe('u1');
  vi.restoreAllMocks();
});
it('blocks renderer access while locked and restores it only after password verification', async () => {
  const auth = new AuthStore(db);
  await auth.login({ auth: { login: async () => session } } as unknown as ApiClient, true, 'cashier', 'synthetic-password');
  auth.lock(); expect(auth.current()).toBeNull();
  expect(auth.refreshToken()).toBe(session.refreshToken);
  await expect(auth.login(null, false, 'cashier', 'wrong')).rejects.toThrow(); expect(auth.current()).toBeNull();
  await auth.login(null, false, 'cashier', 'synthetic-password'); expect(auth.current()?.user.id).toBe('u1');
});
it('preserves the main-process lock across restart and background refresh', async () => {
  const auth = new AuthStore(db);
  await auth.login({ auth: { login: async () => session } } as unknown as ApiClient, true, 'cashier', 'synthetic-password');
  auth.lock(); const restarted = new AuthStore(db); expect(restarted.current()).toBeNull();
  await restarted.refresh({ auth: { refresh: async () => session } } as unknown as ApiClient); expect(restarted.current()).toBeNull();
  await restarted.login(null, false, 'cashier', 'synthetic-password'); expect(restarted.current()?.user.id).toBe('u1');
});
it('shares concurrent refresh and cannot resurrect a session after logout', async () => {
  const auth = new AuthStore(db); auth.setSession(session);
  let resolve: (s: Session) => void = () => undefined;
  const refresh = vi.fn(() => new Promise<Session>(r => { resolve = r; }));
  const api = { auth: { refresh } } as unknown as ApiClient;
  const one = auth.refresh(api), two = auth.refresh(api); expect(refresh).toHaveBeenCalledOnce();
  auth.logout(); resolve(session); expect(await one).toBeNull(); expect(await two).toBeNull(); expect(auth.current()).toBeNull();
});
it('erases offline credentials after the server rejects a revoked refresh', async () => {
  const auth = new AuthStore(db);
  await auth.login({ auth: { login: async () => session } } as unknown as ApiClient, true, 'cashier', 'synthetic-password');
  await auth.refresh({ auth: { refresh: async () => { throw Object.assign(new Error('revoked'), { status: 401 }); } } } as unknown as ApiClient);
  expect(auth.current()).toBeNull(); expect(values.has('offline_profiles')).toBe(false);
  await expect(auth.login(null, false, 'cashier', 'synthetic-password')).rejects.toThrow('OFFLINE_LOGIN_FAILED');
});
