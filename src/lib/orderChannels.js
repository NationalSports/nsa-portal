// Keep the operational orders loaded globally. Only the main sales-order list
// excludes 24/7; production, purchasing, picking, and fulfillment share them.
export function isAtOnceOrder(order, stores = []) {
  if (!order || order.omg_store_id || order.source === 'omg') return false;
  const store = stores.find(s => s.id === order.webstore_id);
  if (store?.source === 'omg') return false;
  return /^247-[0-9]+$/.test(order.id || '') || ['club','all_school'].includes(store?.org_type);
}
export function mainSalesOrders(orders, stores) {
  return orders.filter(order => !isAtOnceOrder(order, stores));
}
