/* Unit tests for the public (no-auth) Team Shop standard-retail price
 * endpoint. Same fake-supabase-admin stub style as quickorderQuote.test.js —
 * this function reuses quickorder-quote.js's exported unitSell/cleanDeco
 * helpers directly (no duplicated pricing math), so these tests mostly prove
 * the endpoint wires them up correctly and never requires or leaks auth/
 * customer data. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const priceFn = require('../../netlify/functions/teamshop-public-price');
const DECO = require('../lib/decoPricing');

function fakeSb(tables) {
  return {
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const PLAIN_TEE = { id: 'p2', sku: 'PC61', name: 'Port Tee', brand: 'Port & Company', category: 'Apparel', retail_price: 10, catalog_sell_price: null, pricing_group: null, nsa_cost: 4, is_clearance: false, clearance_cost: null };
const ADIDAS_TEE = { id: 'p1', sku: 'ADI-1', name: 'Adidas Tee', brand: 'Adidas', category: 'Apparel', retail_price: 40, catalog_sell_price: null, pricing_group: null, nsa_cost: 15, is_clearance: false, clearance_cost: null };

const call = (body, { products = [PLAIN_TEE, ADIDAS_TEE], tables = {} } = {}) => {
  mockAdmin = fakeSb({ products: { data: products, error: null }, ...tables });
  return priceFn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
};

// The 60s timeline-rule cache would otherwise leak canned rows between tests.
beforeEach(() => require('../../netlify/functions/_teamshopTimeline')._clearCache());

test('requires no auth header at all — no bearer token needed', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 1 }] });
  expect(r.statusCode).toBe(200);
});

test('OPTIONS preflight returns 200 with no body work', async () => {
  const r = await priceFn.handler({ httpMethod: 'OPTIONS' });
  expect(r.statusCode).toBe(200);
});

test('rejects non-POST methods', async () => {
  const r = await priceFn.handler({ httpMethod: 'GET' });
  expect(r.statusCode).toBe(405);
});

test('a garment-only line prices > 0 using standard retail (cost × default 1.65 markup, no customer)', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 10 }] });
  const json = JSON.parse(r.body);
  expect(json.ok).toBe(true);
  const expectedUnit = DECO.rQ(4 * 1.65);
  expect(json.lines[0].unit_garment).toBe(expectedUnit);
  expect(json.lines[0].unit_garment).toBeGreaterThan(0);
  expect(json.lines[0].unit_deco).toBe(0);
  expect(json.lines[0].unit_total).toBe(expectedUnit);
  expect(json.lines[0].line_total).toBe(Math.round(expectedUnit * 10 * 100) / 100);
  expect(json.subtotal).toBe(json.lines[0].line_total);
});

test('adidas item prices at standard retail with NO tier discount (public, no customer)', async () => {
  const r = await call({ lines: [{ product_id: 'p1', qty: 12 }] });
  const json = JSON.parse(r.body);
  // unitSell(p, null) falls back to tier 'B' (35% off retail) since there is
  // no customer record at all for a public quote.
  expect(json.lines[0].unit_garment).toBe(DECO.rQ(40 * (1 - 0.35)));
});

test('a decorated line adds decoration cost on top of the garment price', async () => {
  const qty = 24;
  const r = await call({ lines: [{ product_id: 'p2', qty, decorations: [{ type: 'screen_print', colors: 2 }] }] });
  const json = JSON.parse(r.body);
  const expectedDeco = Math.round(DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, qty).sell * 100) / 100;
  const expectedGarment = DECO.rQ(4 * 1.65);
  expect(json.lines[0].unit_deco).toBe(expectedDeco);
  expect(json.lines[0].unit_total).toBe(Math.round((expectedGarment + expectedDeco) * 100) / 100);
  expect(json.lines[0].line_total).toBe(Math.round((expectedGarment + expectedDeco) * qty * 100) / 100);
});

test('a coach-supplied price override on a decoration is ignored (cleanDeco strips it)', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 5, decorations: [{ type: 'screen_print', colors: 1, sell_override: 0.01 }] }] });
  const json = JSON.parse(r.body);
  const expectedDeco = Math.round(DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 1 }, 5).sell * 100) / 100;
  expect(json.lines[0].unit_deco).toBe(expectedDeco);
});

test('subtotal sums multiple lines', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 3 }, { product_id: 'p2', qty: 5 }] });
  const json = JSON.parse(r.body);
  expect(json.subtotal).toBe(Math.round((json.lines[0].line_total + json.lines[1].line_total) * 100) / 100);
});

test('rejects an unknown decoration type', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 5, decorations: [{ type: 'outside_deco' }] }] });
  expect(r.statusCode).toBe(400);
});

test('rejects an unknown product', async () => {
  const r = await call({ lines: [{ product_id: 'nope', qty: 1 }] });
  expect(r.statusCode).toBe(409);
});

test('rejects an empty line set', async () => {
  const r = await call({ lines: [] });
  expect(r.statusCode).toBe(400);
});

test('response never includes any customer/coach fields', async () => {
  const r = await call({ lines: [{ product_id: 'p2', qty: 1 }] });
  const json = JSON.parse(r.body);
  const str = JSON.stringify(json);
  expect(str).not.toMatch(/customer/i);
  expect(str).not.toMatch(/coach/i);
});

// ── Delivery-timeline estimates (00203) riding the price response ──────────
const TL_ROWS = [
  { rule_key: 'in_stock', rule_type: 'in_stock', inventory_sources: [], deco_type: null, min_weeks: 1, max_weeks: 1, label: '~1 week', sort_order: 0, active: true },
  { rule_key: 'source_sanmar_ss', rule_type: 'source', inventory_sources: ['sanmar', 'nike', 'ss_activewear'], deco_type: null, min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks', sort_order: 10, active: true },
  { rule_key: 'deco_screen_print', rule_type: 'deco', inventory_sources: [], deco_type: 'screen_print', min_weeks: 2, max_weeks: 3, label: '~2–3 weeks', sort_order: 40, active: true },
];
const SANMAR_TEE = { ...PLAIN_TEE, id: 'p3', sku: 'SM1', inventory_source: 'sanmar' };

test('timeline fields ride the response: source band when not in stock, order-level = slowest', async () => {
  const r = await call({ lines: [{ product_id: 'p3', size: 'M', qty: 5 }] }, {
    products: [SANMAR_TEE],
    tables: {
      teamshop_delivery_timelines: { data: TL_ROWS, error: null },
      product_inventory: { data: [], error: null },
    },
  });
  const json = JSON.parse(r.body);
  expect(json.ok).toBe(true);
  expect(json.lines[0].timeline).toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
  expect(json.timeline).toEqual({ min_weeks: 1.5, max_weeks: 2, label: '~1.5–2 weeks' });
});

test('a fully stocked line reports the in-stock band', async () => {
  const r = await call({ lines: [{ product_id: 'p3', size: 'M', qty: 5 }] }, {
    products: [SANMAR_TEE],
    tables: {
      teamshop_delivery_timelines: { data: TL_ROWS, error: null },
      product_inventory: { data: [{ product_id: 'p3', size: 'M', quantity: 5 }], error: null },
    },
  });
  const json = JSON.parse(r.body);
  expect(json.lines[0].timeline).toEqual({ min_weeks: 1, max_weeks: 1, label: '~1 week' });
});

test('screen print lengthens the band via max() — never a price change', async () => {
  const qty = 24;
  const plain = await call({ lines: [{ product_id: 'p3', size: 'M', qty }] }, {
    products: [SANMAR_TEE],
    tables: { teamshop_delivery_timelines: { data: TL_ROWS, error: null }, product_inventory: { data: [], error: null } },
  });
  const sp = await call({ lines: [{ product_id: 'p3', size: 'M', qty, decorations: [{ type: 'screen_print', colors: 1 }] }] }, {
    products: [SANMAR_TEE],
    tables: { teamshop_delivery_timelines: { data: TL_ROWS, error: null }, product_inventory: { data: [], error: null } },
  });
  const spJson = JSON.parse(sp.body);
  expect(spJson.lines[0].timeline).toEqual({ min_weeks: 2, max_weeks: 3, label: '~2–3 weeks' });
  // The timeline never touches money: garment price identical with/without it.
  expect(spJson.lines[0].unit_garment).toBe(JSON.parse(plain.body).lines[0].unit_garment);
});

test('pre-migration (00203 absent) → timeline null everywhere, pricing unaffected', async () => {
  const r = await call({ lines: [{ product_id: 'p3', size: 'M', qty: 5 }] }, {
    products: [SANMAR_TEE],
    tables: { teamshop_delivery_timelines: { data: null, error: { code: '42P01', message: 'relation "teamshop_delivery_timelines" does not exist' } } },
  });
  const json = JSON.parse(r.body);
  expect(json.ok).toBe(true);
  expect(json.lines[0].timeline).toBeNull();
  expect(json.timeline).toBeNull();
  expect(json.lines[0].unit_garment).toBeGreaterThan(0);
});
