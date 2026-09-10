// Broad searches focus on open work; a full order number still finds historical orders.
export function searchSalesOrders(orders, query, statusOf) {
  const q = String(query || '').trim().toLowerCase();
  return orders.filter(so => !so.deleted_at && so.status !== 'deleted' && (
    String(so.id).toLowerCase() === q ||
    (!['cancelled', 'complete'].includes(so.status) && statusOf(so) !== 'complete')
  ));
}
