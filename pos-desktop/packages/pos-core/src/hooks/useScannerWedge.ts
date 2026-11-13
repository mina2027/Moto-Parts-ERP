import * as React from 'react';

/**
 * Detects keyboard-wedge barcode scanners: a fast burst of printable keys (< 40ms apart)
 * terminated by Enter, regardless of focus. Calls `onScan(code)` and swallows the burst.
 */
export function useScannerWedge(onScan: (code: string) => void, opts: { minLength?: number; maxGapMs?: number; enabled?: boolean } = {}) {
  const { minLength = 4, maxGapMs = 40, enabled = true } = opts;
  const buf = React.useRef('');
  const last = React.useRef(0);
  const cb = React.useRef(onScan);
  cb.current = onScan;

  React.useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-scanner-ignore]')) {
        buf.current = '';
        last.current = 0;
        return;
      }
      const now = performance.now();
      if (now - last.current > maxGapMs) buf.current = '';
      last.current = now;
      if (e.key === 'Enter') {
        if (buf.current.length >= minLength) {
          const code = buf.current;
          buf.current = '';
          const target = e.target as HTMLElement | null;
          // If the burst was typed into an input, clear what the scanner typed there.
          if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
            const input = target as HTMLInputElement;
            if (input.value.endsWith(code)) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
              setter?.call(input, input.value.slice(0, -code.length));
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          e.preventDefault();
          e.stopPropagation();
          cb.current(code);
        }
        buf.current = '';
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) buf.current += e.key;
      else if (e.key !== 'Shift') buf.current = '';
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled, minLength, maxGapMs]);
}
