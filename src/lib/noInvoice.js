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

export const NO_INVOICE_REASONS = [
  'Invoiced in NetSuite',
  'Collected by OMG / webstore',
  'Free replacement or sample',
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

// Put the order back on the invoice list. Clears the whole stamp so a stale
// reason cannot sit on an order that is once again waiting to be billed.
export function clearNoInvoice(order) {
  return { ...order, no_invoice_needed: false, no_invoice_reason: null, no_invoice_by: null, no_invoice_at: null };
}

export const noInvoiceLabel = (order) => {
  if (!order || !order.no_invoice_needed) return '';
  const r = String(order.no_invoice_reason || '').trim();
  return r ? `NO INVOICE · ${r}` : 'NO INVOICE';
};
