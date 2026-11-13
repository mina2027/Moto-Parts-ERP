import * as React from 'react';
import { Barcode, QrCode } from '@moto/ui';
import { CalendarClock, Coins, CreditCard, FileText, HandCoins, MapPin, Monitor, Phone, ShieldCheck, Store, UserRound, Wallet } from 'lucide-react';
import { usePosT } from '../i18n';
import { FONT_FACE_CSS, GearLogo, INK, INVOICE_FONT_STACK, MONOCHROME_IMAGE_CSS, Moto, PAPER, scaler } from './invoiceTheme';
import { computeInvoiceTotals, formatAmount, formatCurrency, formatInvoiceDate, type Invoice, type StoreProfile } from './invoiceModel';

export interface SalesInvoiceThermalProps {
  invoice: Invoice;
  store: StoreProfile;
  /** Legacy prop retained for callers; all invoice details are always included. */
  compact?: boolean;
}

const sheet = (primary: string, accent: string) => {
  const { px, mm } = scaler(1);
  const pad = 3.5;
  return `${FONT_FACE_CSS}
.mpt, .mpt * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.mpt { position: relative; width: 80mm; min-height: 30mm; max-width: none; background: #fff; color: ${INK}; filter: grayscale(1); overflow: visible; overflow-wrap: anywhere;
  font-family: ${INVOICE_FONT_STACK}; font-size: ${px(11)}; line-height: 1.4;
  display: flex; flex-direction: column; gap: ${mm(1.6)}; padding-bottom: ${mm(3)}; text-align: start; }
.mpt svg { display: inline-block; vertical-align: middle; flex-shrink: 0; }
.mpt img { display: block; filter: grayscale(1) contrast(1.15); ${MONOCHROME_IMAGE_CSS} }
.mpt * { min-width: 0; max-width: 100%; }
.mpt [role="img"] > svg { display: block; width: 100%; height: 100%; }
.mpt h1, .mpt h4, .mpt ul, .mpt p { margin: 0; padding: 0; }
.mpt-num { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
.mpt-table td.item, .mpt-warranty li { unicode-bidi: plaintext; }
.mpt-pad { padding-inline: ${pad}mm; }

.mpt-head { background: #fff; color: ${INK}; padding: ${mm(2.5)} ${pad}mm ${mm(2.2)}; display: flex; flex-direction: column; align-items: center; gap: ${mm(1)}; text-align: center; }
.mpt-logo { width: ${mm(13)}; height: ${mm(13)}; }
.mpt-logo img { width: 100%; height: 100%; object-fit: contain; }
.mpt-name { font-size: ${px(19)}; font-weight: 900; line-height: 1.1; letter-spacing: ${px(-0.2)}; }
.mpt-subtitle { font-size: ${px(10.5)}; font-weight: 700; }
.mpt-tagline { font-size: ${px(9.5)}; font-weight: 700; color: ${INK}; letter-spacing: ${px(0.2)}; }

.mpt-contact { display: flex; flex-direction: column; align-items: center; gap: ${mm(0.5)}; text-align: center; font-size: ${px(10)}; font-weight: 700; }
.mpt-contact .grp { display: inline-flex; align-items: center; gap: ${mm(1.2)}; }
.mpt-contact .tax { font-size: ${px(9)}; font-weight: 600; color: ${INK}; }

.mpt-brands { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: ${mm(1)} ${mm(2.2)}; direction: ltr;
  border-top: 1px solid ${INK}; border-bottom: 1px solid ${INK}; padding: ${mm(1)} ${pad}mm; }
.mpt-brand-item { font-family: 'Arial Black', 'Segoe UI', Arial, sans-serif; font-weight: 900; font-style: italic; font-size: ${px(9.5)}; letter-spacing: ${px(0.3)}; }
.mpt-brand-item img { height: ${mm(4)}; width: auto; }
.mpt-slogan { width: 100%; direction: inherit; text-align: center; font-weight: 800; }

.mpt-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: ${mm(2)}; background: ${INK}; color: #fff; padding: ${mm(1.2)} ${pad}mm; }
.mpt-banner .ttl { display: inline-flex; align-items: center; gap: ${mm(1.5)}; font-size: ${px(13.5)}; font-weight: 900; }
.mpt-banner .no { background: #fff; color: ${INK}; border-radius: ${px(5)}; padding: ${mm(0.5)} ${mm(2)}; font-size: ${px(12.5)}; font-weight: 900; }
.mpt-banner .no small { display: block; font-size: ${px(9)}; }

.mpt-rows { display: flex; flex-direction: column; gap: ${mm(0.8)}; }
.mpt-row { display: flex; align-items: center; justify-content: space-between; gap: ${mm(2)}; background: #fff; border-radius: ${px(5)}; padding: ${mm(0.8)} ${mm(2)}; }
.mpt-row .lbl { display: inline-flex; flex: 0 1 45%; align-items: center; gap: ${mm(1.2)}; color: ${INK}; font-weight: 700; }
.mpt-row .val { flex: 1 1 0; font-weight: 800; text-align: end; }

.mpt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.mpt-table thead { display: table-header-group; }
.mpt-table th { background: ${INK}; color: #fff; font-weight: 800; font-size: ${px(10)}; padding: ${mm(1)} ${mm(0.8)}; text-align: center; line-height: 1.2; border-inline: 1px solid #fff; }
.mpt-table th.item { text-align: start; padding-inline-start: ${mm(1.5)}; }
.mpt-table th small { display: block; font-size: ${px(8)}; }
.mpt-table td { padding: ${mm(0.9)} ${mm(0.8)}; text-align: center; font-weight: 700; font-size: ${px(10.5)}; border-top: 1px solid ${INK}; border-inline: 1px solid ${INK}; vertical-align: top; }
.mpt-table tbody tr:nth-child(even) td { background: #fff; }
.mpt-table tr { break-inside: avoid; page-break-inside: avoid; }
.mpt-table td.idx { color: ${INK}; font-weight: 900; }
.mpt-table td.item { text-align: start; padding-inline-start: ${mm(1.5)}; }
.mpt-table td.item .note { display: block; font-size: ${px(9)}; color: ${INK}; font-weight: 600; }
.mpt-table td.item .note.disc { color: ${INK}; }
.mpt-table td.total { font-weight: 900; color: ${INK}; }
.mpt-empty td { height: ${mm(8)}; color: ${INK}; }

.mpt-totals { display: flex; flex-direction: column; gap: ${mm(0.3)}; }
.mpt-trow { display: flex; gap: ${mm(2)}; justify-content: space-between; align-items: center; font-size: ${px(11)}; font-weight: 700; padding: ${mm(0.3)} ${mm(1)}; }
.mpt-trow .val { font-weight: 900; }
.mpt-trow.disc .val { color: ${INK}; }
.mpt-grand { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: ${mm(2)}; margin-top: ${mm(0.8)}; background: ${INK}; color: #fff; border-radius: ${px(6)}; padding: ${mm(1.3)} ${mm(2.5)}; }
.mpt-grand .lbl { display: inline-flex; align-items: center; gap: ${mm(1.2)}; font-size: ${px(12)}; font-weight: 900; }
.mpt-grand .val { font-size: ${px(15)}; font-weight: 900; }

.mpt-codes { display: flex; flex-direction: column; align-items: center; gap: ${mm(0.8)}; text-align: center; color: #000; }
.mpt-codes .cap { font-size: ${px(9)}; font-weight: 700; color: ${INK}; }
.mpt-codes .bc-no { font-family: 'Segoe UI', Arial, sans-serif; font-weight: 700; font-size: ${px(10)}; letter-spacing: ${px(0.8)}; }

.mpt-warranty h4 { display: flex; align-items: center; gap: ${mm(1.2)}; margin-bottom: ${mm(0.8)}; color: ${INK}; font-size: ${px(10.5)}; font-weight: 900; }
.mpt-warranty ul { list-style: none; display: flex; flex-direction: column; gap: ${mm(0.5)}; }
.mpt-warranty li { position: relative; padding-inline-start: ${mm(3)}; font-size: ${px(9)}; font-weight: 600; }
.mpt-warranty li::before { content: ''; position: absolute; inset-inline-start: ${mm(0.6)}; top: .62em; width: ${mm(1.2)}; height: ${mm(1.2)}; border-radius: 50%; background: ${INK}; }

.mpt-sign { display: flex; flex-direction: column; align-items: center; gap: ${mm(1.2)}; break-inside: avoid; }
.mpt-stamp { position: relative; width: ${mm(22)}; min-height: ${mm(22)}; border-radius: 50%; border: 1.4px solid ${INK}; box-shadow: inset 0 0 0 ${mm(0.9)} #fff, inset 0 0 0 ${mm(1.2)} ${INK};
  color: ${INK}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; transform: rotate(-7deg); padding: ${mm(2)}; }
.mpt-stamp .s-name { font-size: ${px(10)}; font-weight: 900; line-height: 1.1; }
.mpt-stamp .s-sub { max-width: ${mm(16)}; font-size: ${px(5.5)}; font-weight: 700; line-height: 1.2; }
.mpt-stamp .s-addr { max-width: ${mm(16)}; font-size: ${px(5.5)}; font-weight: 600; line-height: 1.3; border-top: 1px solid ${INK}; margin-top: ${mm(0.5)}; padding-top: ${mm(0.4)}; }
.mpt-stamp .s-star { font-size: ${px(7)}; line-height: 1; margin-top: ${mm(0.3)}; }
.mpt-reviewed { border: 1.6px solid ${INK}; outline: 1px solid ${INK}; outline-offset: 1px; color: ${INK}; border-radius: ${px(4)}; padding: ${mm(0.2)} ${mm(3)}; font-size: ${px(11)}; font-weight: 900; transform: rotate(-4deg); }
.mpt-sign-box { width: 100%; }
.mpt-sign-box h5 { margin: 0 0 ${mm(0.6)}; font-size: ${px(10)}; font-weight: 900; color: ${INK}; }
.mpt-sign-area { min-height: ${mm(7)}; border-bottom: 1.2px dashed ${INK}; display: flex; align-items: center; justify-content: center; padding-block: ${mm(1)}; }
.mpt-sign-line { display: flex; gap: ${mm(2)}; font-size: ${px(9)}; font-weight: 600; margin-top: ${mm(0.8)}; }
.mpt-sign-line .dots { flex: 1; border-bottom: 1px dotted ${INK}; min-height: ${mm(3)}; }

.mpt-bar { background: ${INK}; color: #fff; padding: ${mm(1.6)} ${pad}mm; display: flex; flex-direction: column; align-items: center; gap: ${mm(0.6)}; text-align: center; break-inside: avoid; }
.mpt-bar .thanks { display: flex; align-items: center; gap: ${mm(2)}; font-size: ${px(12.5)}; font-weight: 900; }
.mpt-bar .thanks::before, .mpt-bar .thanks::after { content: ''; width: ${mm(5)}; height: 1.2px; background: ${PAPER}; }
.mpt-bar .addr { font-size: ${px(9.5)}; font-weight: 700; }
@media print { .mpt { width: 80mm; margin: 0; box-shadow: none; } }
`.replaceAll(INK, primary).replaceAll(PAPER, '#fff').replaceAll('#2F5FA7', accent);
};

/** Complete sales invoice laid out in one column for an 80mm thermal roll. */
export const SalesInvoiceThermal = React.forwardRef<HTMLDivElement, SalesInvoiceThermalProps>(function SalesInvoiceThermal(
  { invoice, store },
  ref,
) {
  const { p, locale, dir } = usePosT();
  const L = p.invoiceA4;
  const css = React.useMemo(() => sheet('#000000', '#000000'), []);
  const { ic, n: sz } = scaler(1);
  const totals = React.useMemo(() => computeInvoiceTotals(invoice), [invoice]);
  const dec = invoice.currency.decimals ?? 2;
  const n = (v: number) => formatAmount(v, dec);
  const m = (v: number) => formatCurrency(v, invoice.currency);
  const when = formatInvoiceDate(invoice.issuedAt, locale);
  const sym = invoice.currency.symbol;
  const [first, ...rest] = store.name.trim().split(/\s+/);
  const taxPct = Math.round(invoice.taxRate * 10000) / 100;

  return (
    <div ref={ref} dir={dir} lang={locale} className="mpt receipt invoice">
      <style>{css}</style>
      <header className="mpt-head">
        <div className="mpt-logo">{store.logoUrl ? <img src={store.logoUrl} alt="" /> : <GearLogo ring="#000000" hub="#000000" />}</div>
        <h1 className="mpt-name">{first} {rest.join(' ')}</h1>
        <div className="mpt-subtitle">{store.subtitle}</div>
        <div className="mpt-tagline">{store.tagline}</div>
      </header>

      <div className="mpt-contact mpt-pad">
        {store.phones.length ? (
          <span className="grp mpt-num"><Phone size={ic(11)} strokeWidth={2.4} /> {store.phones.join('  |  ')}</span>
        ) : null}
        <span className="grp"><MapPin size={ic(11)} strokeWidth={2.2} /> {store.address}</span>
        {store.taxNumber ? <span className="tax">{L.taxNo}: <span className="mpt-num">{store.taxNumber}</span></span> : null}
      </div>

      {store.brandLogos.length || store.slogan ? (
        <div className="mpt-brands">
          {store.brandLogos.map((b) => (
            <span key={b.name} className="mpt-brand-item" style={{ color: '#000000' }}>
              {b.logoUrl ? <img src={b.logoUrl} alt={b.name} /> : b.name}
            </span>
          ))}
          {store.slogan ? <span className="mpt-slogan" dir={dir}>{store.slogan}</span> : null}
        </div>
      ) : null}

      <div className="mpt-banner">
        <span className="ttl"><FileText size={ic(15)} strokeWidth={2} /> {L.title}</span>
        <span className="no"><small>{L.invoiceNo}</small><span className="mpt-num">{invoice.number}</span></span>
      </div>

      <div className="mpt-rows mpt-pad">
        <div className="mpt-row">
          <span className="lbl"><CalendarClock size={ic(12)} /> {L.dateTime}</span>
          <span className="val"><span className="mpt-num">{when.date}</span>&nbsp;<span className="mpt-num">{when.time}</span></span>
        </div>
        <div className="mpt-row"><span className="lbl"><UserRound size={ic(12)} /> {L.customerName}</span><span className="val">{invoice.customer.name}</span></div>
        <div className="mpt-row"><span className="lbl">{L.saleType}</span><span className="val">{invoice.customer.saleType === 'credit' ? p.credit : p.cash}</span></div>
        {invoice.customer.balance !== undefined ? (
          <div className="mpt-row"><span className="lbl"><Coins size={ic(12)} /> {L.balance}</span><span className="val mpt-num">{m(invoice.customer.balance)}</span></div>
        ) : null}
        <div className="mpt-row"><span className="lbl"><Store size={ic(12)} /> {L.branch}</span><span className="val">{invoice.branch}</span></div>
        {invoice.cashier ? <div className="mpt-row"><span className="lbl"><UserRound size={ic(12)} /> {L.cashier}</span><span className="val">{invoice.cashier}</span></div> : null}
        {invoice.terminal ? <div className="mpt-row"><span className="lbl"><Monitor size={ic(12)} /> {p.receipt.terminal}</span><span className="val mpt-num">{invoice.terminal}</span></div> : null}
      </div>

      <table className="mpt-table">
        <colgroup>
          <col style={{ width: '8%' }} />
          <col style={{ width: '46%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          {/* Short receipt labels — the A4 wording wraps to two lines on a 58mm roll. */}
          <tr>
            <th>{L.index}</th>
            <th className="item">{p.receipt.item}</th>
            <th>{p.receipt.qty}</th>
            <th>{p.receipt.price}<small>({sym})</small></th>
            <th>{p.receipt.total}<small>({sym})</small></th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.length ? (
            invoice.items.map((it, i) => (
              <tr key={i}>
                <td className="idx mpt-num">{i + 1}</td>
                <td className="item">
                  {it.name}
                  {it.note ? <span className="note">{it.note}</span> : null}
                  <span className={it.discount > 0 ? 'note disc' : 'note'}>{L.discount}: <span className="mpt-num">{it.discount > 0 ? '-' : ''}{n(it.discount)} {sym}</span></span>
                </td>
                <td className="mpt-num">{it.qty}</td>
                <td className="mpt-num">{n(it.unitPrice)}</td>
                <td className="total mpt-num">{n(totals.lineTotals[i] ?? 0)}</td>
              </tr>
            ))
          ) : (
            <tr className="mpt-empty"><td colSpan={5}>—</td></tr>
          )}
        </tbody>
      </table>

      <div className="mpt-totals mpt-pad">
        <div className="mpt-trow"><span>{L.subtotal}</span><span className="val mpt-num">{m(totals.subtotal)}</span></div>
        <div className={totals.invoiceDiscount > 0 ? 'mpt-trow disc' : 'mpt-trow'}><span>{L.invoiceDiscount}</span><span className="val mpt-num">{totals.invoiceDiscount > 0 ? '-' : ''}{m(totals.invoiceDiscount)}</span></div>
        {invoice.taxRate > 0 ? (
          <div className="mpt-trow"><span>{L.tax} (<span className="mpt-num">{taxPct}%</span>)</span><span className="val mpt-num">{m(totals.tax)}</span></div>
        ) : null}
        <div className="mpt-grand"><span className="lbl"><Coins size={ic(14)} /> {L.grandTotal}</span><span className="val mpt-num">{m(totals.grandTotal)}</span></div>
      </div>

      <div className="mpt-rows mpt-pad">
        <div className="mpt-row"><span className="lbl"><Wallet size={ic(12)} /> {L.paid}</span><span className="val mpt-num">{m(totals.paid)}</span></div>
        {totals.change > 0 ? (
          <div className="mpt-row"><span className="lbl"><HandCoins size={ic(12)} /> {L.change}</span><span className="val mpt-num">{m(totals.change)}</span></div>
        ) : (
          <div className="mpt-row"><span className="lbl"><HandCoins size={ic(12)} /> {L.remaining}</span><span className="val mpt-num">{m(totals.remaining)}</span></div>
        )}
        <div className="mpt-row"><span className="lbl"><CreditCard size={ic(12)} /> {L.paymentMethod}</span><span className="val">{invoice.paymentMethod}</span></div>
      </div>

      {invoice.notes ? <section className="mpt-notes mpt-pad" style={{ borderTop: '1px solid', paddingTop: '2mm', paddingBottom: '2mm', breakInside: 'avoid' }}>
        <h4 style={{ margin: '0 0 1mm', fontWeight: 700 }}>{p.notes}</h4>
        <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{invoice.notes}</div>
      </section> : null}

      {invoice.showBarcode !== false || invoice.qrUrl ? (
        <div className="mpt-codes mpt-pad">
          {invoice.showBarcode !== false ? (
            <>
              <Barcode value={invoice.number} height={sz(30)} barWidth={1.1} showText={false} />
              <div className="bc-no mpt-num">{invoice.number}</div>
            </>
          ) : null}
          {invoice.qrUrl ? (
            <>
              <QrCode value={invoice.qrUrl} size={ic(88)} />
              <div className="cap">{L.scanQr}</div>
            </>
          ) : null}
        </div>
      ) : null}

      {store.warrantyNotes.length ? (
        <div className="mpt-warranty mpt-pad">
          <h4><ShieldCheck size={ic(13)} /> {L.warrantyTitle}</h4>
          <ul>
            {store.warrantyNotes.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      ) : null}

      <div className="mpt-sign mpt-pad">
        {invoice.stamped === false ? null : (
          <div className="mpt-stamp" aria-hidden>
            <div style={{ width: `${sz(7)}mm`, height: `${sz(4.5)}mm`, color: INK }}><Moto /></div>
            <div className="s-name">{store.name}</div>
            <div className="s-sub">{store.subtitle}</div>
            <div className="s-addr">{store.address}</div>
            <div className="s-star">★</div>
          </div>
        )}
        <div className="mpt-sign-box">
          <h5>{L.reviewerSignature}</h5>
          <div className="mpt-sign-area">{invoice.reviewed ? <span className="mpt-reviewed">{L.reviewed}</span> : null}</div>
          <div className="mpt-sign-line"><span>{L.name}:</span><span className="dots" /></div>
          <div className="mpt-sign-line"><span>{L.date}:</span><span className="dots mpt-num">{when.date}</span></div>
        </div>
      </div>

      <footer className="mpt-bar">
        <span className="thanks">{store.thanks}</span>
        <span className="addr">{store.address}</span>
        {store.phones.length ? <span className="addr mpt-num">{store.phones.join('  |  ')}</span> : null}
      </footer>
    </div>
  );
});
