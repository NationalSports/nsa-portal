// Native webstore sales orders represent already-paid checkout orders. Their
// invoice coverage settles accounting, but does not prove that the goods were
// physically fulfilled. Keep their closeout in the fulfillment lifecycle.
export function isPrepaidStoreSO(so) {
  return Boolean(so?.webstore_id && !so?.omg_store_id);
}

export function shouldAutoCloseInvoicedSO(so, { status, hasInvoices, hasRemainingQty } = {}) {
  if (!so || isPrepaidStoreSO(so)) return false;
  return status === 'ready_to_invoice' && Boolean(hasInvoices) && !hasRemainingQty;
}
