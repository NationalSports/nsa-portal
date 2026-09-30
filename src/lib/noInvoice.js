// "No invoice needed" on a sales order.
//
// The Ready-to-invoice report (Reports → Finance → My Receivables) lists every
// complete order whose portal invoices do not cover its total, and seeds a rep
// TODO for each. Some orders are legitimately never invoiced from the portal:
// billed in NetSuite, collected by an OMG store, a free replacement or sample.
// This flag lets a rep say so once, with a reason, so the order leaves the
// report and the TODO list instead of sitting there forever.
//
// Shared by both order editors (classic and redesign) so the rule lives once.

export const CREATED_IN_ERROR_REASON = 'Created in error';

export const NO_INVOICE_REASONS = [
  'Invoiced in NetSuite',
  'Collected by OMG / webstore',
  'Free replacement or sample',
  CREATED_IN_ERROR_REASON,
  'Other',
];

// Mark THIS order as not needing a portal invoice. A reason is required; an
// order marked with no justification is worse than one left on the list.
export function applyNoInvoice(order, { reason, by, at } = {}) {
  const clean = String(reason || '').trim();
  if (!clean) return order;
  return {
    ...order,
    no_invoice_needed: true,
    no_invoice_reason: clean,
    no_invoice_by: String(by || '').trim() || null,
    no_invoice_at: at || new Date().toISOString(),
  };
}

// Close a sales order that was created by mistake: no invoice, and it leaves every
// open-order list (status 'complete'). It still counts in sales totals — the order
// existed — so it is a close, not a delete. An optional note says what went wrong.
export function closeCreatedInError(order, { note, by, at } = {}) {
  const extra = String(note || '').trim();
  const reason = extra ? `${CREATED_IN_ERROR_REASON} — ${extra}` : CREATED_IN_ERROR_REASON;
  return { ...applyNoInvoice(order, { reason, by, at }), status: 'complete' };
}

// Put the order back on the invoice list. Clears the whole stamp so a stale
// reason cannot sit on an order that is once again waiting to be billed.
export function clearNoInvoice(order) {
  return { ...order, no_invoice_needed: false, no_invoice_reason: null, no_invoice_by: null, no_invoice_at: null };
}

export const isCreatedInError = (order) =>
  !!(order && order.no_invoice_needed && String(order.no_invoice_reason || '').startsWith(CREATED_IN_ERROR_REASON));

export const noInvoiceLabel = (order) => {
  if (!order || !order.no_invoice_needed) return '';
  const r = String(order.no_invoice_reason || '').trim();
  return r ? `NO INVOICE · ${r}` : 'NO INVOICE';
};
