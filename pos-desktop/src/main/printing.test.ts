import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  printers: [{ name: 'Receipt-80', displayName: 'Receipt', isDefault: true }], result: true, reason: '',
  windows: [] as unknown[], windowOptions: [] as unknown[], cancelled: true, filePath: '',
  onPrint: undefined as (() => void) | undefined, deferCallback: false,
}));

vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class BrowserWindow extends EventEmitter {
    destroyed = false;
    visible = false;
    minimized = false;
    webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      getPrintersAsync: vi.fn(async () => state.printers),
      executeJavaScript: vi.fn(async (code: string) => code.includes('getBoundingClientRect') ? 500 : true),
      print: vi.fn((_options, callback) => {
        state.onPrint?.();
        if (!state.deferCallback) callback(state.result, state.reason);
      }),
      printToPDF: vi.fn(async () => Buffer.from('%PDF-test')),
    };
    constructor(options: { show?: boolean } = {}) {
      super();
      this.visible = options.show !== false;
      state.windows.push(this);
      state.windowOptions.push(options);
    }
    loadFile = vi.fn(async () => undefined);
    setContentSize = vi.fn();
    center = vi.fn();
    show = vi.fn(() => { this.visible = true; });
    hide = vi.fn(() => { this.visible = false; });
    minimize = vi.fn(() => { this.minimized = true; this.visible = false; });
    restore = vi.fn(() => { this.minimized = false; this.visible = true; });
    focus = vi.fn();
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  return { BrowserWindow, dialog: { showSaveDialog: vi.fn(async () => ({ canceled: state.cancelled, filePath: state.filePath })) } };
});

import { configuredDrawerPrinter, printHtml, resolvePrinter } from './printing';
import { BrowserWindow } from 'electron';

const job = { html: '<div dir="rtl">فاتورة INV-1</div>', silent: true, copies: 1, widthMm: 80, heightMm: null };

describe('automatic cash drawer eligibility', () => {
  const physical = { name: 'Receipt-80', displayName: 'Receipt', isDefault: true, virtual: false };
  const pdf = { name: 'Microsoft Print to PDF', displayName: 'PDF', isDefault: true, virtual: true };
  const oneNote = { name: 'OneNote (Desktop)', displayName: 'OneNote', isDefault: false, virtual: true };

  it('skips drawer opening when only PDF and OneNote are installed', () => {
    expect(configuredDrawerPrinter([pdf, oneNote], pdf.name)).toBeNull();
    expect(configuredDrawerPrinter([pdf, oneNote], oneNote.name)).toBeNull();
    expect(configuredDrawerPrinter([pdf, oneNote], physical.name)).toBeNull();
  });

  it('skips unconfigured and missing printers without selecting unrelated hardware', () => {
    expect(configuredDrawerPrinter([physical], null)).toBeNull();
    expect(configuredDrawerPrinter([physical], 'Disconnected')).toBeNull();
    expect(configuredDrawerPrinter([], physical.name)).toBeNull();
  });

  it('keeps drawer opening enabled for an installed configured physical printer', () => {
    expect(configuredDrawerPrinter([pdf, physical], ' receipt-80 ')).toBe(physical.name);
  });
});

describe('desktop printer routing', () => {
  beforeEach(() => {
    state.printers = [{ name: 'Receipt-80', displayName: 'Receipt', isDefault: true }];
    state.result = true;
    state.reason = '';
    state.windows = [];
    state.windowOptions = [];
    state.onPrint = undefined;
    state.deferCallback = false;
    state.cancelled = true;
    state.filePath = '';
  });

  it('sends a receipt to the selected physical printer at the exact width', async () => {
    await printHtml({ ...job, printerName: 'Receipt-80' });
    const win = state.windows[0] as BrowserWindow;
    expect(win.webContents.print).toHaveBeenCalledWith(expect.objectContaining({ silent: true, deviceName: 'Receipt-80', pageSize: { width: 80000, height: 137000 }, landscape: false, scaleFactor: 100 }), expect.any(Function));
    expect(win.isDestroyed()).toBe(true);
  });

  it('uses exact A4 dimensions for a large invoice', async () => {
    await printHtml({ ...job, widthMm: 210, heightMm: 297 });
    const win = state.windows[0] as BrowserWindow;
    expect(win.webContents.print).toHaveBeenCalledWith(expect.objectContaining({ pageSize: { width: 210000, height: 297000 }, landscape: false, scaleFactor: 100 }), expect.any(Function));
  });

  it('matches the measured invoice canvas without external margins or scaling', async () => {
    await printHtml({ ...job, html: '<div class="mpt invoice">فاتورة</div>' });
    const win = state.windows[0] as BrowserWindow;
    expect(win.webContents.print).toHaveBeenCalledWith(expect.objectContaining({
      pageSize: { width: 80000, height: Math.ceil(500 * 25.4 / 96 + 4) * 1000 },
      margins: { marginType: 'none' },
      scaleFactor: 100,
    }), expect.any(Function));
  });

  it('shows the system dialog even when a physical printer is the default', async () => {
    await expect(printHtml({ ...job, printerName: null, silent: false, mode: 'printer' })).resolves.toEqual({ status: 'printed' });
    const win = state.windows[0] as BrowserWindow;
    expect(win.show).toHaveBeenCalled();
    expect(win.webContents.print).toHaveBeenCalledWith(expect.objectContaining({ silent: false, deviceName: 'Receipt-80' }), expect.any(Function));
  });

  it('shows a visible dialog for PDF printers and preserves the chosen printer', async () => {
    state.printers = [{ name: 'Microsoft Print to PDF', displayName: 'PDF', isDefault: true }];
    await printHtml({ ...job, printerName: 'Microsoft Print to PDF' });
    const win = state.windows[0] as BrowserWindow;
    expect(win.show).toHaveBeenCalled();
    expect(win.webContents.print).toHaveBeenCalledWith(expect.objectContaining({ silent: false, deviceName: 'Microsoft Print to PDF' }), expect.any(Function));
  });

  it('reports a missing configured printer instead of sending the invoice to another printer', async () => {
    await expect(resolvePrinter(new BrowserWindow(), 'Disconnected')).rejects.toThrow('Printer unavailable');
  });

  it('reports a failed print callback and releases the print window', async () => {
    state.result = false;
    state.reason = 'Printer offline';
    await expect(printHtml(job)).rejects.toThrow('Printer offline');
    expect((state.windows[0] as BrowserWindow).isDestroyed()).toBe(true);
  });

  it('reports when Windows has no installed printers', async () => {
    state.printers = [];
    await expect(printHtml(job)).rejects.toThrow('No installed printer');
  });

  it('distinguishes a cancelled system print dialog from a successful print', async () => {
    state.result = false;
    state.reason = 'Print job canceled';
    await expect(printHtml(job)).resolves.toEqual({ status: 'cancelled' });
  });

  it('allows cancelling PDF export when no printer is installed', async () => {
    state.printers = [];
    await expect(printHtml({ ...job, mode: 'pdf' })).resolves.toEqual({ status: 'cancelled' });
    expect((state.windows[0] as BrowserWindow).webContents.print).not.toHaveBeenCalled();
  });

  it.each([
    ['successful', true, '', 'printed'],
    ['cancelled', false, 'Print job canceled', 'cancelled'],
    ['failed', false, 'Printer offline', 'failed'],
  ] as const)('returns a minimized POS window to the foreground after a %s print', async (_label, result, reason, status) => {
    const parent = new BrowserWindow({ show: true });
    state.result = result;
    state.reason = reason;
    state.onPrint = () => parent.minimize();

    const request = printHtml({ ...job, silent: false }, parent);
    if (status === 'failed') await expect(request).rejects.toThrow('Printer offline');
    else await expect(request).resolves.toEqual({ status });

    const printWindow = state.windows[1] as BrowserWindow;
    expect(state.windowOptions[1]).toMatchObject({ parent, skipTaskbar: true });
    expect(printWindow.isDestroyed()).toBe(true);
    expect(parent.isDestroyed()).toBe(false);
    expect(parent.restore).toHaveBeenCalledOnce();
    expect(parent.isMinimized()).toBe(false);
    expect(parent.isVisible()).toBe(true);
    expect(parent.focus).toHaveBeenCalledOnce();
  });

  it('shows the POS again if the print dialog leaves its owner hidden', async () => {
    const parent = new BrowserWindow({ show: true });
    state.onPrint = () => parent.hide();
    await printHtml({ ...job, silent: false }, parent);
    expect(parent.show).toHaveBeenCalledOnce();
    expect(parent.restore).not.toHaveBeenCalled();
    expect(parent.isVisible()).toBe(true);
    expect(parent.focus).toHaveBeenCalledOnce();
  });

  it('returns focus after the operator closes the preview without a print callback', async () => {
    const parent = new BrowserWindow({ show: true });
    state.deferCallback = true;
    state.onPrint = () => {
      const preview = state.windows[1] as BrowserWindow;
      preview.emit('close');
      preview.destroy();
    };
    await expect(printHtml({ ...job, silent: false }, parent)).resolves.toEqual({ status: 'cancelled' });
    expect(parent.isDestroyed()).toBe(false);
    expect(parent.focus).toHaveBeenCalledOnce();
  });

  it('returns focus after cancelling the PDF save dialog', async () => {
    const parent = new BrowserWindow({ show: true });
    await expect(printHtml({ ...job, mode: 'pdf' }, parent)).resolves.toEqual({ status: 'cancelled' });
    expect(parent.focus).toHaveBeenCalledOnce();
    expect(parent.isDestroyed()).toBe(false);
  });

  it('does not focus an owner that was closed during printing', async () => {
    const parent = new BrowserWindow({ show: true });
    state.onPrint = () => parent.destroy();
    await expect(printHtml({ ...job, silent: false }, parent)).resolves.toEqual({ status: 'printed' });
    expect(parent.focus).not.toHaveBeenCalled();
    expect(parent.show).not.toHaveBeenCalled();
  });

  it('does not steal focus for a silent print without a dialog', async () => {
    const parent = new BrowserWindow({ show: true });
    await expect(printHtml(job, parent)).resolves.toEqual({ status: 'printed' });
    expect(parent.focus).not.toHaveBeenCalled();
    expect(parent.show).not.toHaveBeenCalled();
    expect(parent.restore).not.toHaveBeenCalled();
  });
});
