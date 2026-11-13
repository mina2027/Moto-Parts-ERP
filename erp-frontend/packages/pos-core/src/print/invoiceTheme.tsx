import { CAIRO_ARABIC_WOFF2, CAIRO_LATIN_WOFF2 } from './invoiceFonts';

/** Colored palette shared by the thermal and A4 invoices. */
export const NAVY = '#C62828';
export const ACCENT = '#1565C0';
export const LIGHT = '#FFF8E1';
export const BORDER = '#F2C94C';
export const TEXT = '#1A1A1A';
export const MUTED = '#5B6B82';
export const DANGER = '#B42318';

export const INK = NAVY;
export const PAPER = LIGHT;
export const MONOCHROME_IMAGE_CSS = '';

export const INVOICE_FONT_STACK =
  "'MotoInvoiceCairo', 'Cairo Variable', 'Cairo', 'Tajawal', 'Noto Sans Arabic', 'Segoe UI', Tahoma, sans-serif";

export function invoiceColors() {
  return { primary: NAVY, accent: ACCENT };
}

// Embedded as data URLs so the markup stays self-contained when Electron prints `outerHTML` from a data: page.
export const FONT_FACE_CSS = `
@font-face { font-family: 'MotoInvoiceCairo'; font-style: normal; font-weight: 200 1000; font-display: block; src: url(data:font/woff2;base64,${CAIRO_ARABIC_WOFF2}) format('woff2');
  unicode-range: U+0600-06FF, U+0750-077F, U+0870-08FF, U+200C-200E, U+2010-2011, U+204F, U+2E41, U+FB50-FDFF, U+FE70-FEFC; }
@font-face { font-family: 'MotoInvoiceCairo'; font-style: normal; font-weight: 200 1000; font-display: block; src: url(data:font/woff2;base64,${CAIRO_LATIN_WOFF2}) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20AC, U+2122, U+2212, U+FEFF, U+FFFD; }
`;

/** Length helpers for a scaled stylesheet: every number in the sheet is multiplied by `s`. */
export function scaler(s: number) {
  const r = (v: number) => Math.round(v * s * 1000) / 1000;
  return {
    px: (v: number) => `${r(v)}px`,
    mm: (v: number) => `${r(v)}mm`,
    /** SVG icons take numeric attributes, not CSS lengths. */
    ic: (v: number) => Math.max(6, Math.round(v * s)),
    n: r,
  };
}

export function Moto({ className, color, ...box }: { className?: string; color?: string; x?: number; y?: number; width?: number | string; height?: number | string }) {
  return (
    <svg viewBox="0 0 64 40" width="100%" height="100%" {...box} className={className} style={color ? { color } : undefined} fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="29" r="8" />
      <circle cx="52" cy="29" r="8" />
      <path d="M12 29 L20 21" />
      <path d="M52 29 L45 11 M41 10 h8" />
      <path d="M17 18 L27 14 H36 L42 18 L45 22 L38 28 H26 L22 22 Z" fill="currentColor" />
      <path d="M15 15 H28" strokeWidth={4} />
      <path d="M24 32 H38" strokeWidth={2.4} />
    </svg>
  );
}

export function GearLogo({ ring = NAVY, hub = ACCENT }: { ring?: string; hub?: string } = {}) {
  const teeth = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
      <g fill={ring}>
        {teeth.map((deg) => (
          <rect key={deg} x="43" y="2" width="14" height="14" rx="2.5" transform={`rotate(${deg} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="39" fill={ring} />
      <circle cx="50" cy="50" r="31" fill="#fff" />
      <Moto x={22} y={31} width={56} height={36} color={hub} />
    </svg>
  );
}
