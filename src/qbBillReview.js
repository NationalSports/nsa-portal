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
