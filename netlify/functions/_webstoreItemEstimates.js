const { businessDate, addBusinessDays } = require('../../src/lib/businessDates.shared');
const sizeKey = value => String(value || 'OS').trim().toUpperCase();
const quantity = (sizes, size) => Object.entries(sizes || {}).reduce((n, [key, value]) => n + (sizeKey(key) === sizeKey(size) ? Math.max(0, Number(value) || 0) : 0), 0);
const latest = dates => dates.length && dates.every(Boolean) ? dates.slice().sort().pop() : null;

function estimateItem(item, source, picks, pos, productionDays, now = new Date()) {
  if (item.is_bundle_parent || item.line_status === 'cancelled') return null;
  if (['shipped', 'complete'].includes(item.line_status)) return { state: 'shipped', message: 'Shipped' };
  if (item.line_status === 'bagging') return { state: 'ready', message: 'Production complete; preparing to ship' };
  const pending = { state: 'pending', message: item.line_status === 'in_production' ? 'In production; confirming ship timing' : item.line_status === 'received' ? 'Checked in; confirming production timing' : 'Confirming stock arrival', ready_date: null, ship_date: null };
  if (Number(item.missing_qty) > 0) return { ...pending, state: 'delayed', message: 'Some units are delayed; ship estimate pending' };
  if (!source) return pending;
  const demand = quantity(source.sizes, item.size);
  if (demand < Number(item.qty) || !demand) return pending;
  const allocations = [];
  for (const row of picks) {
    if (!['pick', 'pulled'].includes(row.status) || (row.ship_dest && row.ship_dest !== 'in_house')) continue;
    const qty = quantity(row.sizes, item.size);
    if (qty) allocations.push({ qty, ready: addBusinessDays(row.created_at, 3), done: row.status === 'pulled', source: 'warehouse' });
  }
  for (const row of pos) {
    if (row.status === 'cancelled' || row.sizes?.drop_ship) continue;
    const qty = Math.max(0, quantity(row.sizes, item.size) - quantity(row.cancelled, item.size));
    if (!qty) continue;
    // Expected PO arrival wins over the forecast captured at S&S submission.
    // Exact size AND style are required: old vendor_keys may contain the entire batch.
    const keys = (row.sizes?.vendor_keys?.lines || []).filter(l => sizeKey(l.size) === sizeKey(item.size) && String(l.style || '').toUpperCase() === String(source.sku || '').toUpperCase() && String(l.color || '').toUpperCase() === String(source.color || '').toUpperCase());
    const arrival = businessDate(row.expected_date) || latest(keys.map(l => businessDate(l.estimated_arrival)));
    const received = quantity(row.received, item.size) >= qty;
    allocations.push({ qty, arrival, ready: addBusinessDays(arrival, 2), done: received, source: 'supplier' });
  }
  if (allocations.reduce((n, a) => n + a.qty, 0) < demand) return pending;
  const readyDate = latest(allocations.map(a => a.ready));
  const stockReady = allocations.every(a => a.done);
  const today = businessDate(now);
  const arrivalDate = latest(allocations.filter(a => a.source === 'supplier').map(a => a.arrival));
  const production = productionDays !== null && productionDays !== '' && Number.isInteger(Number(productionDays)) && Number(productionDays) >= 0 && Number(productionDays) <= 90 ? Number(productionDays) : null;
  const shipDate = production === null ? null : addBusinessDays(readyDate, production);
  const overdue = (!stockReady && readyDate && readyDate < today) || (shipDate && shipDate < today);
  return {
    state: overdue ? 'delayed' : stockReady ? 'ready' : 'estimated',
    message: overdue ? 'Timing update needed; ship estimate pending' : stockReady ? 'Stock ready for production' : allocations.every(a => a.source === 'warehouse') ? 'Stock pull: allow 3 business days' : 'Supplier arrival, then 2 business days for check-in',
    arrival_date: arrivalDate,
    ready_date: readyDate,
    ship_date: overdue ? null : shipDate,
    production_days: production,
  };
}

// Only called after status-token authorization. Internal PO records never leave
// this helper; exact source-item IDs prevent matching another shopper's same SKU.
async function loadItemEstimates(sb, order, store, items, now = new Date()) {
  if (store?.org_type !== 'all_school') return null;
  const fallback = () => Object.fromEntries(items.map(i => [i.id, estimateItem(i, null, [], [], null, now)]));
  try {
    const link = await sb.from('webstore_orders').select('so_id').eq('id', order.id).maybeSingle();
    if (link.error || !link.data?.so_id) return fallback();
    const result = await sb.from('so_items').select('id,sku,color,sizes,source_webstore_item_ids').eq('so_id', link.data.so_id);
    if (result.error) throw result.error;
    const sources = (result.data || []).filter(s => (s.source_webstore_item_ids || []).some(id => items.some(i => i.id === id)));
    if (!sources.length) return fallback();
    const ids = sources.map(s => s.id);
    const [pickResult, poResult] = await Promise.all([
      sb.from('so_item_pick_lines').select('so_item_id,sizes,status,created_at,ship_dest').in('so_item_id', ids),
      sb.from('so_item_po_lines').select('so_item_id,sizes,received,cancelled,status,expected_date').in('so_item_id', ids),
    ]);
    if (pickResult.error || poResult.error) throw pickResult.error || poResult.error;
    return Object.fromEntries(items.map(item => {
      const matches = sources.filter(s => (s.source_webstore_item_ids || []).includes(item.id));
      const source = matches.length === 1 ? matches[0] : null;
      return [item.id, estimateItem(item, source,
        (pickResult.data || []).filter(p => p.so_item_id === source?.id),
        (poResult.data || []).filter(p => p.so_item_id === source?.id),
        store.all_school_settings?.production?.business_days ?? null, now)];
    }));
  } catch (error) {
    console.warn('[item-estimates] unavailable:', error.message);
    return fallback();
  }
}
module.exports = { estimateItem, loadItemEstimates };
