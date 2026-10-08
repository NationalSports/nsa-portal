// Offline plan only. Preserves every known size's effective cost and never prices stores.
const fs = require('fs');
const canonical = size => ({ '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', '5XL': 'XXXXXL', '2XS': 'XXS' }[String(size).trim().toUpperCase()] || String(size).trim().toUpperCase());
function effectiveCost(row, size) {
  const costs = row.size_costs || {};
  const matches = Object.entries(costs).filter(([k]) => canonical(k) === canonical(size));
  const values = [...new Set(matches.map(([, v]) => Number(v)))];
  if (values.length > 1) throw new Error(`Conflicting size aliases for ${row.id}: ${size}`);
  const cost = values.length ? values[0] : Number(row.nsa_cost);
  if (!Number.isFinite(cost) || cost <= 0) throw new Error(`Invalid size cost for ${row.id}: ${size}`);
  return cost;
}
function repairPlan(row) {
  if (!Array.isArray(row.available_sizes) || !row.available_sizes.length) throw new Error(`Missing size range: ${row.id}`);
  const sizes = [...new Set([...row.available_sizes, ...Object.keys(row.size_costs || {})])];
  const effective = Object.fromEntries(sizes.map(size => [size, effectiveCost(row, size)]));
  const base = Math.min(...Object.values(effective));
  if (base >= Number(row.nsa_cost)) return null;
  const overrides = Object.fromEntries(Object.entries(effective).filter(([, cost]) => cost > base));
  const result = { id: row.id, old_cost: Number(row.nsa_cost), old_size_costs: row.size_costs, old_available_sizes: row.available_sizes, new_cost: base, new_size_costs: Object.keys(overrides).length ? overrides : null };
  for (const size of sizes) {
    if (effectiveCost({ id: row.id, nsa_cost: base, size_costs: result.new_size_costs }, size) !== effective[size]) throw new Error(`Size cost changed: ${row.id}/${size}`);
  }
  return result;
}
module.exports = { repairPlan, effectiveCost };
if (require.main === module) {
  const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const plan = rows.map(repairPlan).filter(Boolean);
  fs.writeFileSync(process.argv[3], JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ rows: plan.length, sizeCostsPreserved: true }));
}
