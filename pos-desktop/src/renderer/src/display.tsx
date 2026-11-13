import React from 'react';
import ReactDOM from 'react-dom/client';
import { cartTotals, PosLocaleContext, usePosT } from '@moto/pos-core';
import type { CurrencySettings, Locale } from '@moto/shared';
import { DEFAULT_SETTINGS, round2, saleLineDiscount, tx } from '@moto/shared';
import type { DisplayState } from '../../shared/display';
import './index.css';

function CustomerDisplay() {
  const { p, tx: t, locale } = usePosT();
  const [state, setState] = React.useState<DisplayState>({ lines: [], invoiceDiscount: 0, customer: null, lastSaleId: null });
  const [company, setCompany] = React.useState('');
  const [currency, setCurrency] = React.useState<CurrencySettings>(DEFAULT_SETTINGS.currency);
  React.useEffect(() => {
    void window.posDisplay.settings().then((s) => {
      setCompany(tx(s.company.name, locale));
      setCurrency(s.currency);
    });
    return window.posDisplay.onState(setState);
  }, [locale]);
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
    <div className="flex h-full flex-col bg-slate-950 p-8 text-white" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
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

// The display window is a separate root, so it reads the locale the main window persisted.
const locale = ((localStorage.getItem('locale') as Locale) || 'ar') satisfies Locale;
document.documentElement.setAttribute('dir', locale === 'ar' ? 'rtl' : 'ltr');
document.documentElement.setAttribute('lang', locale);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <PosLocaleContext.Provider value={locale}>
    <CustomerDisplay />
  </PosLocaleContext.Provider>,
);
