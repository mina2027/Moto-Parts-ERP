import { createZip, zipBytes, type ZipEntry } from './zip';

export type ExportCell = string | number | null | undefined;

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => ExportCell;
  /** Numeric columns are written as real numbers so Excel can sum them. */
  numeric?: boolean;
}

export interface ExportMeta {
  label: string;
  value: string;
}

export interface ExportPayload<T> {
  filename: string;
  title: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** Active filters/date range/branch, printed above the table so the file is self-describing. */
  meta?: ExportMeta[];
  rtl?: boolean;
}

export class EmptyExportError extends Error {
  constructor() {
    super('No rows to export');
    this.name = 'EmptyExportError';
  }
}

function assertRows<T>(payload: ExportPayload<T>) {
  if (!payload.rows.length || !payload.columns.length) throw new EmptyExportError();
}

function cells<T>(payload: ExportPayload<T>): ExportCell[][] {
  return payload.rows.map((row) => payload.columns.map((c) => c.value(row)));
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke late: Safari aborts the download if the object URL dies too early.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function timestampedName(base: string, ext: string) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${base}-${stamp}.${ext}`;
}

// ---------- CSV ----------

function csvCell(v: ExportCell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv<T>(payload: ExportPayload<T>): string {
  assertRows(payload);
  const lines: string[] = [];
  if (payload.meta?.length) {
    for (const m of payload.meta) lines.push(`${csvCell(m.label)},${csvCell(m.value)}`);
    lines.push('');
  }
  lines.push(payload.columns.map((c) => csvCell(c.header)).join(','));
  for (const row of cells(payload)) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

export function exportCsv<T>(payload: ExportPayload<T>) {
  const csv = buildCsv(payload);
  // Excel only detects UTF-8 (and therefore Arabic) when the BOM is present.
  download(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' }), timestampedName(payload.filename, 'csv'));
}

// ---------- XLSX ----------

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetRow(values: ExportCell[], rowIndex: number, numeric: boolean[], styleId: number): string {
  const cs = values
    .map((v, i) => {
      const ref = `${colName(i)}${rowIndex}`;
      const style = styleId ? ` s="${styleId}"` : '';
      if (v === null || v === undefined || v === '') return `<c r="${ref}"${style}/>`;
      if (numeric[i] && typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(v))}</t></is></c>`;
    })
    .join('');
  return `<row r="${rowIndex}">${cs}</row>`;
}

export function buildXlsxSheet<T>(payload: ExportPayload<T>): string {
  const numeric = payload.columns.map((c) => Boolean(c.numeric));
  const rows: string[] = [];
  let r = 1;
  if (payload.meta?.length) {
    for (const m of payload.meta) rows.push(sheetRow([m.label, m.value], r++, [false, false], 0));
    rows.push(`<row r="${r++}"/>`);
  }
  rows.push(sheetRow(payload.columns.map((c) => c.header), r++, payload.columns.map(() => false), 1));
  for (const row of cells(payload)) rows.push(sheetRow(row, r++, numeric, 0));

  const widths = payload.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="18" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"${payload.rtl === false ? '' : ' rightToLeft="1"'}/></sheetViews><cols>${widths}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`;
}

export function buildXlsx<T>(payload: ExportPayload<T>): Blob {
  return createZip(xlsxParts(payload));
}

export function buildXlsxBytes<T>(payload: ExportPayload<T>): Uint8Array {
  return zipBytes(xlsxParts(payload));
}

function xlsxParts<T>(payload: ExportPayload<T>): ZipEntry[] {
  assertRows(payload);
  const sheetName = xmlEscape(payload.title.slice(0, 28).replace(/[\\/?*[\]:]/g, ' ')) || 'Sheet1';
  return [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`,
    },
    { name: 'xl/worksheets/sheet1.xml', data: buildXlsxSheet(payload) },
  ];
}

export function exportXlsx<T>(payload: ExportPayload<T>) {
  download(buildXlsx(payload), timestampedName(payload.filename, 'xlsx'));
}

// ---------- PDF (via the browser print pipeline, which shapes Arabic correctly) ----------

export function buildPrintHtml<T>(payload: ExportPayload<T>): string {
  assertRows(payload);
  const dir = payload.rtl === false ? 'ltr' : 'rtl';
  const meta = (payload.meta ?? []).map((m) => `<span><b>${xmlEscape(m.label)}:</b> ${xmlEscape(m.value)}</span>`).join('');
  const head = payload.columns.map((c) => `<th>${xmlEscape(c.header)}</th>`).join('');
  const body = cells(payload)
    .map((row) => `<tr>${row.map((v, i) => `<td class="${payload.columns[i]!.numeric ? 'num' : ''}">${xmlEscape(v === null || v === undefined ? '' : String(v))}</td>`).join('')}</tr>`)
    .join('');
  return `<!doctype html><html dir="${dir}" lang="${dir === 'rtl' ? 'ar' : 'en'}"><head><meta charset="utf-8"><title>${xmlEscape(payload.title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: "Segoe UI", Tahoma, "Noto Naskh Arabic", sans-serif; font-size: 11px; color: #111; }
  h1 { font-size: 16px; margin: 0 0 4px; }
  .meta { display: flex; flex-wrap: wrap; gap: 12px; font-size: 10px; color: #555; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: ${dir === 'rtl' ? 'right' : 'left'}; }
  th { background: #f1f5f9; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: ${dir === 'rtl' ? 'left' : 'right'}; font-variant-numeric: tabular-nums; }
  tfoot { font-size: 9px; color: #777; }
</style></head><body>
<h1>${xmlEscape(payload.title)}</h1>
<div class="meta">${meta}<span>${xmlEscape(new Date().toLocaleString(dir === 'rtl' ? 'ar-EG' : 'en-GB'))}</span><span>${payload.rows.length}</span></div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
}

/** Opens the rendered table in a print window; the user picks "Save as PDF". */
export function exportPdf<T>(payload: ExportPayload<T>) {
  const html = buildPrintHtml(payload);
  const win = window.open('', '_blank', 'width=1100,height=800');
  if (!win) throw new Error('POPUP_BLOCKED');
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  // Give the window a tick to lay the table out before the print dialog freezes it.
  setTimeout(() => win.print(), 300);
}
