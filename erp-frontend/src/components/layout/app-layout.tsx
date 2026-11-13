import * as React from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { NotificationBar } from './notification-bar';
import { PageLoading } from '@/components/shared/states';
import { DeveloperCredit } from '@/components/shared/developer-credit';

export function AppLayout() {
  const { pathname } = useLocation();
  const path = pathname.replace(/\/+$/, '');
  if (path === '/pos' || path === '/pos/display') {
    return (
      <React.Suspense fallback={<PageLoading />}>
        <Outlet />
      </React.Suspense>
    );
  }
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <div className="hidden h-full shrink-0 lg:block">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header />
        <NotificationBar />
        <main className="flex-1 overflow-y-auto p-4 lg:p-5">
          <React.Suspense fallback={<PageLoading />}>
            <Outlet />
          </React.Suspense>
        </main>
        <DeveloperCredit className="border-t bg-card px-4 py-2" />
      </div>
    </div>
  );
}
