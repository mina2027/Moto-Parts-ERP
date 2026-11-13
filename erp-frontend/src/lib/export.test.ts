import { describe, expect, it } from 'vitest';
import { EmptyExportError, buildCsv, buildPrintHtml, buildXlsxBytes, buildXlsxSheet, type ExportPayload } from './export';

interface Row {
  name: string;
  qty: number;
  branch: string;
}

const rows: Row[] = [
  { name: 'بستم CG125', qty: 12, branch: 'بورتسودان' },
  { name: 'Brake Pads, front', qty: 0, branch: 'الخرطوم' },
  { name: 'طقم "شنابر"', qty: 5, branch: 'بورتسودان' },
];

const payload: ExportPayload<Row> = {
  filename: 'stock',
  title: 'المخزون',
  columns: [
    { header: 'الصنف', value: (r) => r.name },
    { header: 'الكمية', value: (r) => r.qty, numeric: true },
    { header: 'الفرع', value: (r) => r.branch },
  ],
  rows,
  meta: [{ label: 'الفرع', value: 'كل الفروع' }],
};

describe('CSV export', () => {
  it('writes a header plus one line per row', () => {
    const lines = buildCsv(payload).split('\r\n');
    // meta line, blank separator, header, 3 rows
    expect(lines).toHaveLength(6);
    expect(lines[2]).toBe('الصنف,الكمية,الفرع');
    expect(lines[3]).toBe('بستم CG125,12,بورتسودان');
  });

  it('quotes cells containing commas and escapes embedded quotes', () => {
    const lines = buildCsv(payload).split('\r\n');
    expect(lines[4]).toBe('"Brake Pads, front",0,الخرطوم');
    expect(lines[5]).toBe('"طقم ""شنابر""",5,بورتسودان');
  });

  it('keeps Arabic intact and exposes zero as a value rather than a blank', () => {
    const csv = buildCsv(payload);
    expect(csv).toContain('بورتسودان');
    expect(csv).toContain(',0,');
  });

  it('refuses to produce an empty file', () => {
    expect(() => buildCsv({ ...payload, rows: [] })).toThrow(EmptyExportError);
    expect(() => buildCsv({ ...payload, columns: [] })).toThrow(EmptyExportError);
  });
});

describe('XLSX export', () => {
  it('emits one sheet row per data row with the header included', () => {
    const sheet = buildXlsxSheet(payload);
    const rowCount = (sheet.match(/<row /g) ?? []).length;
    // 1 meta + 1 blank + 1 header + 3 data
    expect(rowCount).toBe(6);
  });

  it('writes numbers as numeric cells and text as inline strings', () => {
    const sheet = buildXlsxSheet(payload);
    expect(sheet).toContain('<v>12</v>');
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('بستم CG125');
  });

  it('escapes XML-significant characters', () => {
    const sheet = buildXlsxSheet({ ...payload, rows: [{ name: 'A & B <x>', qty: 1, branch: '"q"' }] });
    expect(sheet).toContain('A &amp; B &lt;x&gt;');
    expect(sheet).not.toContain('<x>');
  });

  it('marks the sheet right-to-left by default', () => {
    expect(buildXlsxSheet(payload)).toContain('rightToLeft="1"');
    expect(buildXlsxSheet({ ...payload, rtl: false })).not.toContain('rightToLeft');
  });

  it('produces a non-empty zip container with the expected parts', () => {
    const bytes = buildXlsxBytes(payload);
    expect(bytes.length).toBeGreaterThan(500);
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('PK')).toBe(true);
    // Each part needs both a local header and a central-directory entry or Excel rejects the file.
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/styles.xml']) {
      expect(text.split(part).length - 1).toBeGreaterThanOrEqual(2);
    }
    expect(text.split('PK\x03\x04').length - 1).toBe(6);
    expect(text.split('PK\x01\x02').length - 1).toBe(6);
    expect(text.endsWith('\0\0')).toBe(true);
  });
});

describe('PDF/print export', () => {
  it('renders an RTL document with every row', () => {
    const html = buildPrintHtml(payload);
    expect(html).toContain('dir="rtl"');
    expect((html.match(/<tr>/g) ?? []).length).toBe(rows.length + 1);
    expect(html).toContain('بستم CG125');
  });

  it('switches direction when rtl is off', () => {
    expect(buildPrintHtml({ ...payload, rtl: false })).toContain('dir="ltr"');
  });
});
