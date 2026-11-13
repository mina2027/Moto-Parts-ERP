/** Pure print-layout helpers (no Electron imports) so they can be unit-tested. */
import { PAPER_SIZES, invoiceContentWidthMm, invoicePageMarginMm } from '@moto/shared';
import type { PrintHtmlInput } from '../shared/ipc';

export const PX_PER_MM = 96 / 25.4;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 1.5;
/** Extra paper fed after a roll receipt so the last line clears the cutter. */
export const ROLL_TAIL_MM = 4;
/** Chromium rejects page sizes smaller than ~352 microns; keep roll pages comfortably above that. */
export const MIN_ROLL_HEIGHT_MM = 30;

export function clampScale(scale: number | null | undefined): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** Fixed checkout dimensions also apply to jobs sent by older renderer versions. */
export function printLayoutFor(job: Pick<PrintHtmlInput, 'profileId' | 'widthMm' | 'heightMm' | 'scale'>): { widthMm: number; heightMm: number | null; scale: number } {
  const paper = job.profileId === 'invoice-small' ? PAPER_SIZES.thermal80 : job.profileId === 'invoice-large' ? PAPER_SIZES.a4 : null;
  if (paper) return { widthMm: paper.widthMm, heightMm: paper.heightMm === 'auto' ? null : paper.heightMm, scale: 1 };
  return { widthMm: job.widthMm, heightMm: job.heightMm, scale: clampScale(job.scale) };
}

/** Parses a stored scale percentage ("95") into a factor (0.95). */
export function parseScalePref(raw: string | null | undefined): number {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? clampScale(n / 100) : 1;
}

/**
 * Page height for a roll (thermal) receipt: exactly the rendered content plus a short tail, so the printer neither
 * feeds blank paper nor splits a long receipt into several pages.
 */
export function rollPageHeightMm(contentHeightPx: number): number {
  const mm = (Number.isFinite(contentHeightPx) && contentHeightPx > 0 ? contentHeightPx : 0) / PX_PER_MM;
  return Math.max(MIN_ROLL_HEIGHT_MM, Math.ceil(mm + ROLL_TAIL_MM));
}

/**
 * Standalone print document. The renderer's Tailwind sheet is not shipped with the HTML, so mirror the bits of
 * preflight/utilities the templates rely on — notably border-box, otherwise an 80mm receipt with padding is wider
 * than the paper and gets clipped. `heightMm` null = roll paper (final @page size is set after measuring).
 */
export function buildPrintDocument(html: string, widthMm: number, heightMm: number | null, zoom: number, invoice = false): string {
  const margin = invoice ? invoicePageMarginMm(widthMm) : 0;
  const contentWidth = invoice ? invoiceContentWidthMm(widthMm) : widthMm;
  const contentScale = invoice ? 1 : clampScale(zoom);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @page { size: ${widthMm}mm ${heightMm ? `${heightMm}mm` : `${widthMm * 3}mm`}; margin: ${margin}mm; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { display: flow-root; width: ${contentWidth}mm; } .print-root { zoom: ${contentScale}; }
  .print-root > .invoice { width: ${contentWidth}mm; max-width: none; }
  @media print { html, body { height: auto; overflow: visible; } body { width: auto; } }
  img, svg { vertical-align: middle; } img { max-width: 100%; height: auto; }
  [role="img"] > svg { display: block; width: 100%; height: 100%; }
  .bg-white { background: #fff; } .text-black { color: #000; }
  .num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
  .flex { display: flex; } .justify-between { justify-content: space-between; } .justify-end { justify-content: flex-end; } .items-center { align-items: center; } .items-start { align-items: flex-start; }
  .text-center { text-align: center; } .text-end { text-align: end; } .text-start { text-align: start; } .font-bold { font-weight: 700; } .font-semibold { font-weight: 600; } .font-medium { font-weight: 500; }
  .w-full { width: 100%; } .grid { display: grid; } .gap-3 { gap: .75rem; } .gap-4 { gap: 1rem; } .mx-auto { margin-inline: auto; } .inline-block { display: inline-block; }
  table { border-collapse: collapse; }
</style></head><body><div class="print-root">${html}</div></body></html>`;
}

/**
 * On-screen size for a job that has to show the system print dialog. Windows owns that dialog to the window the job
 * came from, so the window must be visible — a 58mm receipt would make a useless 219px window, hence the floors.
 */
export function previewWindowSize(widthMm: number, heightMm: number | null): { width: number; height: number } {
  const px = (mm: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, mm * PX_PER_MM)));
  return { width: px(widthMm, 420, 980), height: px(heightMm ?? widthMm * 2, 480, 860) };
}

/** Device override wins (chosen from installed printers on this machine), then the profile's server-side name. */
export function pickPrinterName(deviceOverride: string | null | undefined, profilePrinter: string | null | undefined): string | null {
  const d = deviceOverride?.trim();
  if (d) return d;
  const p = profilePrinter?.trim();
  return p || null;
}

/** Silent printing is on unless the operator explicitly disabled it on this device. */
export function isSilentPref(raw: string | null | undefined): boolean {
  return raw !== '0';
}
