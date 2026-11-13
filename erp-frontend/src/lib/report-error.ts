type Context = Record<string, unknown>;

/**
 * Single funnel for unexpected client errors. Everything lands in the console with context attached;
 * point `window.__motoReportError` at a tracker (Sentry, a log endpoint, …) to forward them.
 */
export function reportError(error: unknown, context: Context = {}) {
  const payload = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    url: window.location.href,
    at: new Date().toISOString(),
    ...context,
  };
  console.error('[moto] unexpected error', payload);
  window.__motoReportError?.(payload);
}

/** Catches what React boundaries cannot: async throws and rejected promises. */
export function installGlobalErrorHandlers() {
  window.addEventListener('error', (e) => reportError(e.error ?? e.message, { source: 'window.error' }));
  window.addEventListener('unhandledrejection', (e) => reportError(e.reason, { source: 'unhandledrejection' }));
}

declare global {
  interface Window {
    __motoReportError?: (payload: Record<string, unknown>) => void;
  }
}
