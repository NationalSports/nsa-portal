import { applyFullPromoPricing, promoItemSell } from '../lib/promoPricing';

describe('order-level promo pricing', () => {
  test('uses retail, then 2x cost, then the entered service-line sell', () => {
    expect(promoItemSell({ retail_price: 42, nsa_cost: 10, unit_sell: 18 })).toBe(42);
    expect(promoItemSell({ retail_price: 0, nsa_cost: 10, unit_sell: 18 })).toBe(20);
    expect(promoItemSell({ retail_price: 0, nsa_cost: 0, unit_sell: 35 })).toBe(35);
  });

  test('converts a legacy partial line into a fully covered promo line', () => {
    const priced = applyFullPromoPricing({
      unit_sell: 12,
      retail_price: 30,
      _promo_credit: 196.75,
      _promo_partial_qty: 5,
      decorations: [{ sell_override: 2, _pre_promo_sell_override: 6 }],
    });
    expect(priced).toMatchObject({ is_promo: true, unit_sell: 30, _pre_promo_sell: 12 });
    expect(priced._promo_credit).toBeUndefined();
    expect(priced._promo_partial_qty).toBeUndefined();
    expect(priced.decorations[0].sell_override).toBe(6);
  });
});
