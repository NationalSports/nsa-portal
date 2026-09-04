// Fulfillment paperwork must describe one sales order. Store-level screens also
// contain later/unbatched orders; mixing those into a player report makes that
// report impossible to reconcile to the vendor packing list for the linked SO.
export function selectFulfillmentReportScope(lines = []) {
  const all = lines || [];
  const soIds = [...new Set(all.map((line) => line && line._sourceSoId).filter(Boolean))].sort();
  if (soIds.length > 1) {
    return {
      ok: false,
      soIds,
      message: `This store has orders across ${soIds.length} sales orders (${soIds.join(', ')}). Open the specific SO to create its player report or CSV.`,
    };
  }

  // Before the first batch exists, preserve the useful whole-store report. Once
  // an SO exists, however, only its reconciled lines belong in fulfillment docs.
  const soId = soIds[0] || '';
  const included = soId ? all.filter((line) => line && line._sourceSoId === soId) : all;
  const excluded = soId ? all.filter((line) => line && !line._sourceSoId) : [];
  const excludedOrderIds = [...new Set(excluded.map((line) => line.order_id).filter(Boolean))];

  return {
    ok: true,
    soId,
    label: soId || 'Unbatched orders',
    lines: included,
    excludedLines: excluded,
    excludedOrders: excludedOrderIds.length,
    excludedUnits: excluded.reduce((sum, line) => sum + (Number(line.qty) || 0), 0),
  };
}
