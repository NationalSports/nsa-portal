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
  sendPoOrderReceived: jest.fn().mockResolvedValue(undefined),
  bumpCouponUse: jest.fn().mockResolvedValue(undefined),
}));

const stripeMock = require('stripe');
const emailMock = require('../../netlify/functions/_webstoreEmail');
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
    storage: {
      from(bucket) {
        return {
          upload: (path, buf, opts) => {
            const call = { table: 'storage.' + bucket, op: 'upload', payload: { path, bytes: buf && buf.length, opts } };
            calls.push(call);
            return Promise.resolve(nextResult('storage.' + bucket + '.upload', call));
          },
          remove: (paths) => {
            const call = { table: 'storage.' + bucket, op: 'remove', payload: { paths } };
            calls.push(call);
            return Promise.resolve(nextResult('storage.' + bucket + '.remove', call));
          },
        };
      },
    },
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

  test('missing seeded store row (pre-00195) fails loudly', async () => {
    const sb = fakeSb({ 'webstores.select': [{ data: [], error: null }] });
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'x' }), COACH);
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/00195/);
  });
});

// School-PO checkout (00200/00201) — place_order_po. Same verification chain
// as place_order (auth → replay → store → quote hash), plus the rep-gated
// eligibility read, PDF magic-byte/size validation, and the po-docs upload —
// and NO Stripe anywhere on the path.
describe('place_order_po', () => {
  const PDF_B64 = Buffer.from('%PDF-1.4\nfake po document').toString('base64');
  const PO_ORDER = { id: 'ordpo1', store_id: 'st-ts', status: 'unpaid', buyer_email: CONTACT.email, total: TOTAL, status_token: 'tokpo', order_number: 1010002 };
  const ELIGIBLE = { data: [{ id: 'custA', teamshop_po_allowed: true }], error: null };
  const poScript = (overrides) => ({
    'webstores.select': [{ data: [STORE], error: null }],
    'webstore_orders.select': [{ data: [], error: null }], // clientRef dup check
    // customers is read TWICE: eligibility gate first, then buildQuote's pricing read.
    'customers.select': [ELIGIBLE, { data: CUST, error: null }],
    'products.select': [{ data: [PROD], error: null }],
    'rpc.place_webstore_order': [{ data: { order: PO_ORDER }, error: null }],
    'storage.po-docs.upload': [{ data: { path: 'ordpo1/po.pdf' }, error: null }],
    'webstore_orders.update': [{ data: null, error: null }],
    ...(overrides || {}),
  });
  const poBody = (extra) => placeBody({ po_number: 'PO-2026-0042', po_pdf_base64: PDF_B64, ...extra });

  test('happy path: unpaid order with PO fields, PDF stored at an order-scoped path, Stripe never touched', async () => {
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript());
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.poPending).toBe(true);
    expect(out.order.id).toBe('ordpo1');
    expect(out.order.po_doc_path).toBe('ordpo1/po.pdf');
    expect(out.totals.total).toBe(TOTAL);

    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    const o = rpcCall.payload.p_order;
    expect(o.status).toBe('unpaid');          // pending staff verification; 00199 refuses to convert it
    expect(o.payment_mode).toBe('unpaid');    // no card collected
    expect(o.po_number).toBe('PO-2026-0042');
    expect(o.order_source).toBe('teamshop');
    expect(o.coach_id).toBe('coach1');
    expect(o.customer_id).toBe('custA');
    expect(o.quote_hash).toBe(quote_hash);
    expect(o.total).toBe(TOTAL);              // server money, same recomputation as card
    expect(o.stripe_pi_id).toBeUndefined();

    const upload = sb.calls.find((c) => c.op === 'upload');
    expect(upload.payload.path).toBe('ordpo1/po.pdf');
    expect(upload.payload.opts).toMatchObject({ contentType: 'application/pdf' });
    const upd = sb.calls.find((c) => c.op === 'update');
    expect(upd.payload).toEqual({ po_doc_path: 'ordpo1/po.pdf' });

    // "PO order received" fires once, after the write, with the order the RPC returned.
    expect(emailMock.sendPoOrderReceived).toHaveBeenCalledTimes(1);
    expect(emailMock.sendPoOrderReceived).toHaveBeenCalledWith(sb, expect.objectContaining({ id: 'ordpo1' }));

    expect(stripeMock.__pi.create).not.toHaveBeenCalled();
  });

  test('a failed "PO order received" email never fails order placement (best-effort)', async () => {
    emailMock.sendPoOrderReceived.mockRejectedValueOnce(new Error('brevo down'));
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript());
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).poPending).toBe(true);
    expect(emailMock.sendPoOrderReceived).toHaveBeenCalledTimes(1);
  });

  test('program not approved (teamshop_po_allowed false) → 403 po_not_allowed, nothing written', async () => {
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript({ 'customers.select': [{ data: [{ id: 'custA', teamshop_po_allowed: false }], error: null }] }));
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).code).toBe('po_not_allowed');
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'insert' || c.op === 'upload')).toHaveLength(0);
  });

  test('pre-00200 (teamshop_po_allowed column missing) → 422 po_not_enabled, never a fallback to allowed', async () => {
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript({
      'customers.select': [{ data: null, error: { message: 'column customers.teamshop_po_allowed does not exist' } }],
    }));
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe('po_not_enabled');
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
  });

  test('PDF validation: missing file, wrong magic bytes, and over-10MB all 400 before any write', async () => {
    for (const bad of [
      { po_pdf_base64: undefined },
      { po_pdf_base64: Buffer.from('<html>not a pdf</html>').toString('base64') },
      { po_pdf_base64: Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(10 * 1024 * 1024 + 1)]).toString('base64') },
    ]) {
      const sb = fakeSb(poScript());
      const res = await ts.placeOrderPo(sb, poBody({ quote_hash: 'x', ...bad }), COACH);
      expect(res.statusCode).toBe(400);
      expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
    }
  });

  test('missing PO number → 400 before any write', async () => {
    const sb = fakeSb(poScript());
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash: 'x', po_number: '  ' }), COACH);
    expect(res.statusCode).toBe(400);
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
  });

  test('quote drift (stale hash) → 409 totals_changed with a fresh quote, nothing written', async () => {
    const sb = fakeSb(poScript());
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash: 'stale-hash' }), COACH);
    expect(res.statusCode).toBe(409);
    const out = JSON.parse(res.body);
    expect(out.code).toBe('totals_changed');
    expect(out.quote.quote_hash).toBeTruthy();
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
  });

  test('replaying the same client_ref returns the SAME unpaid order without re-pricing, uploading, or Stripe', async () => {
    const existing = { ...PO_ORDER, id: 'ordpo-existing', client_ref: REF, subtotal: SUBTOTAL, fundraise_amt: 0, shipping_fee: 5, processing_fee: 0, discount_amt: 0, tax: TAX.tax };
    const sb = fakeSb({
      'webstores.select': [{ data: [STORE], error: null }],
      'webstore_orders.select': [{ data: [existing], error: null }], // dup check hits
    });
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash: 'anything' }), COACH);
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(out.order.id).toBe('ordpo-existing');
    expect(out.clientSecret).toBeUndefined(); // unpaid replay = the plain branch, no PaymentIntent leg
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
    expect(stripeMock.__pi.create).not.toHaveBeenCalled();
    // A same-attempt replay must never re-send the "received" email.
    expect(emailMock.sendPoOrderReceived).not.toHaveBeenCalled();
  });

  test('PDF upload failure rolls the committed order back', async () => {
    const rollbackSpy = jest.spyOn(ws, 'rollbackOrder').mockResolvedValue(undefined);
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript({ 'storage.po-docs.upload': [{ data: null, error: { message: 'bucket missing' } }] }));
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(502);
    expect(rollbackSpy).toHaveBeenCalledWith(expect.anything(), 'ordpo1');
    rollbackSpy.mockRestore();
  });

  test('po_doc_path link failure removes the uploaded PDF and rolls back', async () => {
    const rollbackSpy = jest.spyOn(ws, 'rollbackOrder').mockResolvedValue(undefined);
    const { quote_hash } = await freshQuote();
    const sb = fakeSb(poScript({ 'webstore_orders.update': [{ data: null, error: { message: 'update failed' } }] }));
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash }), COACH);
    expect(res.statusCode).toBe(502);
    expect(sb.calls.find((c) => c.op === 'remove').payload.paths).toEqual(['ordpo1/po.pdf']);
    expect(rollbackSpy).toHaveBeenCalledWith(expect.anything(), 'ordpo1');
    rollbackSpy.mockRestore();
  });

  test('coach without access to the customer → 403, nothing written', async () => {
    const outsider = { ...COACH, id: 'coach2', customer_id: 'someOtherTeam' };
    const sb = fakeSb({ 'coach_customer_access.select': [{ data: null, error: null }] });
    const res = await ts.placeOrderPo(sb, poBody({ quote_hash: 'x' }), outsider);
    expect(res.statusCode).toBe(403);
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'upload')).toHaveLength(0);
  });
});

// Stage 7 — convert_order → create_teamshop_sales_order RPC (migration 00196).
// The RPC re-guards everything inside its transaction; these tests pin the
// function-level pre-guards (paid + teamshop + replay) and the retry contract.
describe('convert_order', () => {
  const PAID = { id: 'ord1', status: 'paid', order_source: 'teamshop', so_id: null };

  test('unpaid order → 409 rejected, RPC never invoked', async () => {
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ ...PAID, status: 'pending_payment' }], error: null }] });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(409);
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('non-teamshop (storefront) order → 409 rejected, RPC never invoked', async () => {
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ ...PAID, order_source: null }], error: null }] });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(409);
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('paid teamshop order → RPC invoked with the order id; result echoed', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PAID], error: null }],
      'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-1001', replayed: false, jobs: 1 }, error: null }],
    });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.so_id).toBe('SO-1001');
    expect(out.replayed).toBe(false);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    expect(rpcCall.table).toBe('create_teamshop_sales_order');
    expect(rpcCall.payload).toEqual({ p_webstore_order_id: 'ord1' });
  });

  test('already converted (so_id set) → replayed:true without invoking the RPC', async () => {
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [{ ...PAID, so_id: 'SO-1001' }], error: null }] });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.so_id).toBe('SO-1001');
    expect(out.replayed).toBe(true);
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('RPC error → 502; the order stays paid so a retry (client, webhook, or staff) replays idempotently', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [PAID], error: null }],
      'rpc.create_teamshop_sales_order': [{ data: null, error: { message: 'boom' } }],
    });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/boom/);
    // No compensation writes: convert is read + rpc only — nothing to roll back,
    // so the SAME call can be retried and the RPC's so_id guard makes it a no-op
    // once any retry has succeeded.
    expect(sb.calls.filter((c) => c.op === 'update' || c.op === 'insert' || c.op === 'delete')).toHaveLength(0);
  });

  test('unknown order → 404', async () => {
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [], error: null }] });
    const res = await ts.convertOrder(sb, { order_id: 'nope' });
    expect(res.statusCode).toBe(404);
  });
});
