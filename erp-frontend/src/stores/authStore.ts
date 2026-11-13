import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Permission, Session, User } from '@/types';
import { authService } from '@/services/authService';
import { onSessionRefreshed, setApiSession } from '@/services/api';

interface AuthState {
  session: Session | null;
  status: 'idle' | 'loading' | 'authenticated';
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (s: Session | null) => void;
  hasPermission: (p: Permission | Permission[]) => boolean;
  user: () => User | null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      session: null,
      status: 'idle',
      login: async (username, password) => {
        set({ status: 'loading' });
        try {
          const session = await authService.login(username, password);
          setApiSession(session);
          set({ session, status: 'authenticated' });
        } catch (e) {
          set({ status: 'idle' });
          throw e;
        }
      },
      logout: async () => {
        const s = get().session;
        if (s) await authService.logout(s.user.id);
        setApiSession(null);
        set({ session: null, status: 'idle' });
      },
      setSession: (session) => {
        setApiSession(session);
        set({ session, status: session ? 'authenticated' : 'idle' });
      },
      hasPermission: (p) => {
        const perms = get().session?.permissions ?? [];
        return Array.isArray(p) ? p.some((x) => perms.includes(x)) : perms.includes(p);
      },
      user: () => get().session?.user ?? null,
    }),
    {
      name: 'moto-auth',
      // A pending request cannot survive a reload; only persist the session.
      partialize: (s) => ({ session: s.session }),
      merge: (persisted, current) => {
        const session = (persisted as { session?: Session | null } | undefined)?.session ?? null;
        // Ignore status saved by older versions, including stale "loading".
        return { ...current, session, status: session ? 'authenticated' : 'idle' };
      },
      onRehydrateStorage: () => (state) => {
        setApiSession(state?.session ?? null);
      },
    },
  ),
);

// Keep the store in sync when the HTTP client silently refreshes (or loses) the session.
onSessionRefreshed((s) => {
  const cur = useAuthStore.getState();
  if (s) cur.setSession(s);
  else if (cur.session) useAuthStore.setState({ session: null, status: 'idle' });
});

export function usePermission(p: Permission | Permission[]): boolean {
  return useAuthStore((s) => {
    const perms = s.session?.permissions ?? [];
    return Array.isArray(p) ? p.some((x) => perms.includes(x)) : perms.includes(p);
  });
}

export function useCurrentUser(): User | null {
  return useAuthStore((s) => s.session?.user ?? null);
}
