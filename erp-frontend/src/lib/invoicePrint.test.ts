import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultPrintProfiles } from '@moto/shared';
import { printBrowserInvoice } from './invoicePrint';

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

describe('complete browser invoice printing', () => {
  const profile = defaultPrintProfiles().find(p => p.paper === 'thermal80')!;

  it('measures the isolated copy at the printable width instead of the clipped preview', async () => {
    const preview = document.createElement('div');
    preview.className = 'invoice';
    preview.textContent = 'آخر بند في الفاتورة';
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { height: this.classList.contains('invoice-print-document') ? 800 : 100 } as DOMRect;
    });
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const copy = document.querySelector<HTMLElement>('.invoice-print-document')!;
      expect(copy.style.width).toBe('80mm');
      expect(copy.textContent).toContain('آخر بند في الفاتورة');
      expect(document.body.lastElementChild?.textContent).toContain('@page { size: 80mm 216mm; margin: 0mm; }');
      expect(document.body.lastElementChild?.textContent).toContain('position: static !important');
    });
    await printBrowserInvoice(preview, profile);
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector('.invoice-print-document')).toBeNull();
  });

  it('waits for invoice images before measuring the roll length', async () => {
    const preview = document.createElement('div');
    preview.innerHTML = '<img src="/logo.png" />';
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(false);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const request = printBrowserInvoice(preview, profile);
    expect(print).not.toHaveBeenCalled();
    document.querySelector('.invoice-print-document img')!.dispatchEvent(new Event('load'));
    await request;
    expect(print).toHaveBeenCalledOnce();
  });
});
