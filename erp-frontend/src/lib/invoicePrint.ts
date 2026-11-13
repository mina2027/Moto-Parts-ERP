import { pageStyleFor } from '@moto/pos-core';
import { PAPER_SIZES, invoiceContentWidthMm, invoiceRollHeightMm, normalizePrintProfile, type PrintProfile } from '@moto/shared';

/** Print one invoice outside dialogs and scrolling layouts, with an explicit page size. */
export async function printBrowserInvoice(element: HTMLElement | null, profile: PrintProfile): Promise<void> {
  if (!element) throw new Error('Invoice content is not ready to print');
  profile = normalizePrintProfile(profile);
  const paper = PAPER_SIZES[profile.paper];
  const root = document.createElement('div');
  root.className = 'invoice-print-document';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = `position:fixed;left:-10000px;top:0;width:${invoiceContentWidthMm(paper.widthMm)}mm;`;
  root.appendChild(element.cloneNode(true));
  const style = document.createElement('style');
  const printStyle = (heightMm?: number) => `${pageStyleFor(profile, heightMm)}
    .invoice-print-document > .invoice { width: ${paper.widthMm}mm; max-width: none; }
    @media print {
      body > :not(.invoice-print-document) { display: none !important; }
      .print-area, .print-area * { visibility: hidden !important; }
      .invoice-print-document, .invoice-print-document * { visibility: visible !important; }
      .invoice-print-document { position: static !important; display: block !important; width: ${paper.widthMm}mm !important; height: auto !important; overflow: visible !important; margin: 0; }
    }`;
  style.textContent = printStyle();
  document.body.append(root, style);
  try {
    await Promise.race([
      Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        ...Array.from(root.querySelectorAll('img')).map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })),
      ]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    const heightMm = paper.heightMm === 'auto' ? invoiceRollHeightMm(root.getBoundingClientRect().height, paper.widthMm) : undefined;
    style.textContent = printStyle(heightMm);
    window.print();
  } finally {
    root.remove();
    style.remove();
  }
}
