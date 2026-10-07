// Use the lowest verified size cost as the base and retain every size premium.
function vendorCostSnapshot(entries) {
  const prices = {};
  for (const { size, cost } of entries || []) {
    const name = String(size || '').trim();
    const value = Number(cost);
    if (name && Number.isFinite(value) && value > 0 && (prices[name] == null || value < prices[name])) prices[name] = value;
  }
  if (!Object.keys(prices).length) return null;
  const baseCost = Math.min(...Object.values(prices));
  const premiums = Object.fromEntries(Object.entries(prices).filter(([, cost]) => cost > baseCost));
  return { baseCost, sizeCosts: Object.keys(premiums).length ? premiums : null };
}
module.exports = { vendorCostSnapshot };
