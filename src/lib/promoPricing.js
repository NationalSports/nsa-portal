import { safeDecos, safeNum } from '../safeHelpers';
import { isAU, auCostMult } from './decoPricing';

// Promo is an order-level payment method. Every priced line is covered and is
// repriced to retail; it is never blended into a partly customer-paid line.
export const promoItemSell = item => {
  if (safeNum(item?.retail_price) > 0) return safeNum(item.retail_price);
  if (safeNum(item?.nsa_cost) > 0) return safeNum(item.nsa_cost) * 2;
  // Service/custom charges often have neither cost nor catalog retail. Their
  // entered sell is the retail value the promo fund covers.
  return safeNum(item?._pre_promo_sell != null ? item._pre_promo_sell : item?.unit_sell);
};

export const applyFullPromoPricing = item => {
  const restoredDecorations = safeDecos(item).map(d => d._pre_promo_sell_override !== undefined
    ? { ...d, sell_override: d._pre_promo_sell_override, _pre_promo_sell_override: undefined }
    : d);
  const baseSell = item._pre_promo_sell != null ? item._pre_promo_sell : item.unit_sell;
  const baseSizeSells = item._pre_promo_sizeSells || item._sizeSells;
  return {
    ...item,
    is_promo: true,
    _pre_promo_sell: baseSell,
    ...(baseSizeSells ? { _pre_promo_sizeSells: baseSizeSells } : {}),
    unit_sell: item.is_free_promo ? safeNum(baseSell) : promoItemSell({ ...item, unit_sell: baseSell }),
    _sizeSells: item.is_free_promo ? baseSizeSells : undefined,
    decorations: restoredDecorations,
    _promo_credit: undefined,
    _promo_partial_qty: undefined,
  };
};

// ── recoverGarmentCost ──
// Promo lines created before 2026-09 zeroed nsa_cost along with unit_sell, and the stash meant to
// hold the old cost (_pre_free_promo_cost) was never in _itemCols — so the save dropped it and the
// line came back costless forever, with no number left on it to restore. Re-derive one from what we
// still know: the catalog product, or (adidas/UA/NB) the line's own retail × the tier cost
// multiplier. Returns a patch to spread onto the line, or null when there is nothing to fix.
// Never overwrites a cost the line already has, and leaves customer-supplied goods at $0.
export const recoverGarmentCost = (item, products) => {
  const it = item;
  if (!it || it.customer_supplied) return null;
  if (safeNum(it.nsa_cost) > 0) return null;
  if (it._sizeCosts && Object.values(it._sizeCosts).some(c => safeNum(c) > 0)) return null;
  const list = Array.isArray(products) ? products : [];
  const p = (it.product_id && list.find(x => x.id === it.product_id))
    || list.find(x => x.sku === it.sku && (!it.color || x.color === it.color))
    || list.find(x => x.sku === it.sku);
  // Clearance products carry their markdown in clearance_cost — same rule the add-item path uses.
  const cat = (p && p.is_clearance && p.clearance_cost != null) ? safeNum(p.clearance_cost) : safeNum(p && p.nsa_cost);
  if (cat > 0) {
    const patch = { nsa_cost: cat };
    if (p._sizeCosts && Object.keys(p._sizeCosts).length > 1) patch._sizeCosts = p._sizeCosts;
    return patch;
  }
  if (isAU(it.brand) && safeNum(it.retail_price) > 0) {
    const c = Math.floor(safeNum(it.retail_price) * auCostMult(it.brand, !!it.is_footwear) * 100) / 100;
    return c > 0 ? { nsa_cost: c } : null;
  }
  return null;
};
