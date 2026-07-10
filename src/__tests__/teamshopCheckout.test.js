/* Team Shop checkout (Stage 6) — the money path.
 *
 * teamshop-checkout.js must never price anything itself: quotes/hashes come
 * from quickorder-quote's exports, tax/shipping/rollback/idempotency from
 * webstore-checkout's. These tests drive the exported quoteTotals/placeOrder
 * with a scripted fake supabase (same style as webstoreCheckoutIdempotency),
 * a mocked stripe module, and spies on the reused webstore-checkout helpers.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_123';

jest.mock('stripe', () => {
  const paymentIntents = { create: jest.fn(), retrieve: jest.fn() };
  // Plain function, NOT jest.fn(): react-scripts runs jest with resetMocks,
  // which would wipe a mock factory's implementation before every test and
  // make stripe(sk) return undefined. The inner jest.fn()s are re-primed in
  // beforeEach, so resetMocks is harmless to them.
  const factory = (key) => ({ paymentIntents });
  factory.__pi = paymentIntents;
  return factory;
});
jest.mock('../../netlify/functions/_webstoreEmail', () => ({
  sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
  bumpCouponUse: jest.fn().mockResolvedValue(undefined),
}));

const stripeMock = require('stripe');
const ts = require('../../netlify/functions/teamshop-checkout');
const qq = require('../../netlify/functions/quickorder-quote');
const ws = require('../../netlify/functions/webstore-checkout');
const DECO = require('../lib/decoPricing');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Scripted fake supabase: results are consumed in order per "table.op" (or
// "rpc.<fn>") key; every call is recorded so tests can assert what was (not)
// written. maybeSingle resolves the scripted result as-is (script an object).
function fakeSb(script) {
  const calls = [];
  const nextResult = (key, call) => {
    const queue = script[key] || [];
    const result = queue.length ? queue.shift() : { data: [], error: null };
    call.result = result;
    return result;
  };
  return {
    calls,
    rpc(fn, args) {
      const call = { table: fn, op: 'rpc', payload: args };
      calls.push(call);
      return Promise.resolve(nextResult('rpc.' + fn, call));
    },
    from(table) {
      const call = { table, op: 'select', filters: [], payload: null };
      calls.push(call);
      const chain = {
        select: () => chain,
        eq: (col, val) => { call.filters.push([col, val]); return chain; },
        neq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain, single: () => chain,
        maybeSingle: () => Promise.resolve(nextResult(table + '.' + call.op, call)),
        insert: (payload) => { call.op = 'insert'; call.payload = payload; return chain; },
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        delete: () => { call.op = 'delete'; return chain; },
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}

const STORE = {
  id: 'st-ts', slug: 'nationalteamshop', name: 'National Team Shop', status: 'open',
  payment_mode: 'paid', delivery_mode: 'ship_home', flat_shipping: 5, processing_pct: 0,
};
const CUST = { id: 'custA', name: 'Central High', adidas_ua_tier: 'B', catalog_markup: null };
const PROD = { id: 'p1', sku: 'TS1', name: 'Team Tee', brand: 'Port & Company', category: 'Apparel', retail_price: 10, catalog_sell_price: 20, pricing_group: null, nsa_cost: 8, is_clearance: false, clearance_cost: null };
const COACH = { id: 'coach1', email: 'coach@team.com', status: 'active', customer_id: 'custA' };
const LINES = [{
  product_id: 'p1', sku: 'TS1', size: 'AL', qty: 2, color: 'Black',
  decorations: [{ type: 'screen_print', colors: 2, underbase: false, placement: 'lc', side: 'front', x: 1, y: 2, w: 3, teamshop_logo_id: 'lg9' }],
}];
const CONTACT = { name: 'Coach Carter', email: 'coach@team.com', phone: '555' };
const SHIP = { street1: '1 Main St', street2: '', city: 'Fresno', state: 'CA', zip: '93703' };
const REF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const TAX = { tax: 1.23, rate: 0.1, state: 'CA', source: 'test' };

// Server-side expectations, derived through the same shared modules the
// function uses (never hardcoded dollar figures).
const DECO_SELL = r2(DECO.dP(DECO.DEFAULTS, { type: 'screen_print', colors: 2, underbase: false }, 2).sell);
const SUBTOTAL = r2((20 + DECO_SELL) * 2);
const TOTAL = r2(SUBTOTAL + STORE.flat_shipping + TAX.tax);

const quoteScript = () => ({
  'webstores.select': [{ data: [STORE], error: null }],
  'customers.select': [{ data: CUST, error: null }],
  'products.select': [{ data: [PROD], error: null }],
});
const NEW_ORDER = { id: 'ord1', store_id: 'st-ts', status: 'pending_payment', buyer_email: CONTACT.email, total: TOTAL, status_token: 'tok1', order_number: 1010001 };
const placeScript = () => ({
  ...quoteScript(),
  'webstore_orders.select': [{ data: [], error: null }], // clientRef dup check: no match
  'rpc.place_webstore_order': [{ data: { order: NEW_ORDER }, error: null }],
  'webstore_orders.update': [{ data: null, error: null }],
});
const placeBody = (extra) => ({ customer_id: 'custA', lines: LINES, contact: CONTACT, ship: SHIP, client_ref: REF, ...extra });

let calcTaxSpy;
beforeEach(() => {
  jest.clearAllMocks();
  calcTaxSpy = jest.spyOn(ws, 'calcTax').mockResolvedValue(TAX);
  stripeMock.__pi.create.mockResolvedValue({ id: 'pi_1', client_secret: 'cs_1' });
});
afterEach(() => { calcTaxSpy.mockRestore(); });

async function freshQuote() {
  const res = await ts.quoteTotals(fakeSb(quoteScript()), { customer_id: 'custA', lines: LINES, ship: SHIP }, COACH);
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

describe('quote_totals', () => {
  test('produces the IDENTICAL hash quickorder-quote produces for the same cart', async () => {
    const out = await freshQuote();
    const qqRes = await qq.buildQuote(fakeSb(quoteScript()), { customerId: 'custA', lines: LINES });
    expect(out.quote_hash).toBe(qqRes.quote.quote_hash);
    expect(out.quote.quote_hash).toBe(qqRes.quote.quote_hash);
    expect(out.quote.hash_version).toBe(qq.HASH_VERSION);
  });

  test('totals are server-recomputed: subtotal from the quote, shipping from the store, tax from calcTax', async () => {
    const out = await freshQuote();
    expect(out.totals).toEqual({ subtotal: SUBTOTAL, shipping: 5, tax: TAX.tax, tax_state: 'CA', total: TOTAL });
    expect(calcTaxSpy).toHaveBeenCalledWith(STORE, SHIP, SUBTOTAL, null);
  });

  test('stale quote_hash → 409 totals_changed with the fresh quote', async () => {
    const res = await ts.quoteTotals(fakeSb(quoteScript()), { customer_id: 'custA', lines: LINES, quote_hash: 'stale-hash' }, COACH);
    expect(res.statusCode).toBe(409);
    const out = JSON.parse(res.body);
    expect(out.code).toBe('totals_changed');
    expect(out.quote && out.quote.quote_hash).toBeTruthy();
    expect(out.quote.subtotal).toBe(SUBTOTAL);
  });

  test('coach without access to the customer → 403', async () => {
    const outsider = { ...COACH, id: 'coach2', customer_id: 'someOtherTeam' };
    const sb = fakeSb({ 'coach_customer_access.select': [{ data: null, error: null }] });
    const res = await ts.quoteTotals(sb, { customer_id: 'custA', lines: LINES }, outsider);
    expect(res.statusCode).toBe(403);
    // nothing else was even read
    expect(sb.calls.filter((c) => c.table === 'products')).toHaveLength(0);
  });
});

describe('place_order', () => {
  test('happy path: order row + items carry the Team Shop fields; Stripe charges the SERVER total', async () => {
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(placeScript());
    const res = await ts.placeOrder(sb, placeBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.clientSecret).toBe('cs_1');
    expect(out.intentId).toBe('pi_1');
    expect(out.order.id).toBe('ord1');
    expect(out.order.stripe_pi_id).toBe('pi_1');
    expect(out.totals.total).toBe(TOTAL);

    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    const o = rpcCall.payload.p_order;
    expect(o.order_source).toBe('teamshop');
    expect(o.coach_id).toBe('coach1');
    expect(o.customer_id).toBe('custA');
    expect(o.quote_hash).toBe(quote_hash);
    expect(o.client_ref).toBe(REF);
    expect(o.store_id).toBe('st-ts');
    expect(o.status).toBe('pending_payment');
    expect(o.payment_mode).toBe('paid');
    expect(o.subtotal).toBe(SUBTOTAL);
    expect(o.shipping_fee).toBe(5);
    expect(o.tax).toBe(TAX.tax);
    expect(o.total).toBe(TOTAL);
    // made-to-order: no claims, no holds
    expect(rpcCall.payload.p_claims).toEqual([]);
    expect(rpcCall.payload.p_holds).toEqual([]);

    // items: garment sell split from decoration sell, spec persisted as jsonb
    const item = rpcCall.payload.p_items[0];
    expect(item.unit_price).toBe(20);
    expect(item.unit_deco_price).toBe(DECO_SELL);
    expect(item.qty).toBe(2);
    expect(item.size).toBe('AL');
    expect(Array.isArray(item.decorations)).toBe(true);
    expect(item.decorations[0]).toMatchObject({ type: 'screen_print', colors: 2, placement: 'lc', side: 'front', teamshop_logo_id: 'lg9', unit_sell: DECO_SELL });

    // Stripe PaymentIntent: server amount, webstore idempotency pattern, teamshop metadata
    const [piArgs, piOpts] = stripeMock.__pi.create.mock.calls[0];
    expect(piArgs.amount).toBe(Math.round(TOTAL * 100));
    expect(piArgs.metadata).toEqual({ webstore_order_id: 'ord1', store_slug: 'nationalteamshop', source: 'nsa_teamshop' });
    expect(piOpts).toEqual({ idempotencyKey: 'wsorder_ord1' });
  });

  test('client-sent totals are ignored — the server total wins', async () => {
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(placeScript());
    const res = await ts.placeOrder(sb, placeBody({ quote_hash, totals: { total: 0.01 }, expectedTotalCents: 1, total: 0.01 }), COACH);
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    expect(rpcCall.payload.p_order.total).toBe(TOTAL);
    expect(stripeMock.__pi.create.mock.calls[0][0].amount).toBe(Math.round(TOTAL * 100));
  });

  test('quote drift (stale hash) → 409 totals_changed with a fresh quote, nothing written', async () => {
    const sb = fakeSb(placeScript());
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'stale-hash' }), COACH);
    expect(res.statusCode).toBe(409);
    const out = JSON.parse(res.body);
    expect(out.code).toBe('totals_changed');
    expect(out.quote.quote_hash).toBeTruthy();
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'insert')).toHaveLength(0);
    expect(stripeMock.__pi.create).not.toHaveBeenCalled();
  });

  test('replaying the same client_ref returns the SAME order without re-pricing or writing', async () => {
    const existing = { ...NEW_ORDER, id: 'ord-existing', status: 'paid', client_ref: REF, subtotal: SUBTOTAL, fundraise_amt: 0, shipping_fee: 5, processing_fee: 0, discount_amt: 0, tax: TAX.tax };
    const sb = fakeSb({
      'webstores.select': [{ data: [STORE], error: null }],
      'webstore_orders.select': [{ data: [existing], error: null }], // dup check hits
    });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'anything' }), COACH);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(out.order.id).toBe('ord-existing');
    expect(out.totals.total).toBe(TOTAL);
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'insert')).toHaveLength(0);
    expect(stripeMock.__pi.create).not.toHaveBeenCalled();
  });

  test('client_ref race inside the transaction replays the winner', async () => {
    const { quote_hash } = await freshQuote();
    const winner = { ...NEW_ORDER, id: 'ord-winner', status: 'paid', client_ref: REF };
    const sb = fakeSb({
      ...quoteScript(),
      'webstore_orders.select': [
        { data: [], error: null },       // dup pre-check: nothing yet
        { data: [winner], error: null }, // post-conflict re-select finds the winner
      ],
      'rpc.place_webstore_order': [{ data: null, error: { message: 'duplicate key value violates unique constraint "webstore_orders_client_ref_key"' } }],
    });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-winner');
  });

  test('Stripe create failure rolls the committed order back (webstore-checkout rollback)', async () => {
    const rollbackSpy = jest.spyOn(ws, 'rollbackOrder').mockResolvedValue(undefined);
    stripeMock.__pi.create.mockRejectedValue(new Error('card network down'));
    const { quote_hash } = await freshQuote();
    const res = await ts.placeOrder(fakeSb(placeScript()), placeBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/card payment/i);
    expect(rollbackSpy).toHaveBeenCalledWith(expect.anything(), 'ord1');
    rollbackSpy.mockRestore();
  });

  test('coach without access to the customer → 403, nothing written', async () => {
    const outsider = { ...COACH, id: 'coach2', customer_id: 'someOtherTeam' };
    const sb = fakeSb({ 'coach_customer_access.select': [{ data: null, error: null }] });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'x' }), outsider);
    expect(res.statusCode).toBe(403);
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'insert')).toHaveLength(0);
  });

  test('closed store → 409 (replay of an accepted order still works, tested above)', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [{ ...STORE, status: 'closed' }], error: null }],
      'webstore_orders.select': [{ data: [], error: null }],
    });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'x' }), COACH);
    expect(res.statusCode).toBe(409);
  });

  test('missing seeded store row (pre-00191) fails loudly', async () => {
    const sb = fakeSb({ 'webstores.select': [{ data: [], error: null }] });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'x' }), COACH);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/00191/);
  });
});
