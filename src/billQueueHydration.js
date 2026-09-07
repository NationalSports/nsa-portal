// Read-only predicates for the Sports Inc bill queue's auto-capture boundary.
// Automatic outside-portal writes are shared decisions, so they must wait until
// the order book and the customer tags used by the matcher are trustworthy.

const idOf = (value) => String(value == null ? '' : value);

// dbEngine annotates every hydrated Sales Order. `_itemsHydrated` covers the
// parent line load; `_posHydrated` covers PO/deco-PO children. Missing markers
// are intentionally treated as unknown (not hydrated) at this write boundary.
export const isBillQueueHydrated = ({ dbLoading, sos, cust } = {}) => {
  if (dbLoading) return false;
  if (!Array.isArray(sos) || !Array.isArray(cust)) return false;

  const customerIds = new Set(cust.map((customer) => idOf(customer?.id)).filter(Boolean));
  return sos.every((so) => {
    if (!so || so._itemsHydrated !== true || so._posHydrated !== true) return false;
    // A missing customer/tag makes the core+customer match incomplete. Do not
    // classify a bill as outside while that join is still unresolved.
    return !!idOf(so.customer_id) && customerIds.has(idOf(so.customer_id));
  });
};

// Stable signature for the hydration state. It changes when an order/customer
// arrives or an order transitions from partial to fully hydrated, but not when
// ordinary order fields change. The App uses it to avoid repeated/overlapping
// queue loads while still retrying once late hydration completes.
export const billQueueHydrationKey = ({ dbLoading, sos, cust } = {}) => {
  const orderState = (Array.isArray(sos) ? sos : []).map((so) => [
    idOf(so?.id),
    idOf(so?.customer_id),
    so?._itemsHydrated === true,
    so?._posHydrated === true,
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  const customerState = (Array.isArray(cust) ? cust : []).map((customer) => [
    idOf(customer?.id),
    String(customer?.alpha_tag == null ? '' : customer.alpha_tag),
    String(customer?.name == null ? '' : customer.name),
  ]).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify({ loading: !!dbLoading, orders: orderState, customers: customerState });
};
