/* Unit tests for the coach-facing quick-order quote function.
 *
 * Pricing is the money path: the browser never sets a price, so every dollar is
 * recomputed server-side. These drive the exported handler + helpers with a fake
 * supabase admin client (same stub style as webstoreCheckout.test.js), with
 * _shared mocked so getSupabaseAdmin never needs real credentials. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const quote = require('../../netlify/functions/quickorder-quote');
const DECO = require('../lib/decoPricing');

// Minimal chainable supabase stub: from(table) returns a thenable whose query
// methods are no-ops; maybeSingle resolves the first canned row. auth.getUser
// resolves the canned user.
function fakeSb(tables, user) {
  return {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
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

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: null, auth_user_id: 'auth1' };
const CUST = { id: 'cust1', name: 'Central High', adidas_ua_tier: 'A', catalog_markup: null };
const ADIDAS_TEE = { id: 'p1', sku: 'ADI-1', name: 'Adidas Tee', brand: 'Adidas', category: 'Apparel', retail_price: 40, catalog_sell_price: null, pricing_group: null, nsa_cost: 15, is_clearance: false, clearance_cost: null };
const PLAIN_TEE = { id: 'p2', sku: 'PC61', name: 'Port Tee', brand: 'Port & Company', category: 'Apparel', retail_price: 10, catalog_sell_price: null, pricing_group: null, nsa_cost: 4, is_clearance: false, clearance_cost: null };

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [{ customer_id: 'cust1' }], error: null },
  customers: { data: [CUST], error: null },
  products: { data: [ADIDAS_TEE, PLAIN_TEE], error: null },
  ...over,
});

const call = (body, { user = { id: 'auth1', email: 'coach@team.com' }, tables = baseTables(), auth = 'Bearer tok' } = {}) => {
  mockAdmin = fakeSb(tables, user);
  return quote.handler({ httpMethod: 'POST', headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
};

describe('auth gating', () => {
  test('rejects a missing bearer token', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] }, { auth: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] }, { user: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects a signed-in user with no coach account', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('rejects a disabled coach account', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [{ ...COACH, status: 'disabled' }], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('rejects a coach without access to the customer', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 1 }] },
      { tables: baseTables({ coach_customer_access: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
    expect(JSON.parse(r.body).error).toMatch(/authorized/i);
  });

  test("the coach account's own customer_id grants access without an access row", async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 1 }] },
      { tables: baseTables({ coach_accounts: { data: [{ ...COACH, customer_id: 'cust1' }], error: null }, coach_customer_access: { data: [], error: null } }) });
    expect(r.statusCode).toBe(200);
  });
});

describe('quote pricing', () => {
  test('prices an adidas item at the tier discount off retail (tier A = 40%)', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 12 }] });
    expect(r.statusCode).toBe(200);
    const q = JSON.parse(r.body).quote;
    expect(q.tier).toBe('A');
    expect(q.lines[0].unit_sell).toBe(24); // 40 × (1 − 0.40)
    expect(q.lines[0].line_total).toBe(288);
    expect(q.subtotal).toBe(288);
  });

  test('prices a non-AU item at cost × default 1.65 markup', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 10 }] });
    const q = JSON.parse(r.body).quote;
    expect(q.lines[0].unit_sell).toBe(DECO.rQ(4 * 1.65)); // 6.6 → rQ
    expect(q.subtotal).toBe(DECO.rQ(4 * 1.65) * 10);
  });

  test('catalog_sell_price wins for a non-AU item', async () => {
    const tables = baseTables({ products: { data: [{ ...PLAIN_TEE, catalog_sell_price: 18 }], error: null } });
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 2 }] }, { tables });
    expect(JSON.parse(r.body).quote.lines[0].unit_sell).toBe(18);
  });

  test('screen print decoration prices at the default tables via decoPricing.dP', async () => {
    const qty = 24;
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty, decorations: [{ type: 'screen_print', colors: 2 }] }] });
    const q = JSON.parse(r.body).quote;
    const expected = DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, qty).sell;
    expect(q.lines[0].decorations[0].unit_sell).toBe(Math.round(expected * 100) / 100);
    expect(q.lines[0].line_total).toBe(Math.round((q.lines[0].unit_sell + q.lines[0].decorations[0].unit_sell) * qty * 100) / 100);
  });

  test('a coach-supplied sell_override is stripped (never trusted)', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 24, decorations: [{ type: 'screen_print', colors: 2, sell_override: 0.01 }] }] });
    const q = JSON.parse(r.body).quote;
    const expected = DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2 }, 24).sell;
    expect(q.lines[0].decorations[0].unit_sell).toBe(Math.round(expected * 100) / 100);
  });

  test('rejects an unknown decoration type', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'p2', qty: 5, decorations: [{ type: 'outside_deco', sell_each: 1 }] }] });
    expect(r.statusCode).toBe(400);
  });

  test('rejects an unknown product', async () => {
    const r = await call({ customer_id: 'cust1', lines: [{ product_id: 'nope', qty: 1 }] });
    expect(r.statusCode).toBe(409);
  });

  test('rejects an empty line set', async () => {
    const r = await call({ customer_id: 'cust1', lines: [] });
    expect(r.statusCode).toBe(400);
  });
});

describe('quote hash', () => {
  test('is deterministic for the same lines and changes when the cart changes', async () => {
    const body = { customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 12 }] };
    const h1 = JSON.parse((await call(body)).body).quote.hash;
    const h2 = JSON.parse((await call(body)).body).quote.hash;
    const h3 = JSON.parse((await call({ customer_id: 'cust1', lines: [{ product_id: 'p1', qty: 13 }] })).body).quote.hash;
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
