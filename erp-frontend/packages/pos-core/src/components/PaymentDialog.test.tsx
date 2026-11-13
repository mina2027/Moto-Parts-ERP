import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_SETTINGS, type Customer } from '@moto/shared';
import { PosLocaleContext } from '../i18n';
import { PaymentDialog } from './PaymentDialog';
afterEach(cleanup);
const customer: Customer = { id: 'c1', code: 'C1', name: { ar: 'عميل' }, phone: '', whatsapp: '', address: { ar: '' }, type: 'retail', creditLimit: 150, balance: 0, branchId: 'br1', isActive: true, createdAt: '' };
function show(props: Partial<React.ComponentProps<typeof PaymentDialog>> = {}) {
  const onConfirm = vi.fn();
  render(<PosLocaleContext.Provider value="en"><PaymentDialog open onOpenChange={() => undefined} total={100} settings={DEFAULT_SETTINGS} onConfirm={onConfirm} {...props} /></PosLocaleContext.Provider>);
  return onConfirm;
}
it('blocks card overpayment and keeps valid cash change available', () => {
  const confirm = show();
  fireEvent.click(screen.getByRole('button', { name: /^Card$/i }));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Cash$/i }));
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).toHaveBeenCalledTimes(1);
});
it('requires full payment for a cash sale', () => {
  const confirm = show();
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).not.toHaveBeenCalled();
});
it('accepts a credit sale with no upfront payment or with a partial payment', () => {
  const confirm = show({ saleType: 'credit', customer });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).toHaveBeenLastCalledWith([], 'small');
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).toHaveBeenLastCalledWith([{ method: 'cash', amount: 30 }], 'small');
});
it('blocks credit sales without a customer', () => {
  const confirm = show({ saleType: 'credit' });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).not.toHaveBeenCalled();
});
it('checks the cumulative credit limit against the outstanding amount', () => {
  const confirm = show({ saleType: 'credit', customer: { ...customer, balance: 100 } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '50' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).toHaveBeenCalledOnce();
});
it('rejects credit overpayments even when paid in cash', () => {
  const confirm = show({ saleType: 'credit', customer });
  fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
  fireEvent.click(screen.getByRole('button', { name: /complete|confirm/i }));
  expect(confirm).not.toHaveBeenCalled();
});
