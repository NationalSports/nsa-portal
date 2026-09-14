// Checkout money a webstore batch carries on its Sales Order.
//
// finalize_webstore_batch (supabase/migrations/20260914120000_webstore_batch_invoice_tax_and_fees.sql)
// derives these from the batched orders and writes them onto the SO's store money
// columns — the same columns OMG stores use:
//   _omg_processing  online processing fee charged to buyers   → revenue
//   _omg_tax         sales tax collected for the state          → pass-through, never margin
//   _omg_shipping    shipping charged at checkout               → shipping revenue
//   _omg_cc_fees     Stripe's cut on the card orders            → cost
// Both order editors (header totals, Costs tab, print + email PDF) and calcGP
// (commissions) read them through here so the copies can't drift. Only SOs created
// by the webstore batcher (source = 'webstore') qualify; OMG SOs keep their own
// historical booking untouched.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export const isWebstoreBatchSO = (o) => !!o && o.source === 'webstore';

export function webstoreCheckoutMoney(o) {
  if (!isWebstoreBatchSO(o)) return { isWebstore: false, processing: 0, tax: 0, shipping: 0, ccFees: 0 };
  return {
    isWebstore: true,
    processing: Math.max(0, num(o._omg_processing)),
    tax: Math.max(0, num(o._omg_tax)),
    shipping: Math.max(0, num(o._omg_shipping)),
    ccFees: Math.max(0, num(o._omg_cc_fees)),
  };
}

// Totals-block rows for the SO print / email PDF (the 5-column Quantity/SKU/Item/
// Rate/Amount table) and the amount they add to the document total. `fmt` is the
// builder's money formatter.
export function webstoreDocMoneyRows(o, fmt) {
  const m = webstoreCheckoutMoney(o);
  const row = (label, amt) => ({ cells: [
    { value: '', style: 'border:none' }, { value: '', style: 'border:none' }, { value: '', style: 'border:none' },
    { value: '<strong>' + label + '</strong>', style: 'text-align:right;border:none' },
    { value: fmt(amt), style: 'text-align:right;border:none' },
  ] });
  const rows = [];
  if (m.shipping > 0) rows.push(row('Shipping (charged at checkout)', m.shipping));
  if (m.processing > 0) rows.push(row('Online processing fee', m.processing));
  if (m.tax > 0) rows.push(row('Sales tax (collected at checkout)', m.tax));
  return { rows, extra: Math.round((m.shipping + m.processing + m.tax) * 100) / 100 };
}
