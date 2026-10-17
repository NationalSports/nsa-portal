import { activeWebstoreLines, isLiveWebstoreOrder, reportBlockingIssues, resolveWebstoreReportLines } from './soPlayerReport';
import { resolveSizeSkuSource } from './sizeSkuOverrides';

const units = (sizes) => Object.entries(sizes || {}).reduce((n, [size, qty]) =>
  n + (/^(drop_ship|unit_cost|_)/i.test(size) ? 0 : Math.max(0, Number(qty) || 0)), 0);
const norm = (v) => String(v || '').trim().toUpperCase();

export function buildProductionReport(data) {
  const orders = (data.orders || []).filter(isLiveWebstoreOrder);
  const orderById = Object.fromEntries(orders.map((o) => [o.id, o]));
  const productById = Object.fromEntries((data.products || []).map((p) => [p.product_id, p]));
  const source = activeWebstoreLines(data.items || [], orderById).map((line) => {
    const product = productById[line.product_id];
    const raw = product?.size_skus?.[line.size || 'OS'];
    const override = resolveSizeSkuSource({
      raw, lineSku: line.sku, lineColor: line.color,
      baseProduct: { id: line.product_id || null, sku: line.sku || '', color: line.color || '' }, candidates: [],
    });
    return { ...line, _effSku: override.isOverride ? override.sku : (line.sku || '') };
  });
  const soItemsBySo = {};
  (data.soItems || []).forEach((i) => { (soItemsBySo[i.so_id] ||= []).push(i); });
  const soMetaBySo = Object.fromEntries((data.salesOrders || []).map((so) => [so.id, so]));
  const { lines, audit } = resolveWebstoreReportLines({ orders, lines: source, soItemsBySo, soMetaBySo });
  const problems = reportBlockingIssues(audit);
  const production = (data.soItems || []).filter((i) => soMetaBySo[i.so_id]).map((i) => ({
    ...i, units: units(i.sizes),
    decorations: (data.decorations || []).filter((d) => d.so_item_id === i.id),
    batch: soMetaBySo[i.so_id],
    image: (data.products || []).find((p) => norm(p.sku) === norm(i.sku))?.image_url ||
      (data.productImages || []).find((p) => norm(p.sku) === norm(i.sku) && (!i.color || norm(p.color) === norm(i.color)))?.image_front_url || '',
  })).filter((i) => i.units > 0);
  const unbatched = lines.filter((l) => !l._sourceSoId && !orderById[l.order_id]?.so_id);
  const unassignedBySo = {};
  Object.entries(soItemsBySo).forEach(([soId, items]) => {
    if (!soMetaBySo[soId]) return;
    const soUnits = items.reduce((n, item) => n + units(item.sizes), 0);
    const assigned = lines.filter((l) => l._sourceSoId === soId)
      .reduce((n, l) => n + (Number(l.qty) || 0), 0);
    if (soUnits > assigned) unassignedBySo[soId] = soUnits - assigned;
  });
  const players = {};
  lines.forEach((l) => {
    const o = orderById[l.order_id] || {};
    const name = String(l.player_name || o.buyer_name || 'Unassigned').trim();
    const number = String(l.player_number || '').trim();
    const soId = l._sourceSoId || o.so_id || null;
    const key = norm(name) + '|' + number + '|' + (soId || 'unbatched');
    const p = players[key] ||= { name, number, soId, orders: new Set(), lines: [], units: 0 };
    p.orders.add(o.order_number || o.id); p.lines.push(l); p.units += Number(l.qty) || 0;
  });
  return {
    orders, orderById, lines, audit, problems, production, unbatched, unassignedBySo,
    players: Object.values(players).map((p) => ({ ...p, orders: [...p.orders] }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.number.localeCompare(b.number)),
    productionUnits: production.reduce((n, i) => n + i.units, 0),
    playerUnits: lines.reduce((n, i) => n + (Number(i.qty) || 0), 0),
  };
}
