import type { WebContents } from 'electron';
export function printCsp(approvedLogo?: string): string {
  let logo = '';
  if (approvedLogo) {
    const url = new URL(approvedLogo);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/uploads\/[A-Za-z0-9_.-]+$/.test(url.pathname)) throw new Error('UNTRUSTED_PRINT_RESOURCE');
    logo = ` ${url.href}`;
  }
  return `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:${logo}; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
}
export function securePrintWindow(contents: WebContents) {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  contents.on('will-navigate', event => event.preventDefault());
  contents.on('will-frame-navigate', event => event.preventDefault());
  contents.on('will-redirect', event => event.preventDefault());
  contents.on('will-attach-webview', event => event.preventDefault());
}
