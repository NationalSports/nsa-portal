import { safeDecos, safeNum } from '../safeHelpers';

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
