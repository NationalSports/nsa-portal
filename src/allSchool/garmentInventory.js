export function garmentInventoryRows(catalog = [], stockByWp = {}) {
  const groups = new Map();
  for (const row of [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
    const key = row.kind === 'bundle' ? row.id : String(row.sku || row.product_id || row.id).trim().toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].map((rows) => {
    const source = rows.find((r) => stockByWp[r.id]?.name) || rows.find((r) => stockByWp[r.id]) || rows[0];
    return { ...source, inventoryChoices: rows, inventoryStock: stockByWp[source.id] };
  });
}
