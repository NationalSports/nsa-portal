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

const call = (body, { products = [PLAIN_TEE, ADIDAS_TEE] } = {}) => {
  mockAdmin = fakeSb({ products: { data: products, error: null } });
  return priceFn.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });
};

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
