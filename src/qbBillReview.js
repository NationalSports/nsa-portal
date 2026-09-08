// Server-ledger rows can predate the current parser shape. Keep the review UI
// safe when an older row has no line-item or warning arrays.
export function normalizeBillForReview(value) {
  const bill = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    ...bill,
    items: Array.isArray(bill.items) ? bill.items : [],
    warnings: Array.isArray(bill.warnings) ? bill.warnings : [],
  };
}

// Historical applied-bill rows may carry a perfectly good PO number but no
// matchedPO wrapper. That wrapper was browser-local before the server ledger
// existed, so treating the row as permanently "not sendable" makes operators
// re-select an order the live matcher can already find. Re-run the same matcher
// used by the PO edit field when the backfill row has no saved target.
export function prepareQboBackfillBill(value, rematch) {
  const bill = normalizeBillForReview(value);
  if (bill.matchedPOSource || !bill.po_number || typeof rematch !== 'function') return bill;
  return rematch(bill);
}

// Match wrappers use different field names by source: inventory/batch POs use
// po_number, while Sales Order and decoration POs use po_id.
export function matchedBillPoNumber(value) {
  const bill = value && typeof value === 'object' ? value : {};
  const match = bill.matchedPO && typeof bill.matchedPO === 'object' ? bill.matchedPO : {};
  if (bill.matchedPOSource === 'so_po') return match.po_id || '';
  return match.po_number || match.po_id || match.id || '';
}
