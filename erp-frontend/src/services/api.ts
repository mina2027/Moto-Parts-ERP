import { createApiClient, ApiError } from '@moto/api-client';
import type { Session } from '@/types';

export { ApiError };

const AUTH_KEY = 'moto-auth';

/** Reads the persisted zustand auth slice without importing the store (avoids a cycle). */
function readPersistedSession(): Session | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { session?: Session | null } };
    return parsed.state?.session ?? null;
  } catch {
    return null;
  }
}

let sessionOverride: Session | null | undefined;
export function setApiSession(s: Session | null) {
  sessionOverride = s;
}

const listeners = new Set<(s: Session | null) => void>();
export function onSessionRefreshed(fn: (s: Session | null) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) || '/api';

export const api = createApiClient({
  baseUrl: API_URL,
  credentials: 'include',
  getToken: () => (sessionOverride !== undefined ? (sessionOverride?.token ?? null) : (readPersistedSession()?.token ?? null)),
  onUnauthorized: async () => {
    try {
      const s = await api.auth.refresh();
      sessionOverride = s;
      listeners.forEach((l) => l(s));
      return s.token;
    } catch {
      sessionOverride = null;
      listeners.forEach((l) => l(null));
      return null;
    }
  },
});
