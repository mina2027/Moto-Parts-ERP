import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useT } from '@/i18n';
import { reportError } from '@/lib/report-error';

function CrashScreen({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useT();
  const detail = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center" role="alert">
      <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" />
      </div>
      <div className="text-base font-medium">{t('common.crashTitle')}</div>
      <p className="max-w-md text-xs text-muted-foreground">{t('common.crashDesc')}</p>
      {detail ? <code className="max-w-md break-all rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground">{detail}</code> : null}
      <div className="mt-2 flex gap-2">
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            {t('common.retry')}
          </Button>
        ) : null}
        <Button size="sm" onClick={() => window.location.reload()}>
          {t('common.reload')}
        </Button>
      </div>
    </div>
  );
}

/** Route-level fallback: renders instead of a blank screen when a lazy chunk or loader throws. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error;
  return <CrashScreen error={message} />;
}

type Props = { children: ReactNode };
type State = { error: unknown };

/** Top-level boundary: keeps a render crash in one subtree from white-screening the whole app. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { componentStack: info.componentStack ?? undefined });
  }

  render() {
    if (this.state.error) return <CrashScreen error={this.state.error} onRetry={() => this.setState({ error: null })} />;
    return this.props.children;
  }
}
