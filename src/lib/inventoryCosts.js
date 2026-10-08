// Receipt snapshots are frozen by PostgreSQL when warehouse stock is consumed.
// A PO buying 100 units must never charge all 100 units to a two-unit customer order.
function inventoryPickCosts(item, limit = Infinity) {
  let cost = 0, qty = 0, knownQty = 0, missing = false, estimatedReplacement = 0;
  const receipts = new Set(); const seen = new Set();
  for (const pick of item.pick_lines || []) {
    if (pick.status !== 'pulled') continue;
    for (const [size, basis] of Object.entries(pick._inventory_costs || {})) {
      const key = `${pick.pick_id}:${size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const units = Math.min(Number(basis.qty) || 0, Number(pick[size]) || 0, Math.max(0, limit - qty));
      if (units <= 0) continue;
      qty += units;
      if (basis.unit_cost == null) missing = true;
      else {
        knownQty += units;
        cost += units * Number(basis.unit_cost);
        estimatedReplacement += units * Number(item._sizeCosts?.[size] ?? item.nsa_cost ?? 0);
      }
      for (const id of basis.receipt_ids || []) receipts.add(id);
    }
  }
  return { cost, qty, knownQty, missing, estimatedReplacement, receipts: [...receipts] };
}
function inventoryCostIssues(order) {
  const issues = [];
  for (const item of order?.items || []) {
    if (inventoryPickCosts(item).missing) issues.push(`${item.name || item.sku}: garment stock cost is missing`);
    for (const d of item.decorations || []) if (d.inventory_cost_missing) issues.push(`${item.name || item.sku}: decoration cost needed (${d.transfer_code})`);
  }
  return issues;
}
function applyInventoryPullCosts(items, result) {
  for (const row of result?.rows || []) {
    if (!row.inventory_cost) continue;
    const key = (row.source_item_ids || []).slice().sort().join(',');
    for (const item of items) if (item.product_id === row.product_id && (item.source_webstore_item_ids || []).slice().sort().join(',') === key) {
      for (const pick of item.pick_lines || []) if (pick.pick_id === row.pick_id) pick._inventory_costs = { ...(pick._inventory_costs || {}), [row.size]: row.inventory_cost };
    }
  }
}
module.exports = { inventoryPickCosts, inventoryCostIssues, applyInventoryPullCosts };
