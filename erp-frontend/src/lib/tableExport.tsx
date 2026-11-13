import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import type { ExportCell, ExportColumn } from './export';

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };

/**
 * Renders a table cell the way the user sees it, so exports inherit every formatter, badge label and
 * translation instead of duplicating them. The router wrapper keeps `<Link>`-based cells renderable.
 */
export function nodeToText(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  const error = console.error;
  // React's dev build warns about useLayoutEffect for every router-backed cell; the markup is still correct.
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].includes('useLayoutEffect does nothing on the server')) return;
    error(...args);
  };
  try {
    const html = renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
    return html
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[#a-z0-9]+;/gi, (m) => ENTITIES[m] ?? m)
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return '';
  } finally {
    console.error = error;
  }
}

type AnyColumn<T> = ColumnDef<T, unknown> & { accessorKey?: string; accessorFn?: (row: T) => unknown };

function headerOf<T>(c: AnyColumn<T>, index: number): string {
  if (typeof c.header === 'string') return c.header;
  return c.id ?? c.accessorKey ?? `#${index + 1}`;
}

const isNumericColumn = <T,>(c: AnyColumn<T>) => (c.meta as { align?: string } | undefined)?.align === 'end';

function rawValue<T>(c: AnyColumn<T>, row: T): unknown {
  if (c.accessorFn) return c.accessorFn(row);
  if (c.accessorKey) return (row as Record<string, unknown>)[c.accessorKey];
  return undefined;
}

/** Builds export columns from a TanStack column list, skipping selection/action columns. */
export function columnsToExport<T>(columns: ColumnDef<T, unknown>[], skipIds: string[] = ['act', 'actions', 'select']): ExportColumn<T>[] {
  return (columns as AnyColumn<T>[])
    .filter((c) => !skipIds.includes(c.id ?? '') && headerOf(c, 0) !== '')
    .map((c, i) => ({
      header: headerOf(c, i),
      numeric: isNumericColumn(c),
      value: (row: T): ExportCell => {
        // Numeric columns keep the raw number so spreadsheets can total them.
        if (isNumericColumn(c)) {
          const raw = rawValue(c, row);
          if (typeof raw === 'number') return raw;
        }
        if (typeof c.cell === 'function') {
          const text = nodeToText(c.cell({ row: { original: row } } as never) as React.ReactNode);
          if (text) return isNumericColumn(c) && text !== '' && !Number.isNaN(Number(text.replace(/[\s,]/g, ''))) ? Number(text.replace(/[\s,]/g, '')) : text;
        }
        const raw = rawValue(c, row);
        if (raw === null || raw === undefined) return '';
        if (typeof raw === 'number' || typeof raw === 'string') return raw;
        return String(raw);
      },
    }));
}
