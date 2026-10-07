// Input must come from getPricing, never product-info catalog prices.
const key = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function accountCostSnapshot(rows, color) {
  const valid = (Array.isArray(rows) ? rows : []).filter(r => r && ![true, 'true'].includes(r.errorOccurred) && ![true, 'true'].includes(r.errorOccured));
  const colorOf = r => key(r.catalogColor || r.color || r.colorName || r.productColor);
  const scoped = valid.some(colorOf) ? valid.filter(r => colorOf(r) === key(color)) : valid;
  const prices = {};
  for (const r of scoped) {
    const size = String(r.size || r.labelSize || r.sizeCode || '').trim();
    const price = [r.myPrice, r.salePrice, r.piecePrice, r.customerPrice].map(Number.parseFloat).find(n => Number.isFinite(n) && n > 0);
    if (size && price > 0 && (prices[size] == null || price < prices[size])) prices[size] = price;
  }
  if (!Object.keys(prices).length) return null;
  const cost = Math.min(...Object.values(prices));
  const sizeCosts = Object.fromEntries(Object.entries(prices).filter(([, value]) => Math.abs(value - cost) > 0.001));
  return { nsa_cost: cost, size_costs: Object.keys(sizeCosts).length ? sizeCosts : null };
}
module.exports = { accountCostSnapshot };
