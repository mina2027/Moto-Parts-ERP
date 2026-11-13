import { describe, expect, it } from 'vitest';
import { Link } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Money } from '@/components/shared/page';
import { StatusBadge } from '@/components/shared/status-badge';
import { columnsToExport, nodeToText } from './tableExport';
import { buildCsv } from './export';

interface Row {
  id: string;
  name: string;
  total: number;
  status: string;
}

const rows: Row[] = [
  { id: 's-1', name: 'فاتورة أولى', total: 1250.5, status: 'completed' },
  { id: 's-2', name: 'Second invoice', total: 0, status: 'cancelled' },
];

const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'name', header: 'الصنف', cell: ({ row }) => <Link to={`/sales/${row.original.id}`}>{row.original.name}</Link> },
  { accessorKey: 'total', header: 'الإجمالي', cell: ({ row }) => <Money value={row.original.total} />, meta: { align: 'end' } },
  { accessorKey: 'status', header: 'الحالة', cell: ({ row }) => <StatusBadge status={row.original.status} labelKey="sales.status" /> },
  { id: 'act', header: '', cell: () => <button type="button">حذف</button> },
];

describe('nodeToText', () => {
  it('renders a router link to its visible text', () => {
    expect(nodeToText(<Link to="/x">نص الرابط</Link>)).toBe('نص الرابط');
  });

  it('resolves a translated badge rather than the raw status key', () => {
    const text = nodeToText(<StatusBadge status="completed" labelKey="sales.status" />);
    expect(text).not.toBe('completed');
    expect(text.length).toBeGreaterThan(0);
  });

  it('decodes HTML entities produced by the renderer', () => {
    expect(nodeToText(<span>{'A & B < C'}</span>)).toBe('A & B < C');
  });
});

describe('columnsToExport', () => {
  const exportColumns = columnsToExport(columns);

  it('drops the action column', () => {
    expect(exportColumns.map((c) => c.header)).toEqual(['الصنف', 'الإجمالي', 'الحالة']);
  });

  it('keeps aligned-end columns numeric with their raw value', () => {
    const total = exportColumns[1]!;
    expect(total.numeric).toBe(true);
    expect(total.value(rows[0]!)).toBe(1250.5);
    expect(total.value(rows[1]!)).toBe(0);
  });

  it('produces a populated CSV instead of blank cells', () => {
    const lines = buildCsv({ filename: 'x', title: 'y', columns: exportColumns, rows }).split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('فاتورة أولى');
    expect(lines[1]).toContain('1250.5');
    expect(lines[2]).toContain('Second invoice');
    expect(lines.every((l) => l.split(',').filter(Boolean).length >= 2)).toBe(true);
  });
});
