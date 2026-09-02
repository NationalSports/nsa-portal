/** @jest-environment node */
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
        ilike: () => chain, limit: () => chain, gt: () => chain,
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

describe('sales tax availability — fail closed where NSA is registered', () => {
  const originalFetch = global.fetch;
  const originalStates = process.env.TAX_COLLECT_STATES;
  const originalUrl = process.env.REACT_APP_SUPABASE_URL;
  const originalServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  afterEach(() => {
    global.fetch = originalFetch;
    if (originalStates == null) delete process.env.TAX_COLLECT_STATES;
    else process.env.TAX_COLLECT_STATES = originalStates;
    if (originalUrl == null) delete process.env.REACT_APP_SUPABASE_URL;
    else process.env.REACT_APP_SUPABASE_URL = originalUrl;
    if (originalServiceKey == null) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceKey;
  });

  test('a failed California rate lookup returns a retry error, never a guessed fallback rate', async () => {
    process.env.TAX_COLLECT_STATES = 'CA';
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    const r = await checkout.calcTax(
      { delivery_mode: 'ship_home' },
      { street1: '1 Main St', city: 'Fresno', state: 'CA', zip: '93703' },
      100,
      null,
    );
    expect(r).toMatchObject({ error: checkout.TAX_RETRY_ERROR, state: 'CA', source: 'cdtfa_unavailable' });
    expect(r.tax).toBeUndefined();
  });

  test('a failed TaxCloud lookup in another registered state returns a retry error, never zero tax', async () => {
    process.env.TAX_COLLECT_STATES = 'CA,TX';
    process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false }) });
    const r = await checkout.calcTax(
      { delivery_mode: 'ship_home' },
      { street1: '1 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
      100,
      null,
    );
    expect(r).toMatchObject({ error: checkout.TAX_RETRY_ERROR, state: 'TX', source: 'taxcloud_unavailable' });
    expect(r.tax).toBeUndefined();
  });

  test('a valid zero TaxCloud apparel rate remains a successful zero-tax quote', async () => {
    process.env.TAX_COLLECT_STATES = 'CA,TX';
    process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, tax_rate: 0 }) });
    const r = await checkout.calcTax(
      { delivery_mode: 'ship_home' },
      { street1: '1 Congress Ave', city: 'Austin', state: 'TX', zip: '78701' },
      100,
      null,
    );
    expect(r).toEqual({ tax: 0, rate: 0, state: 'TX', source: 'taxcloud' });
  });

  test('a non-California pickup requires enough billing address data to source tax', async () => {
    process.env.TAX_COLLECT_STATES = 'CA,TX';
    global.fetch = jest.fn();
    const r = await checkout.calcTax(
      { delivery_mode: 'club_delivery' },
      {},
      100,
      { zip: '78701' },
    );
    expect(r).toMatchObject({ error: checkout.TAX_RETRY_ERROR, source: 'missing_destination_state' });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('storeOrderWindowError — server-authoritative order window', () => {
  const now = Date.parse('2026-09-01T20:00:00.000Z');

  test('accepts an open store inside its configured window', () => {
    expect(checkout.storeOrderWindowError({ status: 'open', open_at: '2026-09-01T19:00:00.000Z', close_at: '2026-09-01T21:00:00.000Z' }, now)).toBeNull();
  });

  test('rejects a scheduled store even if status was prematurely set open', () => {
    expect(checkout.storeOrderWindowError({ status: 'open', open_at: '2026-09-01T21:00:00.000Z' }, now)).toMatch(/open for orders yet/i);
  });

  test('rejects a past-close store even before the hourly close sweep flips status', () => {
    expect(checkout.storeOrderWindowError({ status: 'open', close_at: '2026-09-01T20:00:00.000Z' }, now)).toMatch(/has closed/i);
  });

  test('keeps status itself authoritative for draft/closed stores', () => {
    expect(checkout.storeOrderWindowError({ status: 'draft' }, now)).toMatch(/isn’t open/i);
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

describe('priceAddOnSelections', () => {
  const defs = [
    { id: 'num', label: 'Player number', kind: 'number', required: true, upcharge: 3 },
    { id: 'txt', label: 'Locker name', kind: 'text', required: false, upcharge: 2 },
    { id: 'color', label: 'Collar color', kind: 'choice', required: true, choices: [{ label: 'Royal', upcharge: 1 }, { label: 'Red', upcharge: 0 }] },
    { id: 'patch', label: 'Add captain patch', kind: 'addon', required: false, upcharge: 5 },
  ];

  test('sanitizes all supported field types and prices from server definitions', () => {
    const r = checkout.priceAddOnSelections(defs, [
      { id: 'num', value: '12', upcharge: 999 }, { id: 'txt', value: '  SMITH  ' },
      { id: 'color', value: 'Royal' }, { id: 'patch', value: true },
    ]);
    expect(r.error).toBeUndefined();
    expect(r.extra).toBe(11);
    expect(r.selections.map((s) => [s.id, s.value, s.upcharge])).toEqual([
      ['num', '12', 3], ['txt', 'SMITH', 2], ['color', 'Royal', 1], ['patch', true, 5],
    ]);
  });

  test('rejects missing required answers and unknown choices', () => {
    expect(checkout.priceAddOnSelections(defs, [{ id: 'color', value: 'Royal' }]).error).toMatch(/Player number/);
    expect(checkout.priceAddOnSelections(defs, [{ id: 'num', value: '12' }, { id: 'color', value: 'Green' }]).error).toMatch(/invalid selection/i);
  });

  test('rejects non-numeric input for a number field', () => {
    const r = checkout.priceAddOnSelections(defs, [{ id: 'num', value: '12A' }, { id: 'color', value: 'Red' }]);
    expect(r.error).toMatch(/must be a number/i);
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

describe('coupon code matching', () => {
  test('escapes PostgREST ILIKE wildcard characters so codes match literally', () => {
    expect(checkout.escapeIlikeLiteral('TEAM%_\\VIP')).toBe('TEAM\\%\\_\\\\VIP');
    expect(checkout.escapeIlikeLiteral('save10')).toBe('save10');
  });

  test('passes the escaped literal to ILIKE and fails closed on a lookup error', async () => {
    let pattern = null;
    const result = { data: null, error: { message: 'temporary database error' } };
    const chain = {
      select: () => chain, eq: () => chain, limit: () => chain,
      ilike: (_column, value) => { pattern = value; return chain; },
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    const r = await checkout.loadCoupon({ from: () => chain }, { id: 's1' }, 'TEAM%_VIP');
    expect(pattern).toBe('TEAM\\%\\_VIP');
    expect(r.error).toMatch(/could not verify that coupon/i);
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

describe('checkStock — demand for the same product+size is summed across cart lines', () => {
  const store = { id: 's1' };
  const sfRow = (over) => ({ webstore_product_id: 'wp1', name: 'Tee', size_stock: { M: 5 }, vendor_size_stock: {}, on_order_qty: 0, earliest_eta: null, vendor_eta: null, track_inventory: true, inventory_source: 'adidas', ...over });
  const sb = (row) => fakeSb({ webstore_storefront_products: { data: [row], error: null } });

  test('two lines that individually fit but sum past availability are rejected as sold out', async () => {
    const lines = [
      { kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 3 },
      { kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 3 },
    ];
    // Each line alone (3) is well under the 5 in stock — only the combined
    // demand (6) oversells. A per-line check would wrongly let this through.
    const r = await checkout.checkStock(sb(sfRow()), store, lines);
    expect(r.error).toMatch(/sold out/i);
    expect(r.error).toContain('Tee (size M)');
    expect(r.holds).toEqual([]);
  });

  test('sanity check: the same total (5) as a single line passes and produces one merged hold', async () => {
    const r = await checkout.checkStock(sb(sfRow()), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 5 }]);
    expect(r.error).toBeNull();
    expect(r.holds).toEqual([{ webstore_product_id: 'wp1', size: 'M', qty: 5, max_avail: 5, label: 'Tee (size M)' }]);
  });

  test('fails closed when current inventory cannot be loaded', async () => {
    const client = fakeSb({ webstore_storefront_products: { data: null, error: { message: 'temporary database error' } } });
    const r = await checkout.checkStock(client, store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 1 }]);
    expect(r.error).toMatch(/could not verify inventory/i);
    expect(r.holds).toEqual([]);
  });

  test('fails closed when an expected storefront inventory row is missing', async () => {
    const r = await checkout.checkStock(fakeSb({ webstore_storefront_products: { data: [], error: null } }), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 1 }]);
    expect(r.error).toMatch(/could not verify inventory/i);
  });

  test('backorder against a KNOWN incoming qty is capped at on-hand + on-order', async () => {
    // 5 on hand + 10 on order = 15 sellable; 12 passes (no hold — backorder), 16 blocks.
    const okR = await checkout.checkStock(sb(sfRow({ on_order_qty: 10 })), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 12 }]);
    expect(okR.error).toBeNull();
    expect(okR.holds).toEqual([]);
    const bigR = await checkout.checkStock(sb(sfRow({ on_order_qty: 10 })), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 16 }]);
    expect(bigR.error).toMatch(/sold out/i);
  });

  test('ETA-only incoming signal (no qty) keeps the uncapped backorder allowance', async () => {
    const r = await checkout.checkStock(sb(sfRow({ earliest_eta: '2026-09-01' })), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 200 }]);
    expect(r.error).toBeNull();
    expect(r.holds).toEqual([]);
  });

  test('backorder cap is CUMULATIVE: open ledger claims on unfinished SOs shrink the sellable pool', async () => {
    // 5 on hand + 10 on order = 15 gross, but 8 units are already promised to
    // an earlier open order (needs ledger) → 7 truly sellable. 12 must block.
    const client = fakeSb({
      webstore_storefront_products: { data: [sfRow({ product_id: 'p1', on_order_qty: 10 })], error: null },
      teamshop_auto_po_needs: { data: [{ product_id: 'p1', size: 'M', qty_needed: 8, so_id: 'SO-1' }], error: null },
      sales_orders: { data: [{ id: 'SO-1', status: 'need_order' }], error: null },
    });
    const r = await checkout.checkStock(client, store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 12 }]);
    expect(r.error).toMatch(/sold out/i);
  });

  test('claims on a FINISHED SO no longer count against the pool', async () => {
    const client = fakeSb({
      webstore_storefront_products: { data: [sfRow({ product_id: 'p1', on_order_qty: 10 })], error: null },
      teamshop_auto_po_needs: { data: [{ product_id: 'p1', size: 'M', qty_needed: 8, so_id: 'SO-1' }], error: null },
      sales_orders: { data: [{ id: 'SO-1', status: 'completed' }], error: null },
    });
    const r = await checkout.checkStock(client, store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 12 }]);
    expect(r.error).toBeNull();
    expect(r.holds).toEqual([]);
  });

  test('fails closed when existing backorder claims cannot be loaded', async () => {
    const client = fakeSb({
      webstore_storefront_products: { data: [sfRow({ product_id: 'p1', on_order_qty: 10 })], error: null },
      teamshop_auto_po_needs: { data: null, error: { message: 'temporary database error' } },
    });
    const r = await checkout.checkStock(client, store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' }, qty: 6 }]);
    expect(r.error).toMatch(/could not verify inventory/i);
    expect(r.holds).toEqual([]);
  });
});

describe('checkSizesRequired — a sized item must carry a size', () => {
  const store = { id: 's1' };
  const viewRow = (over) => ({ webstore_product_id: 'wp1', name: 'Team Tee', available_sizes: ['S', 'M', 'L'], sizes_offered: null, ...over });
  const sb = (row) => fakeSb({ webstore_storefront_products: { data: [row], error: null } });

  test('passes when every single line has a size', async () => {
    const r = await checkout.checkSizesRequired(sb(viewRow()), store, [{ kind: 'single', size: 'M', wp: { id: 'wp1' } }]);
    expect(r).toBeNull();
  });
  test('rejects a sized product added with no size (sold-out-but-addable bug / tampered cart)', async () => {
    const r = await checkout.checkSizesRequired(sb(viewRow()), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toMatch(/choose a size/i);
    expect(r).toMatch(/Team Tee/);
  });
  test('allows a genuinely one-size item (no scale, no offered sizes)', async () => {
    const r = await checkout.checkSizesRequired(sb(viewRow({ available_sizes: [], sizes_offered: [] })), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toBeNull();
  });
  test('requires a size when only sizes_offered is set (rep-added footwear sizing)', async () => {
    const r = await checkout.checkSizesRequired(sb(viewRow({ available_sizes: null, sizes_offered: ['8', '9', '10'] })), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toMatch(/choose a size/i);
  });
  test('fails closed on a lookup error rather than accepting an unverifiable sizeless line', async () => {
    const sbErr = fakeSb({ webstore_storefront_products: { data: null, error: { message: 'boom' } } });
    const r = await checkout.checkSizesRequired(sbErr, store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toMatch(/could not verify inventory/i);
  });
  // An empty catalog scale used to read as "one-size" here, so a sizeless line for one of
  // the ~1,100 empty-scale CLICK styles sailed through and became an unfulfillable order
  // line. The storefront now derives those sizes from stock (storeInventory's scaleOf);
  // this guard has to see the same product as sized.
  test('rejects a sizeless line when the scale is empty but warehouse stock has sizes', async () => {
    const row = viewRow({ available_sizes: [], sizes_offered: null, size_stock: { S: 21, M: 102, L: 57 } });
    const r = await checkout.checkSizesRequired(sb(row), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toMatch(/choose a size/i);
  });
  test('rejects a sizeless line when only vendor (drop-ship) stock carries the sizes', async () => {
    const row = viewRow({ available_sizes: [], sizes_offered: null, vendor_size_stock: { M: 4, L: 9 } });
    const r = await checkout.checkSizesRequired(sb(row), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toMatch(/choose a size/i);
  });
  test('still allows a one-size item whose stock map is keyed by its single label', async () => {
    // A real OSFA cap has a scale, so it never reaches the derived path — but an empty
    // scale with a genuinely empty stock map must stay addable without a size.
    const row = viewRow({ available_sizes: [], sizes_offered: [], size_stock: {}, vendor_size_stock: null });
    const r = await checkout.checkSizesRequired(sb(row), store, [{ kind: 'single', size: null, wp: { id: 'wp1' } }]);
    expect(r).toBeNull();
  });
  test('ignores bundle lines (their component sizes are checked in priceCart)', async () => {
    const r = await checkout.checkSizesRequired(sb(viewRow()), store, [{ kind: 'bundle', components: [] }]);
    expect(r).toBeNull();
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
    expect(r.feeBase).toBe(40);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].qty).toBe(2);
    expect(r.lines[0].unit_price).toBe(20);
  });

  test('adds the per-size upcharge published by the storefront view', async () => {
    const r = await checkout.priceCart(sb(), store, [{ webstore_product_id: 'wp1', size: '2XL', qty: 1 }]);
    expect(r.lines[0].unit_price).toBe(24);
    expect(r.subtotal).toBe(24);
  });

  test('validates and prices configured add-on answers server-side', async () => {
    const product = { ...wpTee, options: [{ id: 'nick', label: 'Player nickname', kind: 'text', required: true, upcharge: 4 }] };
    const r = await checkout.priceCart(sb({ webstore_products: { data: [product], error: null } }), store, [{ webstore_product_id: 'wp1', size: 'M', qty: 2, option_selections: [{ id: 'nick', value: 'Ace', upcharge: 999 }] }]);
    expect(r.error).toBeUndefined();
    expect(r.lines[0].unit_price).toBe(24);
    expect(r.lines[0].option_extra).toBe(4);
    expect(r.lines[0].option_selections[0]).toMatchObject({ label: 'Player nickname', value: 'Ace', upcharge: 4 });
    expect(r.subtotal).toBe(48);
    expect(r.feeBase).toBe(48);
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

describe('priceCart — name fees are NSA revenue, not fundraising', () => {
  const store = { id: 's1', fundraise_enabled: false };
  const fStore = { id: 's1', fundraise_enabled: true, fundraise_pct: 10 };
  const wpNamed = { id: 'wp1', store_id: 's1', kind: 'single', retail_price: 20, active: true, takes_name: true, takes_number: false, name_upcharge: 5, display_name: 'Tee', variant_label: null, image_url: null };
  const sb = (extra = {}) => fakeSb({
    webstore_products: { data: [wpNamed], error: null },
    webstore_storefront_products: { data: [{ webstore_product_id: 'wp1', size_upcharges: { '2XL': 4 } }], error: null },
    webstore_bundle_items: { data: [], error: null },
    ...extra,
  });

  test('name fee rides on subtotal/unit_price when a name is entered', async () => {
    const r = await checkout.priceCart(sb(), fStore, [{ webstore_product_id: 'wp1', size: 'M', qty: 2, player_name: 'Bo' }]);
    expect(r.error).toBeUndefined();
    expect(r.subtotal).toBe(50); // (20 + 5) * 2
    expect(r.fundraise).toBe(4); // 2 * 2, name fee excluded
    expect(r.feeBase).toBe(40); // retail + size only, no name fee
    expect(r.lines[0].name_extra).toBe(5);
    expect(r.lines[0].unit_price).toBe(20);
  });

  test('no player_name entered — no name fee anywhere', async () => {
    const r = await checkout.priceCart(sb(), fStore, [{ webstore_product_id: 'wp1', size: 'M', qty: 2 }]);
    expect(r.subtotal).toBe(40);
    expect(r.fundraise).toBe(4);
    expect(r.lines[0].name_extra).toBe(0);
  });

  test('regression guard: fundraise excludes the name fee', async () => {
    // Old code did `fundraise += fundAmt + nameExtra`, which folded the NSA
    // name-personalization fee into the club payout — inflating fundraise_cost,
    // the club-SO conversion, and the store close-out by the name fee. The
    // fundraise total here must be pure store/item fundraising with no name fee.
    const r = await checkout.priceCart(sb(), fStore, [{ webstore_product_id: 'wp1', size: 'M', qty: 2, player_name: 'Bo' }]);
    const fundraiseWithOldBug = 4 + r.lines[0].name_extra * 2; // what the buggy code would have produced
    expect(r.fundraise).toBe(4);
    expect(r.fundraise).not.toBe(fundraiseWithOldBug);
  });

  test('invariant: subtotal + fundraise still equals the full merchandise total', async () => {
    const r = await checkout.priceCart(sb(), fStore, [{ webstore_product_id: 'wp1', size: 'M', qty: 2, player_name: 'Bo' }]);
    expect(checkout.r2(r.subtotal + r.fundraise)).toBe(checkout.r2((20 + 5 + 2) * 2));
  });

  test('bundle: per-item fundraise_amount override plus a named component', async () => {
    const wpBundle = { id: 'wpB', store_id: 's1', kind: 'bundle', retail_price: 60, fundraise_amount: 8, active: true, takes_name: false, takes_number: false, name_upcharge: 0, display_name: 'Bundle', variant_label: null, image_url: null };
    const compRow = { bundle_id: 'wpB', product_id: 'c1', sku: 'S1', size_required: true, takes_name: true, takes_number: false, name_upcharge: 6, sort_order: 1 };
    const sbBundle = fakeSb({
      webstore_products: { data: [wpBundle], error: null },
      webstore_storefront_products: { data: [], error: null },
      webstore_bundle_items: { data: [compRow], error: null },
    });
    const r = await checkout.priceCart(sbBundle, store, [{ webstore_product_id: 'wpB', qty: 5, components: [{ product_id: 'c1', size: 'M', player_name: 'Bo' }] }]);
    expect(r.error).toBeUndefined();
    expect(r.subtotal).toBe(66); // 60 retail + 6 name fee
    expect(r.fundraise).toBe(8); // per-item override, name fee excluded
    expect(r.feeBase).toBe(60);
    expect(r.lines[0].name_extra).toBe(6);
    expect(r.lines[0].qty).toBe(1); // bundle qty is always forced to 1
  });

  test('size upcharge stays in feeBase alongside a name fee', async () => {
    const r = await checkout.priceCart(sb(), store, [{ webstore_product_id: 'wp1', size: '2XL', qty: 1, player_name: 'Bo' }]);
    expect(r.feeBase).toBe(24); // 20 retail + 4 size upcharge, no name fee
    expect(r.subtotal).toBe(29); // 24 + 5 name fee
  });
});

describe('priceCart — bundle component qty is catalog-authoritative (fulfillment, not money)', () => {
  const store = { id: 's1', fundraise_enabled: false };
  const wpBundle = { id: 'wpB', store_id: 's1', kind: 'bundle', retail_price: 60, fundraise_amount: 0, active: true, takes_name: false, takes_number: false, name_upcharge: 0, display_name: 'Bundle', variant_label: null, image_url: null };

  test('a "2×" component carries qty 2 from webstore_bundle_items, not the client', async () => {
    // The pack still checks out as ONE unit at the parent's $60, but the jersey line
    // must report qty 2 so batch demand / transfers / rosters don't undercount.
    const compRow = { bundle_id: 'wpB', product_id: 'c1', sku: 'S1', size_required: true, takes_name: false, takes_number: false, name_upcharge: 0, qty: 2, sort_order: 1 };
    const sb = fakeSb({
      webstore_products: { data: [wpBundle], error: null },
      webstore_storefront_products: { data: [], error: null },
      webstore_bundle_items: { data: [compRow], error: null },
    });
    // Client omits qty entirely — the catalog value is authoritative.
    const r = await checkout.priceCart(sb, store, [{ webstore_product_id: 'wpB', qty: 1, components: [{ product_id: 'c1', size: 'M' }] }]);
    expect(r.error).toBeUndefined();
    expect(r.lines[0].components[0].qty).toBe(2);
    expect(r.subtotal).toBe(60); // money unchanged — the $60 is on the parent at qty 1
    expect(r.fundraise).toBe(0);
  });

  test('a missing/invalid catalog qty defaults to 1', async () => {
    const compRow = { bundle_id: 'wpB', product_id: 'c1', sku: 'S1', size_required: true, takes_name: false, takes_number: false, name_upcharge: 0, sort_order: 1 };
    const sb = fakeSb({
      webstore_products: { data: [wpBundle], error: null },
      webstore_storefront_products: { data: [], error: null },
      webstore_bundle_items: { data: [compRow], error: null },
    });
    const r = await checkout.priceCart(sb, store, [{ webstore_product_id: 'wpB', qty: 1, components: [{ product_id: 'c1', size: 'M' }] }]);
    expect(r.lines[0].components[0].qty).toBe(1);
  });
});

describe('buildOrderItems — persisted money matches checkout pricing', () => {
  test('stores bundle option and name upcharges on the paid parent row', () => {
    const lines = [{
      kind: 'bundle', unit_price: 60, name_extra: 6, option_extra: 4, fundraise: 8,
      option_selections: [{ id: 'patch', value: true, upcharge: 4 }],
      wp: { id: 'wpB' }, name: 'Bundle', image: null,
      components: [{ product_id: 'p1', sku: 'SKU1', size: 'M', qty: 1, player_name: null, player_number: null, name: 'Tee', image: null }],
    }];
    const items = checkout.buildOrderItems(lines, 'Player Name', () => 'bundle-ref');
    expect(items[0]).toMatchObject({ is_bundle_parent: true, unit_price: 70, unit_fundraise: 8, bundle_ref: 'bundle-ref' });
    expect(items[0].add_on_selections).toEqual(lines[0].option_selections);
    expect(items[1]).toMatchObject({ is_bundle_parent: false, unit_price: 0, player_name: 'Player Name', bundle_ref: 'bundle-ref' });
  });

  test('does not double-count a single-item option upcharge already included in unit_price', () => {
    const items = checkout.buildOrderItems([{
      kind: 'single', unit_price: 24, name_extra: 5, option_extra: 4, fundraise: 2,
      wp: { product_id: 'p1', sku: 'SKU1' }, size: 'M', qty: 2,
      player_name: null, player_number: null, option_selections: [], name: 'Tee', color: null, variant_label: null, image: null,
    }], 'Player Name', () => 'unused');
    expect(items[0].unit_price).toBe(29);
  });
});

describe('priceCart — cart-size cap and qty tampering', () => {
  const store = { id: 's1', fundraise_enabled: false };
  const wpTee = { id: 'wp1', store_id: 's1', kind: 'single', retail_price: 20, active: true, takes_name: false, takes_number: false, name_upcharge: 0, display_name: 'Tee', variant_label: null, image_url: null };
  const sb = () => fakeSb({
    webstore_products: { data: [wpTee], error: null },
    webstore_storefront_products: { data: [], error: null },
    webstore_bundle_items: { data: [], error: null },
  });
  const line = (over) => ({ webstore_product_id: 'wp1', size: 'M', qty: 1, ...over });

  test('a 61-line cart is rejected as too large', async () => {
    const cart = Array.from({ length: 61 }, () => line());
    const r = await checkout.priceCart(sb(), store, cart);
    expect(r.error).toMatch(/cart too large/i);
    expect(r.lines).toBeUndefined();
  });

  test('a 60-line cart (the boundary) is accepted', async () => {
    const cart = Array.from({ length: 60 }, () => line());
    const r = await checkout.priceCart(sb(), store, cart);
    expect(r.error).toBeUndefined();
    expect(r.lines).toHaveLength(60);
    expect(r.subtotal).toBe(1200); // 60 * $20
  });

  test('qty tampering clamps into [1, 100] with truncation, never trusting the raw client value', async () => {
    const cases = [
      [-5, 1],      // negative → floor of 1
      [0, 1],       // zero is falsy in the `|| 1` fallback → floor of 1
      ['abc', 1],   // non-numeric → NaN → floor of 1
      [2.9, 2],     // fractional → parseInt truncates, no rounding up
      [99999, 100], // absurd qty → ceiling of 100
    ];
    for (const [raw, expected] of cases) {
      const r = await checkout.priceCart(sb(), store, [line({ qty: raw })]);
      expect(r.error).toBeUndefined();
      expect(r.lines[0].qty).toBe(expected);
    }
  });
});
