import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS } from '@moto/shared';
import type { Sale } from '@moto/shared';
import type { PosAdapter } from '../adapter';
import { PosLocaleContext } from '../i18n';
import { SalesDialog } from './SalesDialog';

afterEach(cleanup);
const sale = (index: number): Sale => ({
  id: `s${index}`, invoiceNumber: `INV-${index}`, date: '2026-10-12T09:00:00.000Z', branchId: 'br-1',
  customerId: null, items: [{ id: 'i1', name: { ar: 'فلتر', en: `Filter ${index}` }, quantity: 1, unitPrice: 10, discount: 0 }],
  total: 10, paid: 10, remaining: 0, type: 'cash', status: 'completed',
} as Sale);
function show(adapter: PosAdapter) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PosLocaleContext.Provider value="en"><SalesDialog open onOpenChange={() => undefined} adapter={adapter} settings={DEFAULT_SETTINGS} customers={[]} /></PosLocaleContext.Provider></QueryClientProvider>);
}

it('lets the cashier browse and inspect invoices older than 100, then search the entire history', async () => {
  const all = Array.from({ length: 101 }, (_, index) => sale(101 - index));
  const history = vi.fn<NonNullable<PosAdapter['salesHistory']>>(async ({ page = 1, pageSize = 100, search = '' }) => {
    const matches = all.filter(s => !search || s.items[0]!.name.en === search);
    return { data: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize };
  });
  show({ branchId: 'br-1', terminalCode: 'T001', salesHistory: history } as unknown as PosAdapter);
  await screen.findByRole('button', { name: 'INV-101' });
  expect(screen.queryByRole('button', { name: 'INV-1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.click(await screen.findByRole('button', { name: 'INV-1' }));
  expect(screen.getByLabelText('Invoice details').textContent).toContain('Filter 1');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search by invoice, customer or product' }), { target: { value: 'Filter 1' } });
  await waitFor(() => expect(history).toHaveBeenLastCalledWith({ page: 1, pageSize: 100, search: 'Filter 1' }));
  await screen.findByRole('button', { name: 'INV-1' });
  expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Invoice details')).toBeNull();
});

it('keeps recent-sales adapters usable when paginated history is unavailable', async () => {
  show({ branchId: 'br-1', recentSales: async () => [sale(1)] } as unknown as PosAdapter);
  await screen.findByRole('button', { name: 'INV-1' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Search by invoice, customer or product' }), { target: { value: 'missing' } });
  await screen.findByText('No matching sales');
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});
