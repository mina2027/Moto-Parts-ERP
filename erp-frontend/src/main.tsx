import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/misc';
import { router } from './router';
import { applyThemeAndDir, useUiStore } from '@/stores/uiStore';
import { PageLoading } from '@/components/shared/states';
import { AppErrorBoundary } from '@/components/shared/error-boundary';
import { RealtimeProvider } from '@/lib/realtime';
import { installGlobalErrorHandlers } from '@/lib/report-error';
import { useAuthStore } from '@/stores/authStore';
import { clearCacheOnSessionChange } from '@/lib/sessionCache';
import './index.css';

installGlobalErrorHandlers();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});
useAuthStore.subscribe((next, previous) => clearCacheOnSessionChange(queryClient, previous.session, next.session));

function ThemeSync() {
  const theme = useUiStore((s) => s.theme);
  const locale = useUiStore((s) => s.locale);
  React.useLayoutEffect(() => {
    applyThemeAndDir(theme, locale);
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyThemeAndDir(theme, locale);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, [theme, locale]);
  return (
    <Toaster position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} dir={locale === 'ar' ? 'rtl' : 'ltr'} richColors closeButton toastOptions={{ className: 'text-sm' }} />
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <ThemeSync />
        <AppErrorBoundary>
          <RealtimeProvider>
            <React.Suspense fallback={<PageLoading />}>
              <RouterProvider router={router} />
            </React.Suspense>
          </RealtimeProvider>
        </AppErrorBoundary>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
