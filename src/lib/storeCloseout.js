export const isStoreSalesOrder = so => !!(so?.omg_store_id || so?.webstore_id);
export const isStoreFinanciallyClosed = so => !!(so?.store_closed_at && so?.store_costs_recorded_at);
export function storeCommissionReady(invoice, so) {
  // Fail closed if the invoice identifies a store but its SO has not hydrated.
  const store = isStoreSalesOrder(so) || /^(omg|webstore):/.test(invoice?.idempotency_key || '');
  return !store || isStoreFinanciallyClosed(so);
}

// When the closeout gate above went live (PR #2514 merged to main). Before it, a paid
// store invoice counted on the statement for the month it was paid — and those months
// were paid out to reps on that basis.
export const STORE_CLOSEOUT_COMMISSION_START = new Date('2026-10-13T05:46:03Z');

// Statement date for a store invoice's commission. Normally the later of the payment
// and the store closeout, so the line earns in the month the store is closed. But an
// invoice that was already paid before the closeout gate existed was already on its
// paid month's statement; moving it to the closeout month would pay the rep for it a
// second time. Those keep their original month (re-paying nothing if it's already paid).
export function storeCommissionPaidDate(paymentDate, so) {
  const closed = so?.store_closed_at ? new Date(so.store_closed_at) : null;
  if (!closed || isNaN(closed.getTime())) return paymentDate;
  if (paymentDate && !isNaN(paymentDate.getTime()) && paymentDate < STORE_CLOSEOUT_COMMISSION_START) return paymentDate;
  return new Date(Math.max(closed.getTime(), paymentDate?.getTime() || 0));
}

// Frozen at closeout from the Accounting Report; WEB card costs are handled separately.
export function omgCloseoutPlatformCost(so) {
  if (!so?.omg_store_id) return 0;
  return Math.max(0, Number(so.store_closeout_platform_cost ?? ((Number(so._omg_omg_fees)||0)+(Number(so._omg_cc_fees)||0))) || 0);
}

// Components stored on the authoritative invoice at Close Store. Legacy invoices
// have no markers and retain their historical commission treatment.
export function omgCloseoutInvoiceMoney(invoice, so) {
  if (!so?.omg_store_id || !invoice?.line_items?.some(l=>l._omg_closeout_component==='product')) return null;
  const sum=kind=>invoice.line_items.filter(l=>l._omg_closeout_component===kind).reduce((n,l)=>n+(Number(l.amount)||0),0);
  return {processing:sum('processing'),fundraise:sum('fundraise'),shipping:Number(invoice.shipping)||0};
}
