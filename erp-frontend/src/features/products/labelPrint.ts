import type { LabelTemplate } from '@/types';
import { labelPageStyle } from './LabelRenderer';

/** Print physical-size labels outside the ERP's scrolling layout and preview tabs. */
export async function printBrowserLabels(element: HTMLElement | null, template: LabelTemplate): Promise<void> {
  if (!element?.querySelector('.label-page')) throw new Error('Label content is not ready to print');
  const root = document.createElement('div');
  root.className = 'barcode-print-document';
  root.setAttribute('aria-hidden', 'true');
  root.style.cssText = `position:fixed;left:-10000px;top:0;width:${template.widthMm}mm;`;
  for (const page of element.querySelectorAll(':scope > .label-page')) root.appendChild(page.cloneNode(true));
  const style = document.createElement('style');
  style.textContent = labelPageStyle(template);
  document.body.append(root, style);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([
        document.fonts?.ready ?? Promise.resolve(),
        ...Array.from(root.querySelectorAll('img')).map((img) => img.complete ? Promise.resolve() : new Promise<void>((resolve) => {
          img.addEventListener('load', () => resolve(), { once: true });
          img.addEventListener('error', () => resolve(), { once: true });
        })),
      ]),
      new Promise((resolve) => { timeout = setTimeout(resolve, 3000); }),
    ]);
    window.print();
  } finally {
    clearTimeout(timeout);
    root.remove();
    style.remove();
  }
}
