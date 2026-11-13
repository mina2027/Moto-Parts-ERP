import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@/types';
import { authService } from '@/services/authService';
import { setApiSession } from '@/services/api';
import { useAuthStore } from './authStore';

vi.mock('@/services/authService', () => ({ authService: { login: vi.fn(), logout: vi.fn() } }));
vi.mock('@/services/api', () => ({ setApiSession: vi.fn(), onSessionRefreshed: vi.fn() }));

const session: Session = {
  user: {
    id: 'user-1', username: 'user', fullName: { ar: 'User' }, email: '', phone: '',
    role: 'cashier', branchId: 'branch-1', status: 'active', avatarColor: '',
    lastLogin: null, createdAt: '2026-01-01T00:00:00Z',
  },
  permissions: [], token: 'saved-token', expiresAt: '2027-01-01T00:00:00Z',
};

beforeEach(() => {
  useAuthStore.setState({ session: null, status: 'idle' });
  localStorage.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  useAuthStore.setState({ session: null, status: 'idle' });
  localStorage.clear();
});

describe('auth persistence across page reloads', () => {
  it.each(['loading', 'authenticated'])('discards stale %s status when no session was saved', async (status) => {
    localStorage.setItem('moto-auth', JSON.stringify({ state: { session: null, status }, version: 0 }));

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().status).toBe('idle');
    expect(useAuthStore.getState().session).toBeNull();
    expect(setApiSession).toHaveBeenLastCalledWith(null);
    expect(authService.login).not.toHaveBeenCalled();
  });

  it.each(['idle', 'loading', 'authenticated'])('restores a saved session regardless of its old %s status', async (status) => {
    localStorage.setItem('moto-auth', JSON.stringify({ state: { session, status }, version: 0 }));

    await useAuthStore.persist.rehydrate();

    expect(useAuthStore.getState().status).toBe('authenticated');
    expect(useAuthStore.getState().session).toEqual(session);
    expect(setApiSession).toHaveBeenLastCalledWith(session);
  });

  it('does not save an in-flight login and returns to idle after a reload', async () => {
    let rejectLogin!: (reason: Error) => void;
    vi.mocked(authService.login).mockReturnValue(new Promise((_resolve, reject) => { rejectLogin = reject; }));
    const request = useAuthStore.getState().login('user', 'password');
    const failedRequest = expect(request).rejects.toThrow('Interrupted');

    try {
      expect(useAuthStore.getState().status).toBe('loading');
      expect(JSON.parse(localStorage.getItem('moto-auth')!).state).toEqual({ session: null });
      await useAuthStore.persist.rehydrate();
      expect(useAuthStore.getState().status).toBe('idle');
    } finally {
      rejectLogin(new Error('Interrupted'));
      await failedRequest;
    }
  });
});
