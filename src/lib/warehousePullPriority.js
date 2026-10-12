// One warehouse queue. Store provenance, never the SO number, earns Quick Pull.
export function isQuickPull(order, stores = []) {
  if (!order?.webstore_id || order.omg_store_id || order.source === 'omg') return false;
  const store = stores.find(row => row.id === order.webstore_id);
  return store?.source !== 'omg' && ['club', 'all_school'].includes(store?.org_type);
}
export function compareWarehousePulls(a, b) {
  const age = task => Number(task.openAgeDays ?? task.openDays) || 0;
  const rank = task => age(task) > 5 ? 0 : task.quickPull ? 1 : 2;
  const bucket = rank(a) - rank(b);
  if (bucket) return bucket;
  if (rank(a) === 0) return age(b) - age(a);
  return Number(!!b.urgent) - Number(!!a.urgent) || age(b) - age(a);
}
