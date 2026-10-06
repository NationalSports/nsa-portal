import { SS_WAREHOUSES, shipToCoords, warehouseCoords, milesBetween, rankWarehouses, pickConsolidatedWarehouse } from '../WarehouseChips';

// Pick one nearby DC for the whole PO only when doing so does not add transit
// days to any line. Demand is summed by vendor SKU before checking availability.
export function planSSWarehouses(lines, stock, transitDays, shipTo) {
  const coords = shipToCoords(shipTo);
  const hasTransit = Object.keys(transitDays || {}).length > 0;
  const demand = new Map();
  (lines || []).forEach(l => {
    const sku = String(l.sku || '').trim().toUpperCase();
    if (sku) demand.set(sku, (demand.get(sku) || 0) + (Number(l.quantity) || 0));
  });
  const entries = [...demand].map(([sku, need]) => {
    const rows = (stock?.[sku] || []).map(w => {
      const days = transitDays?.[w.abbr];
      const distanceMiles = milesBetween(coords, warehouseCoords(SS_WAREHOUSES[w.abbr]));
      return {
        label: w.abbr,
        city: [SS_WAREHOUSES[w.abbr] || w.abbr, days != null ? `${days}-day transit` : ''].filter(Boolean).join(' · '),
        qty: w.qty,
        dist: hasTransit ? (days ?? null) : distanceMiles,
        distanceMiles,
        closest: !hasTransit && distanceMiles == null && w.closest,
      };
    });
    return { rows, need };
  });
  let warehouse = pickConsolidatedWarehouse(entries);
  if (warehouse && entries.some(({ rows, need }) => {
    const chosen = rows.find(r => r.label === warehouse);
    const fastest = rankWarehouses(rows, need).find(r => r.primary);
    // Do not constrain S&S when proximity is unknown, or consolidate at a
    // slower DC simply to avoid a box. Let its fastest optimizer handle splits.
    return !Number.isFinite(chosen.dist) || (hasTransit && fastest && chosen.dist > fastest.dist);
  })) warehouse = null;
  const expectedBySku = {};
  const skus = [...demand.keys()];
  entries.forEach(({ rows, need }, i) => {
    expectedBySku[skus[i]] = rankWarehouses(rows, need, warehouse).filter(r => r.primary);
  });
  return { warehouse: warehouse || '', expectedBySku };
}
