// ── Is production still working on this order? ──────────────────────────────────────────
//
// An SO's status='complete' is a FINANCIAL close, but every surface in the portal renders
// it as a FULFILLMENT state: calcSOStatus short-circuits on it ahead of any job state, the
// rep's Orders list prints "Complete", and CoachPortal prints "Delivered" to the customer.
//
// Invoicing ahead of the floor is normal here, so a Final invoice used to close orders whose
// garments had not been decorated — or even received. SO-1985 (8/26/26): Final invoice at
// 18:42:42, status→complete at 18:42:45, while its 15 hats sat In Process on the embroidery
// line three weeks later; production read it correctly on the Prod Board, the rep and the
// coach both read "Complete"/"Delivered". Across prod at the time of this fix, 434 orders
// reached 'complete' straight from waiting_receive and 100 from in_production, against 96
// through ready_to_invoice — the close was tracking billing, not goods.
//
// Callers use this to keep an invoiced-ahead order OUT of the terminal state so it stays on
// the production board and honest on the coach portal, and to name what's outstanding when
// someone closes an order by hand anyway.

// Draft jobs aren't on the board, so they aren't owed work. An order with no jobs at all
// (fully outsourced decoration) has nothing to wait on and closes as it always did.
export const unfinishedProdJobs = (ord) => {
  const jobs = Array.isArray(ord?.jobs) ? ord.jobs : [];
  return jobs.filter((j) => j && j.prod_status !== 'draft' && j.prod_status !== 'completed' && j.prod_status !== 'shipped');
};

const PROD_LABELS = { hold: 'Ready for Prod', ready: 'Ready for Prod', staging: 'In Line', in_process: 'In Process' };

// Human-readable "…still in production" summary for close confirmations. Returns '' when
// production is done, so callers can use it as both the test and the message.
export const unfinishedProdSummary = (ord) => {
  const open = unfinishedProdJobs(ord);
  if (open.length === 0) return '';
  const names = open.slice(0, 4).map((j) => {
    const name = j.art_name || (j.deco_type ? String(j.deco_type).replace(/_/g, ' ') : '') || j.id || 'Job';
    return name + ' — ' + (PROD_LABELS[j.prod_status] || j.prod_status || 'not started');
  });
  return open.length + ' job' + (open.length === 1 ? '' : 's') + ' still in production:\n  • ' + names.join('\n  • ')
    + (open.length > 4 ? '\n  • …and ' + (open.length - 4) + ' more' : '');
};
