import { AlertTriangle, Inbox, Loader2, ShieldOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/misc';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import type { ReactNode } from 'react';

export function LoadingState({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2 p-4', className)} aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

export function CardsLoading({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-24 w-full" />
      ))}
    </div>
  );
}

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center text-muted-foreground">
      <Loader2 className="size-6 animate-spin" />
    </div>
  );
}

export function EmptyState({ title, description, action, icon, className }: { title?: string; description?: string; action?: ReactNode; icon?: ReactNode; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-12 text-center', className)}>
      <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon ?? <Inbox />}</div>
      <div className="text-sm font-medium">{title ?? t('common.emptyTitle')}</div>
      {description ? <div className="max-w-sm text-xs text-muted-foreground">{description}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ onRetry, title, description, className }: { onRetry?: () => void; title?: string; description?: string; className?: string }) {
  const { t } = useT();
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 px-4 py-12 text-center', className)} role="alert">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </div>
      <div className="text-sm font-medium">{title ?? t('common.errorTitle')}</div>
      <div className="max-w-sm text-xs text-muted-foreground">{description ?? t('common.errorDesc')}</div>
      {onRetry ? (
        <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function NoPermission() {
  const { t } = useT();
  return (
    <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-muted">
        <ShieldOff className="size-7 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold">{t('common.noPermission')}</h2>
      <p className="max-w-sm text-sm text-muted-foreground">{t('common.noPermissionDesc')}</p>
    </div>
  );
}

/** Wraps a react-query result into loading/error/empty/content branches. */
export function QueryState<T>({ isLoading, isError, data, refetch, isEmpty, loading, empty, children }: { isLoading: boolean; isError: boolean; data: T | undefined; refetch?: () => void; isEmpty?: (d: T) => boolean; loading?: ReactNode; empty?: ReactNode; children: (d: T) => ReactNode }) {
  if (isLoading) return <>{loading ?? <LoadingState />}</>;
  if (isError || data === undefined) return <ErrorState onRetry={refetch} />;
  if (isEmpty?.(data)) return <>{empty ?? <EmptyState />}</>;
  return <>{children(data)}</>;
}
