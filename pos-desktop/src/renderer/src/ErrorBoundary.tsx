import * as React from 'react';
import { usePosT } from '@moto/pos-core';
import { Button } from '@moto/ui';

/** Last line of defence: a render crash must never leave the cashier staring at a blank window. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('POS render crash', error, info.componentStack);
  }

  render() {
    return this.state.error ? <CrashScreen error={this.state.error} /> : this.props.children;
  }
}

function CrashScreen({ error }: { error: Error }) {
  const { p } = usePosT();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-card-foreground shadow-sm">
        <h1 className="text-lg font-semibold text-destructive">{p.shell.crashTitle}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{p.shell.crashHint}</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded bg-muted p-3 text-start text-xs" dir="ltr">{error.message}</pre>
        <Button className="mt-4" onClick={() => window.location.reload()}>{p.shell.reload}</Button>
      </div>
    </div>
  );
}
