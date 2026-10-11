export const isStoreSalesOrder = so => !!(so?.omg_store_id || so?.webstore_id);
export const isStoreFinanciallyClosed = so => !!(so?.store_closed_at && so?.store_costs_recorded_at);
export function storeCommissionReady(invoice, so) {
  // Fail closed if the invoice identifies a store but its SO has not hydrated.
  const store = isStoreSalesOrder(so) || /^(omg|webstore):/.test(invoice?.idempotency_key || '');
  return !store || isStoreFinanciallyClosed(so);
}
