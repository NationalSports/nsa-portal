/* Unit tests for the server-side webstore checkout math.
 *
 * priceCart is the money path: the browser never sets a price, so every dollar is
 * recomputed here. These cover the pure helpers (upcharge/fundraise/coupon/stock)
 * and a priceCart happy path driven by a tiny fake supabase client. */
const checkout = require('../../netlify/functions/webstore-checkout');

// Minimal chainable supabase stub: from(table) returns a thenable whose query
// methods are no-ops and whose awaited value is the canned result for that table.
function fakeSb(tables) {
  return {
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain,
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

describe('r2 rounding', () => {
  test('rounds to cents, tolerates junk', () => {
    expect(checkout.r2(1.005)).toBe(1.0); // float — documents actual behavior
    expect(checkout.r2(2.345)).toBe(2.35);
    expect(checkout.r2('3.1')).toBe(3.1);
    expect(checkout.r2(null)).toBe(0);
  });
});

describe('effFund — per-item vs store rule', () => {
  test('per-item amount always wins', () => {
    expect(checkout.effFund({ fundraise_enabled: true, fundraise_pct: 50 }, { fundraise_amount: 7, retail_price: 20 })).toBe(7);
  });
  test('store percent, rounded up when configured', () => {
    expect(checkout.effFund({ fundraise_enabled: true, fundraise_pct: 10, fundraise_round: true }, { retail_price: 25 })).toBe(3); // ceil(2.5)
    expect(checkout.effFund({ fundraise_enabled: true, fundraise_pct: 10 }, { retail_price: 25 })).toBe(2.5);
  });
  test('store flat, and disabled = 0', () => {
    expect(checkout.effFund({ fundraise_enabled: true, fundraise_flat: 5 }, { retail_price: 25 })).toBe(5);
    expect(checkout.effFund({ fundraise_enabled: false }, { retail_price: 25 })).toBe(0);
  });
});

describe('couponDiscount — percent only', () => {
  test('applies to cart + shipping by default', () => {
    expect(checkout.couponDiscount({ kind: 'percent', value: 10 }, 100, 5)).toBe(10.5);
  });
  test('excludes shipping when cover_shipping is false', () => {
    expect(checkout.couponDiscount({ kind: 'percent', value: 10, cover_shipping: false }, 100, 5)).toBe(10);
  });
  test('non-percent / null coupons discount nothing', () => {
    expect(checkout.couponDiscount({ kind: 'flat', value: 10 }, 100, 5)).toBe(0);
    expect(checkout.couponDiscount(null, 100, 5)).toBe(0);
  });
});

describe('checkNumberRange', () => {
  const store = { number_min: 0, number_max: 99 };
  test('passes in-range numbers (singles and bundle components)', () => {
    expect(checkout.checkNumberRange(store, [{ kind: 'single', player_number: '50' }])).toBeNull();
    expect(checkout.checkNumberRange(store, [{ kind: 'bundle', components: [{ player_number: '0' }, { player_number: '99' }] }])).toBeNull();
  });
  test('rejects an out-of-range number', () => {
    const msg = checkout.checkNumberRange(store, [{ kind: 'single', player_number: '100' }]);
    expect(msg).toMatch(/outside/i);
  });
});

describe('_availForSize — on-hand + vendor + tall twin', () => {
  const p = { size_stock: { M: 2 }, vendor_size_stock: { M: 3, LT: 1 } };
  test('sums warehouse + vendor for the size', () => {
    expect(checkout._availForSize(p, 'M')).toBe(5);
  });
  test('a regular size counts its tall twin (L ← LT)', () => {
    expect(checkout._availForSize(p, 'L')).toBe(1);
  });
  test('unstocked size is zero', () => {
    expect(checkout._availForSize(p, 'XS')).toBe(0);
  });
});

describe('priceCart', () => {
  const store = { id: 's1', fundraise_enabled: false };
  const wpTee = { id: 'wp1', store_id: 's1', kind: 'single', retail_price: 20, active: true, takes_name: false, takes_number: false, name_upcharge: 0, display_name: 'Tee', variant_label: null, image_url: null };
  const sb = (extra = {}) => fakeSb({
    webstore_products: { data: [wpTee], error: null },
    webstore_storefront_products: { data: [{ webstore_product_id: 'wp1', size_upcharges: { '2XL': 4 } }], error: null },
    webstore_bundle_items: { data: [], error: null },
    ...extra,
  });

  test('prices a simple single line by qty', async () => {
    const r = await checkout.priceCart(sb(), store, [{ webstore_product_id: 'wp1', size: 'M', qty: 2 }]);
    expect(r.error).toBeUndefined();
    expect(r.subtotal).toBe(40);
    expect(r.fundraise).toBe(0);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(2);
    expect(r.lines[0].unit_price).toBe(20);
  });

  test('adds the per-size upcharge published by the storefront view', async () => {
    const r = await checkout.priceCart(sb(), store, [{ webstore_product_id: 'wp1', size: '2XL', qty: 1 }]);
    expect(r.lines[0].unit_price).toBe(24);
    expect(r.subtotal).toBe(24);
  });

  test('applies store fundraising to the line', async () => {
    const fStore = { id: 's1', fundraise_enabled: true, fundraise_pct: 10 };
    const r = await checkout.priceCart(sb(), fStore, [{ webstore_product_id: 'wp1', size: 'M', qty: 1 }]);
    expect(r.fundraise).toBe(2); // 10% of 20
    expect(r.lines[0].fundraise).toBe(2);
  });

  test('rejects an empty cart', async () => {
    const r = await checkout.priceCart(sb(), store, []);
    expect(r.error).toMatch(/empty/i);
  });

  test('blocks a number-required item with no number', async () => {
    const sbNum = sb({ webstore_products: { data: [{ ...wpTee, takes_number: true }], error: null } });
    const r = await checkout.priceCart(sbNum, store, [{ webstore_product_id: 'wp1', size: 'M', qty: 1 }]);
    expect(r.error).toMatch(/number/i);
  });

  test('carries the fit/variant label onto the priced line', async () => {
    const sbFit = sb({ webstore_products: { data: [{ ...wpTee, variant_label: "Women's" }], error: null } });
    const r = await checkout.priceCart(sbFit, store, [{ webstore_product_id: 'wp1', size: 'M', qty: 1 }]);
    expect(r.lines[0].variant_label).toBe("Women's");
  });
});
