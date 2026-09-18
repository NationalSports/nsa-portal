import { calcOrderMargin, isPromoOnlyOrder } from '../pricing';
import { recoverGarmentCost } from '../lib/promoPricing';

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

// The lines already saved by the old bug have nsa_cost 0 in the database with nothing left to
// restore, so toggling promo off/on did nothing. Re-derive the cost from what we still know.
describe('recoverGarmentCost', () => {
  const catalog = [{ id: 'p1', sku: 'JP4675', color: 'White', nsa_cost: 15, retail_price: 40 }];

  test('EST-2619: an adidas line with no catalog match falls back to retail x the tier cost multiplier', () => {
    const line = { sku: 'JP4675', brand: 'Adidas', retail_price: 40, nsa_cost: 0, is_free_promo: true };
    expect(recoverGarmentCost(line, [])).toEqual({ nsa_cost: 15 });
  });

  test('prefers the catalog product when there is one', () => {
    const line = { product_id: 'p1', sku: 'JP4675', color: 'White', brand: 'Adidas', retail_price: 40, nsa_cost: 0 };
    expect(recoverGarmentCost(line, catalog)).toEqual({ nsa_cost: 15 });
  });

  test('carries per-size costs across when the catalog product has them', () => {
    const sized = [{ ...catalog[0], _sizeCosts: { M: 15, '2XL': 17 } }];
    expect(recoverGarmentCost({ product_id: 'p1', nsa_cost: 0 }, sized))
      .toEqual({ nsa_cost: 15, _sizeCosts: { M: 15, '2XL': 17 } });
  });

  test('never overwrites a cost the line already has', () => {
    expect(recoverGarmentCost({ product_id: 'p1', nsa_cost: 12 }, catalog)).toBeNull();
    expect(recoverGarmentCost({ product_id: 'p1', nsa_cost: 0, _sizeCosts: { M: 12 } }, catalog)).toBeNull();
  });

  test('customer-supplied goods really are $0 to us', () => {
    const line = { sku: 'JP4675', brand: 'Adidas', retail_price: 40, nsa_cost: 0, customer_supplied: true };
    expect(recoverGarmentCost(line, catalog)).toBeNull();
  });

  test('nothing to go on — no guess', () => {
    expect(recoverGarmentCost({ sku: 'X', name: 'Setup charge', nsa_cost: 0 }, [])).toBeNull();
    expect(recoverGarmentCost(null, [])).toBeNull();
  });

  test('a recovered cost turns the promo line negative for real', () => {
    const o = promoTeeOrder();
    o.items[0].nsa_cost = 0;             // the line as the old bug saved it
    expect(calcOrderMargin(o).cost).toBeLessThan(200);
    const fix = recoverGarmentCost({ ...o.items[0], brand: 'Adidas' }, catalog);
    o.items[0] = { ...o.items[0], ...fix };
    expect(calcOrderMargin(o).margin).toBeLessThanOrEqual(-825);
  });
});
