import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Locale } from '@/types';

export type Theme = 'light' | 'dark' | 'system';

interface UiState {
  locale: Locale;
  theme: Theme;
  sidebarCollapsed: boolean;
  setLocale: (l: Locale) => void;
  setTheme: (t: Theme) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (v: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      locale: 'ar',
      theme: 'light',
      sidebarCollapsed: false,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
    }),
    { name: 'moto-ui' },
  ),
);

export function applyThemeAndDir(theme: Theme, locale: Locale) {
  const root = document.documentElement;
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  root.classList.toggle('dark', dark);
  root.setAttribute('lang', locale);
  root.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
}
