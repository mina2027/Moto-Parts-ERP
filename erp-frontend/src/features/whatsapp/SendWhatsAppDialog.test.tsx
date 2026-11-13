import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DEFAULT_SETTINGS } from '@moto/shared';
import type { Customer } from '@/types';
import { toast } from 'sonner';
import { SendWhatsAppDialog } from './SendWhatsAppDialog';

const mocks = vi.hoisted(() => ({ send: vi.fn(), stats: vi.fn(), templates: vi.fn() }));
vi.mock('@/services', () => ({
  whatsappService: { send: mocks.send, stats: mocks.stats, templates: mocks.templates },
  customerService: { debts: async () => ({ data: [] }) },
}));
vi.mock('@/hooks/useSettings', () => ({ useSettings: () => ({ settings: DEFAULT_SETTINGS }) }));
vi.mock('@/hooks/useLookups', () => ({ useLookups: () => ({ options: { customers: [] }, customers: [] }) }));
vi.mock('@/stores/authStore', () => ({ useAuthStore: (selector: (state: unknown) => unknown) => selector({ session: { user: { id: 'u1' } } }) }));
vi.mock('@/i18n', () => ({ useT: () => ({ t: (key: string) => key, tx: (value: { ar: string }) => value?.ar ?? '', locale: 'en' }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const customer = { id: 'c1', name: { ar: 'Customer' }, whatsapp: '201000000000', balance: 0 } as Customer;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stats.mockResolvedValue({ mode: 'web' });
  mocks.templates.mockResolvedValue([{ key: 'statement', name: { ar: 'Statement' }, body: { ar: 'Hello {customer}' }, isActive: true }]);
});
afterEach(cleanup);
async function mount() {
  const close = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SendWhatsAppDialog open onOpenChange={close} customer={customer} /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'whatsapp.openWhatsapp' })).toBeEnabled());
  return close;
}
describe('WhatsApp send outcomes', () => {
  it('uses the customer page paginated debt cache while closed and when reopened', async () => {
    mocks.templates.mockResolvedValue([{ key: 'statement', name: { ar: 'Statement' }, body: { ar: 'Hello {customer} {invoice} {remaining}' }, isActive: true }]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const key = ['debts', { customerId: customer.id }];
    const cached = { data: [{ id: 'debt-1', customerId: customer.id, invoiceNumber: 'INV-CACHED', originalAmount: 100, paidAmount: 70, remaining: 30, dueDate: '2026-10-01' }], total: 1, page: 1, pageSize: 100 };
    queryClient.setQueryData(key, cached);
    const dialog = (open: boolean) => <QueryClientProvider client={queryClient}><SendWhatsAppDialog open={open} onOpenChange={vi.fn()} customer={customer} /></QueryClientProvider>;
    const { rerender } = render(dialog(false));
    await waitFor(() => expect(queryClient.getQueryData(['whatsapp', 'templates'])).toBeDefined());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    rerender(dialog(true));
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toContain('INV-CACHED'));
    expect(queryClient.getQueryData(key)).toEqual(cached);
  });

  it('keeps a failed message open and reports its error', async () => {
    mocks.send.mockResolvedValue({ status: 'failed', error: 'Provider unavailable' });
    const close = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'whatsapp.openWhatsapp' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Provider unavailable'));
    expect(toast.success).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it('reports preparation and opens the manual link without claiming delivery', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.send.mockResolvedValue({ status: 'prepared', link: 'https://wa.me/201000000000' });
    const close = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'whatsapp.openWhatsapp' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('whatsapp.messagePrepared'));
    expect(open).toHaveBeenCalledWith('https://wa.me/201000000000', '_blank', 'noopener');
    expect(close).toHaveBeenCalledWith(false);
    open.mockRestore();
  });
});
