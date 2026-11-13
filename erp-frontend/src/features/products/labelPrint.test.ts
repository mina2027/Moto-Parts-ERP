import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultLabelTemplate } from '@moto/shared';
import { printBrowserLabels } from './labelPrint';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

function source() {
  const layout = document.createElement('main');
  layout.style.overflow = 'auto';
  const labels = document.createElement('div');
  labels.className = 'hidden';
  labels.innerHTML = '<div class="label-page">MP000001</div><div class="label-page">MP000001</div><div class="label-page">MP000002</div>';
  layout.append(labels);
  document.body.append(layout);
  return labels;
}

describe('browser barcode label printing', () => {
  it('prints the full queue outside the scrolling ERP layout and cleans up afterwards', async () => {
    const labels = source();
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const document = window.document.querySelector('.barcode-print-document')!;
      expect(document.parentElement).toBe(window.document.body);
      expect(document.children).toHaveLength(3);
      expect(document.firstElementChild).not.toBe(labels.firstElementChild);
      expect(document.textContent).toBe('MP000001MP000001MP000002');
      expect(window.document.body.lastElementChild?.textContent).toContain('size: 50mm 25mm');
      expect(window.document.body.lastElementChild?.textContent).toContain('body > :not(.barcode-print-document) { display: none !important; }');
      expect(window.document.body.lastElementChild?.textContent).toContain('break-after: auto; page-break-after: auto;');
    });
    await printBrowserLabels(labels, defaultLabelTemplate());
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector('.barcode-print-document')).toBeNull();
    expect(document.querySelector('style')).toBeNull();
    expect(labels.children).toHaveLength(3);
  });

  it('waits for the company logo before opening the print dialog', async () => {
    const labels = source();
    labels.firstElementChild!.innerHTML = '<img src="/company-logo.png">';
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const pending = printBrowserLabels(labels, defaultLabelTemplate());
    expect(print).not.toHaveBeenCalled();
    document.querySelector('.barcode-print-document img')!.dispatchEvent(new Event('load'));
    await pending;
    expect(print).toHaveBeenCalledOnce();
  });

  it('restores the page when the printer dialog fails', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('Printer unavailable'); });
    await expect(printBrowserLabels(source(), defaultLabelTemplate())).rejects.toThrow('Printer unavailable');
    expect(document.querySelector('.barcode-print-document')).toBeNull();
    expect(document.querySelector('style')).toBeNull();
  });

  it('rejects an empty print queue before calling the printer', async () => {
    const print = vi.spyOn(window, 'print');
    await expect(printBrowserLabels(document.createElement('div'), defaultLabelTemplate())).rejects.toThrow('Label content is not ready');
    expect(print).not.toHaveBeenCalled();
  });
});
