// DPO expected_cost is the committed total, including per-item rates and material
// quantities. Rebuilding it from the default unit rate loses those overrides.
const finite = value => typeof value === 'number' && Number.isFinite(value);
const num = value => finite(value) ? value : 0;

function decoPoExpectedCost(dp) {
  if (finite(dp?.expected_cost)) return dp.expected_cost;
  return num(dp?.qty) * num(dp?.unit_cost);
}

function decoPoCost(dp) {
  const billed = num(dp?._bill_cost);
  return billed > 0 ? billed : decoPoExpectedCost(dp);
}

module.exports = { decoPoExpectedCost, decoPoCost };
