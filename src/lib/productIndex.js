// O(1) catalog lookup for the order editors.
//
// Both editors resolved an item's catalog row with
//   products.find(p => p.id === x.product_id || p.sku === x.sku)
// and called it once per SIZE CELL in the item grid (plus ~4 more times per item for the
// thumbnail, vendor id, free-to-pull stock and size upcharge). That is a linear scan of the
// ~10.6k-row client catalog per cell: measured at ~11ms for a 10-line order and ~41ms for a
// 40-line one, of pure JS, paid on EVERY re-render the editor does while a rep is typing.
//
// The index is built once per catalog change (useMemo on [products], ~4ms) and drops the
// per-render cost to ~0.1ms — 58x to 288x, and flat in the number of lines.
//
// Semantics are a faithful stand-in for Array.prototype.find, which returns the first element
// matching EITHER key. So when an item's product_id and sku resolve to DIFFERENT rows, the one
// earlier in the array must win — this is deliberately not "by id, else by sku".
export function buildProductIndex(products) {
  const list = Array.isArray(products) ? products : [];
  const byId = new Map(), bySku = new Map();
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (!p) continue;
    // First occurrence only: find() stops at the first match, so a later duplicate never wins.
    if (p.id != null && !byId.has(p.id)) byId.set(p.id, i);
    if (p.sku != null && !bySku.has(p.sku)) bySku.set(p.sku, i);
  }
  return (x) => {
    if (!x) return undefined;
    // Null/undefined keys are not looked up: find() would have matched a row whose own id/sku is
    // nullish, which is never a real catalog row and would be a false positive here.
    const a = x.product_id != null ? byId.get(x.product_id) : undefined;
    const b = x.sku != null ? bySku.get(x.sku) : undefined;
    if (a === undefined) return b === undefined ? undefined : list[b];
    if (b === undefined) return list[a];
    return list[a < b ? a : b];
  };
}
