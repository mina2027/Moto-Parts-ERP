import React from 'react';
import { PosLocaleContext, cartTotals, usePosT } from '@moto/pos-core';
import { DEFAULT_SETTINGS, round2, saleLineDiscount, tx } from '@moto/shared';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';
import { displayChannelName, type DisplaySnapshot } from './customerDisplay';

function CustomerDisplay({ state }: { state: DisplaySnapshot }) {
  const { p, tx: t, locale } = usePosT();
  const company = tx(state.settings.company.name, locale);
  const currency = state.settings.currency;
  const fmt = React.useCallback(
    (v: number) => {
      const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: currency.decimals, maximumFractionDigits: currency.decimals }).format(v);
      const symbol = tx(currency.symbol, locale);
      return currency.symbolPosition === 'before' ? `${symbol} ${n}` : `${n} ${symbol}`;
    },
    [currency, locale],
  );
  const totals = cartTotals(state.lines, state.invoiceDiscount);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950 p-8 text-white" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="flex items-center justify-between border-b border-white/10 pb-4">
        <h1 className="text-3xl font-bold">{company}</h1>
        {state.customer ? <span className="text-xl text-white/70">{t(state.customer.name)}</span> : null}
      </div>
      {state.lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-5xl font-bold">{p.display.welcome}</div>
          <div className="mt-3 text-2xl text-white/60">{state.lastSaleId ? p.display.thanks : p.display.haveANiceDay}</div>
        </div>
      ) : (
        <>
          <div className="mt-4 flex-1 overflow-hidden">
            <table className="w-full text-2xl">
              <tbody>
                {state.lines.slice(-10).map((l) => (
                  <tr key={l.productId} className="border-b border-white/10">
                    <td className="py-3">{t(l.name)}</td>
                    <td className="py-3 text-center num text-white/70">{l.quantity} × {fmt(l.unitPrice)}</td>
                    <td className="py-3 text-end num font-semibold">{fmt(round2(l.unitPrice * l.quantity - saleLineDiscount(l)))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 border-t border-white/20 pt-4">
            {totals.itemDiscounts > 0 ? <div className="flex justify-between text-xl text-white/70"><span>{p.itemDiscount}</span><span className="num">−{fmt(totals.itemDiscounts)}</span></div> : null}
            {state.invoiceDiscount > 0 ? <div className="flex justify-between text-xl text-white/70"><span>{p.invoiceDiscount}</span><span className="num">−{fmt(state.invoiceDiscount)}</span></div> : null}
            <div className="flex items-baseline justify-between"><span className="text-3xl">{p.total}</span><span className="text-6xl font-bold num">{fmt(totals.total)}</span></div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CustomerDisplayPage() {
  const user = useAuthStore((s) => s.session!.user);
  const locale = useUiStore((s) => s.locale);
  const [state, setState] = React.useState<DisplaySnapshot>({ lines: [], invoiceDiscount: 0, customer: null, lastSaleId: null, settings: DEFAULT_SETTINGS, locale });
  React.useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(displayChannelName(user.id, user.branchId));
    channel.onmessage = (event) => {
      if (event.data?.type === 'state') setState(event.data.snapshot as DisplaySnapshot);
    };
    channel.postMessage({ type: 'ready' });
    return () => channel.close();
  }, [user.id, user.branchId]);
  return <PosLocaleContext.Provider value={state.locale}><CustomerDisplay state={state} /></PosLocaleContext.Provider>;
}
