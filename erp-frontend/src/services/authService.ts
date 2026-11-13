import type { ID, Session } from '@/types';
import { api } from './api';

export const authService = {
  login: (username: string, password: string): Promise<Session> => api.auth.login(username, password),
  logout: async (_userId: ID): Promise<boolean> => {
    await api.auth.logout().catch(() => undefined);
    return true;
  },
  me: (): Promise<Session> => api.auth.me(),
  changePassword: async (_userId: ID, current: string, next: string): Promise<boolean> => {
    await api.auth.changePassword(current, next);
    return true;
  },
};
