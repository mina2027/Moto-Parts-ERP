import { BrowserWindow, dialog } from 'electron';
import { invoicePageMarginMm, invoiceRollHeightMm, type PrintOutcome } from '@moto/shared';
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { buildPrintDocument, clampScale, previewWindowSize, PX_PER_MM, rollPageHeightMm } from './printLayout';
import { printCsp, securePrintWindow } from './printSecurity';

const execFileAsync = promisify(execFile);

export interface PrintJob {
  approvedLogo?: string;
  html: string;
  printerName?: string | null;
  silent: boolean;
  copies: number;
  widthMm: number;
  /** null = roll paper: the page is sized to the rendered content. */
  heightMm: number | null;
  /** Content zoom (1 = 100%) to fit a printer whose printable area is narrower than the paper. */
  scale?: number;
  /** Window title for jobs that have to surface the system print dialog. */
  title?: string;
  mode?: 'printer' | 'pdf';
  locale?: 'ar' | 'en';
}

export interface PrinterEntry {
  name: string;
  displayName: string;
  isDefault: boolean;
  virtual: boolean;
}

const VIRTUAL_PRINTER = /print to pdf|xps|onenote|fax|send to/i;
const isInvoice = (html: string) => /class=["'][^"']*\binvoice\b/i.test(html);

async function defaultPrinterName(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "Get-CimInstance Win32_Printer -Filter 'Default = TRUE' | Select-Object -ExpandProperty Name"], { windowsHide: true, timeout: 5000 }).catch(() => null);
  return result?.stdout.trim() || null;
}

export async function listPrinters(win: BrowserWindow): Promise<PrinterEntry[]> {
  const list = await win.webContents.getPrintersAsync();
  const defaultName = list.some(p => 'isDefault' in p) ? null : await defaultPrinterName();
  return list.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean((p as { isDefault?: boolean }).isDefault) || p.name === defaultName, virtual: VIRTUAL_PRINTER.test(p.name) }));
}

/** Automatic drawer opening needs an explicitly configured, installed physical printer. */
export function configuredDrawerPrinter(printers: readonly PrinterEntry[], configured: string | null | undefined): string | null {
  const wanted = configured?.trim().toLowerCase();
  if (!wanted) return null;
  const printer = printers.find((p) => p.name.toLowerCase() === wanted);
  return printer && !printer.virtual ? printer.name : null;
}

/** Picks the physical target: explicit name if installed, else the OS default unless it is a virtual (PDF/XPS) printer. */
export async function resolvePrinter(win: BrowserWindow, wanted: string | null | undefined): Promise<{ name: string | null; virtual: boolean }> {
  const list = await listPrinters(win);
  if (wanted) {
    const hit = list.find((p) => p.name.toLowerCase() === wanted.toLowerCase());
    if (hit) return { name: hit.name, virtual: VIRTUAL_PRINTER.test(hit.name) };
    throw new Error(`الطابعة المحددة غير متاحة / Printer unavailable: ${wanted}`);
  }
  const def = list.find((p) => p.isDefault) ?? list[0];
  return { name: def?.name ?? null, virtual: !def || VIRTUAL_PRINTER.test(def.name) };
}

/**
 * Loads the job into `win` and returns the final page height. The document goes through a temp file: a
 * percent-encoded data: URL fails with ERR_FAILED as soon as the markup contains "#" (e.g. `color:#000`), which
 * every receipt template does.
 */
export async function loadPrintDocument(win: BrowserWindow, job: Pick<PrintJob, 'html' | 'widthMm' | 'heightMm' | 'scale' | 'approvedLogo'>): Promise<{ heightMm: number }> {
  const file = path.join(os.tmpdir(), `moto-print-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`);
  securePrintWindow(win.webContents);
  const invoice = isInvoice(job.html);
  const document = buildPrintDocument(job.html, job.widthMm, job.heightMm, clampScale(job.scale), invoice).replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${printCsp(job.approvedLogo)}">`);
  await fs.writeFile(file, document, 'utf8');
  try {
    await win.loadFile(file);
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
  // Templates may embed web fonts (A4 invoice) and a remote logo; don't print fallback glyphs or a missing image.
  const ready = `Promise.all([document.fonts.ready, ...Array.from(document.images).map((i) => i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; }))]).then(() => true)`;
  await Promise.race([win.webContents.executeJavaScript(ready), new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 150));
  if (job.heightMm) return { heightMm: job.heightMm };
  // body is unzoomed and wraps the zoomed root, so its box height is the printed content height in CSS px.
  const px = Number(await win.webContents.executeJavaScript('document.body.getBoundingClientRect().height'));
  if (!Number.isFinite(px) || px <= 0) throw new Error('Invoice content could not be measured');
  const heightMm = invoice ? invoiceRollHeightMm(px, job.widthMm) : rollPageHeightMm(px);
  const margin = invoice ? invoicePageMarginMm(job.widthMm) : 0;
  await win.webContents.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = '@page { size: ${job.widthMm}mm ${heightMm}mm; margin: ${margin}mm; }'; document.head.appendChild(s); })()`);
  return { heightMm };
}

/** Generate a PDF with the same fonts and paper layout used for printing. */
export async function invoicePdf(win: BrowserWindow, job: PrintJob): Promise<Buffer> {
  const { heightMm } = await loadPrintDocument(win, job);
  const margin = isInvoice(job.html) ? invoicePageMarginMm(job.widthMm) / 25.4 : 0;
  return win.webContents.printToPDF({ printBackground: true, margins: { top: margin, bottom: margin, left: margin, right: margin }, pageSize: { width: job.widthMm / 25.4, height: heightMm / 25.4 }, preferCSSPageSize: true });
}

/** Prints an HTML document to the chosen printer using a hidden window. Silent only when a real printer is resolved. */
export async function printHtml(job: PrintJob, parent?: BrowserWindow | null): Promise<PrintOutcome> {
  const owner = parent && !parent.isDestroyed() ? parent : undefined;
  const win = new BrowserWindow({
    show: false,
    parent: owner,
    skipTaskbar: true,
    autoHideMenuBar: true,
    title: job.title ?? 'Print',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  let closedByUser = false;
  let restoreOwner = false;
  win.on('close', () => {
    closedByUser = true;
  });
  try {
    if (job.mode === 'pdf') {
      restoreOwner = true;
      const options = { title: job.locale === 'en' ? 'Save invoice PDF' : 'حفظ الفاتورة PDF', defaultPath: `${(job.title || 'invoice').replace(/[<>:"/\\|?*]/g, '-')}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] };
      const saved = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      if (saved.canceled || !saved.filePath) return { status: 'cancelled' };
      const pdf = await invoicePdf(win, job);
      await fs.writeFile(saved.filePath, pdf);
      return { status: 'saved' };
    }
    const target = await resolvePrinter(win, job.printerName);
    if (!target.name) throw new Error('لا توجد طابعة مثبتة على الجهاز / No installed printer');
    // A virtual default would pop a "Save As" dialog from a "silent" job; show a real printer picker instead.
    const silent = job.silent && !target.virtual;
    const { heightMm } = await loadPrintDocument(win, job);
    // The dialog is owned by this window, so a window that was never shown leaves it invisible behind the app and
    // the job looks like it did nothing. Showing it also gives the operator the preview the dialog implies.
    if (!silent) {
      const { width, height } = previewWindowSize(job.widthMm, job.heightMm ?? heightMm);
      win.setContentSize(width, height);
      win.center();
      restoreOwner = true;
      win.show();
    }
    const microns = { width: Math.round(job.widthMm * 1000), height: Math.round(heightMm * 1000) };
    const margin = isInvoice(job.html) ? invoicePageMarginMm(job.widthMm) * PX_PER_MM : 0;
    return await new Promise<PrintOutcome>((resolve, reject) => {
      let settled = false;
      const finish = (status: 'printed' | 'cancelled') => { if (!settled) { settled = true; clearTimeout(timer); resolve({ status }); } };
      const timer = setTimeout(() => {
        if (!settled) { settled = true; reject(new Error(job.locale === 'en' ? 'The printer did not respond. Check its connection before retrying.' : 'الطابعة لم تستجب. تحقق من توصيلها قبل إعادة المحاولة.')); }
      }, 60_000);
      // Closing the preview cancels the job; without this the callback never fires and the caller waits forever.
      win.once('closed', () => finish('cancelled'));
      win.webContents.print(
        { silent, printBackground: true, deviceName: target.name ?? undefined, copies: job.copies, margins: margin ? { marginType: 'custom', top: margin, bottom: margin, left: margin, right: margin } : { marginType: 'none' }, pageSize: microns, landscape: false, scaleFactor: 100 },
        (ok, reason) => {
          if (ok) finish('printed');
          else if (closedByUser || /cancel/i.test(reason || '')) finish('cancelled');
          else if (!settled) { settled = true; clearTimeout(timer); reject(new Error(reason || 'print failed')); }
        },
      );
    });
  } finally {
    if (!win.isDestroyed()) win.destroy();
    if (restoreOwner && owner) {
      // Let Windows release the native dialog before returning keyboard focus to the sales screen.
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (!owner.isDestroyed()) {
        if (owner.isMinimized()) owner.restore();
        if (!owner.isVisible()) owner.show();
        owner.focus();
      }
    }
  }
}

/**
 * ESC/POS drawer kick. The bytes must reach the printer *raw* — a normal print job would rasterise them as glyphs —
 * so on Windows we spool a RAW datatype job through PowerShell/winspool. Returns false when no real printer exists or
 * the platform is unsupported; callers should surface that instead of pretending the drawer opened.
 */
export async function kickDrawer(printerName: string | null | undefined): Promise<boolean> {
  const probe = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  let target: { name: string | null; virtual: boolean };
  try {
    target = await resolvePrinter(probe, printerName);
  } finally {
    probe.destroy();
  }
  if (!target.name || target.virtual) return false;
  if (process.platform !== 'win32') return false;
  const bytes = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);
  const stamp = `${process.pid}-${Date.now()}`;
  const tmp = path.join(os.tmpdir(), `moto-kick-${stamp}.bin`);
  const ps1 = path.join(os.tmpdir(), `moto-kick-${stamp}.ps1`);
  await fs.writeFile(tmp, bytes);
  const script = `param([string]$Printer, [string]$File)
$sig = @"
using System; using System.IO; using System.Runtime.InteropServices;
public class RawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr pd);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)] public static extern int StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] public static extern bool WritePrinter(IntPtr h, byte[] b, int c, out int w);
  public static bool Send(string printer, byte[] data) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    var di = new DOCINFOW { pDocName = "MotoParts drawer", pDataType = "RAW" };
    bool ok = false; int w;
    if (StartDocPrinter(h, 1, di) > 0) { if (StartPagePrinter(h)) { ok = WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); } EndDocPrinter(h); }
    ClosePrinter(h); return ok;
  }
}
"@
Add-Type -TypeDefinition $sig
$bytes = [IO.File]::ReadAllBytes($File)
if (-not [RawPrint]::Send($Printer, $bytes)) { exit 1 }
`;
  await fs.writeFile(ps1, script, 'utf8');
  try {
    // Arguments are passed positionally to -File, so the printer name is never interpolated into script text.
    await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, target.name, tmp], { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  } finally {
    await Promise.all([fs.unlink(tmp), fs.unlink(ps1)].map((p) => p.catch(() => undefined)));
  }
}
