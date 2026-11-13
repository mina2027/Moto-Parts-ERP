import { useQuery } from '@tanstack/react-query';
import { DEFAULT_SETTINGS } from '@moto/shared';
import { settingsService } from '@/services';
import { useAuthStore } from '@/stores/authStore';
import type { AppSettings } from '@/types';

/** App settings from the API with safe defaults while loading. */
export function useSettings(): { settings: AppSettings; isLoading: boolean } {
  const enabled = useAuthStore((s) => s.status === 'authenticated');
  const q = useQuery({ queryKey: ['settings'], queryFn: settingsService.get, staleTime: 60_000, enabled });
  return { settings: q.data ?? DEFAULT_SETTINGS, isLoading: q.isLoading };
}
