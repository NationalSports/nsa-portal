import { calcOrderMargin, isPromoOnlyOrder } from '../pricing';

// EST-2619: a "free promo" garment was zeroing nsa_cost as well as unit_sell, so 55 tees that
// cost us $15 each read as a costless $0 line. Margin showed only the deco cost as the loss.
const promoTeeOrder = (overrides = {}) => ({
  id: 'EST-2619',
  items: [{
    sku: 'JP4675', name: 'Adidas Techfit SS Tee',
    nsa_cost: 15, unit_sell: 0, is_free_promo: true,
    sizes: { M: 25, L: 17, XL: 8, '2XL': 4, '3XL': 1 },
    decorations: [{ kind: 'sp', colors: 2, size: 8, cost_override: 2.5, sell_override: 0 }],
  }],
  ...overrides,
});

describe('free-promo garment margin', () => {
  test('the garment we give away still costs us its full cost', () => {
    const m = calcOrderMargin(promoTeeOrder());
    expect(m.rev).toBe(0);
    // 55 tees x $15 = $825 of garment, plus the deco cost — all of it a loss.
    expect(m.cost).toBeGreaterThanOrEqual(825);
    expect(m.margin).toBeLessThanOrEqual(-825);
  });

  test('per-size sells on a free-promo line never bill the customer', () => {
    const o = promoTeeOrder();
    o.items[0]._sizeSells = { M: 24, L: 24, XL: 24, '2XL': 26, '3XL': 26 };
    expect(calcOrderMargin(o).rev).toBe(0);
  });
});

describe('isPromoOnlyOrder', () => {
  test('an all-free-promo order is a giveaway, not a low-margin sale', () => {
    expect(isPromoOnlyOrder(promoTeeOrder())).toBe(true);
  });

  test('an order with promo dollars applied is exempt', () => {
    expect(isPromoOnlyOrder({ promo_applied: true, items: [] })).toBe(true);
  });

  test('a normal order — and a mostly-normal order with one promo line — still ranks', () => {
    const normal = {
      items: [{ nsa_cost: 10, unit_sell: 16, sizes: { M: 20 }, decorations: [] }],
    };
    expect(isPromoOnlyOrder(normal)).toBe(false);
    const mixed = promoTeeOrder();
    mixed.items = [...mixed.items, normal.items[0]];
    expect(isPromoOnlyOrder(mixed)).toBe(false);
  });

  test('an empty order is not exempt', () => {
    expect(isPromoOnlyOrder({ items: [] })).toBe(false);
    expect(isPromoOnlyOrder(null)).toBe(false);
  });
});
