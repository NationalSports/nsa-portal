/* Team Shop ACH (US bank transfer) checkout — the settle-then-produce money path.
 *
 * Owner decision: ACH via Stripe us_bank_account takes ~4 business days to
 * settle, and the order must NOT convert to a Sales Order until
 * payment_intent.succeeded — a processing ACH payment is NOT paid. These tests
 * pin, with the same scripted-fake-supabase style as teamshopCheckout.test.js:
 *   1. place_order_ach creates a us_bank_account-ONLY PaymentIntent (never
 *      automatic payment methods) for the SERVER total, and the order lands
 *      'pending_payment' — the state every convert guard refuses.
 *   2. Settle-then-produce can't be bypassed: convert_order re-reads the order
 *      and 409s anything not 'paid', and 'paid' is only written by the webhook
 *      (payment_intent.succeeded + amount match) or finalize (PI retrieved
 *      from Stripe must be 'succeeded').
 *   3. stripe-webhook payment_intent.succeeded settles an ACH order exactly
 *      like a card order: pending_payment → paid → create_teamshop_sales_order.
 *   4. stripe-webhook payment_intent.payment_failed cancels ONLY a
 *      pending_payment teamshop order behind an ACH-only intent
 *      (payment_method_types === ['us_bank_account']), records the Stripe
 *      failure reason on the order's message thread, and no-ops on redelivery.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

jest.mock('stripe', () => {
  const paymentIntents = { create: jest.fn(), retrieve: jest.fn() };
  const webhooks = { constructEvent: jest.fn() };
  // Plain function, NOT jest.fn(): react-scripts runs jest with resetMocks
  // (see teamshopCheckout.test.js) — the inner jest.fn()s are re-primed below.
  const factory = (key) => ({ paymentIntents, webhooks });
  factory.__pi = paymentIntents;
  factory.__wh = webhooks;
  return factory;
});
jest.mock('../../netlify/functions/_webstoreEmail', () => ({
  sendOrderConfirmation: jest.fn(),
  bumpCouponUse: jest.fn(),
}));
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
jest.mock('../../netlify/functions/_shared', () => ({
  ...jest.requireActual('../../netlify/functions/_shared'),
  reconcileInvoiceFromIntent: jest.fn(),
}));

const stripeMock = require('stripe');
const { createClient } = require('@supabase/supabase-js');
const ts = require('../../netlify/functions/teamshop-checkout');
const ws = require('../../netlify/functions/webstore-checkout');
const webhook = require('../../netlify/functions/stripe-webhook');
const DECO = require('../lib/decoPricing');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Scripted fake supabase — same contract as teamshopCheckout.test.js's.
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
  stripeMock.__pi.create.mockResolvedValue({ id: 'pi_ach_1', client_secret: 'cs_ach_1' });
});
afterEach(() => { calcTaxSpy.mockRestore(); });

async function freshQuoteHash() {
  const res = await ts.quoteTotals(fakeSb(quoteScript()), { customer_id: 'custA', lines: LINES, ship: SHIP }, COACH);
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).quote_hash;
}

describe('place_order_ach', () => {
  test('creates a us_bank_account-ONLY PaymentIntent for the SERVER total; order lands pending_payment', async () => {
    const quote_hash = await freshQuoteHash();
    const sb = fakeSb(placeScript());
    const res = await ts.placeOrder(sb, placeBody({ quote_hash }), COACH, { ach: true });
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.clientSecret).toBe('cs_ach_1');
    expect(out.ach).toBe(true);
    expect(out.order.stripe_pi_id).toBe('pi_ach_1');

    // Order row: identical to the card path — awaiting payment, refused by
    // every convert guard until the webhook settles it.
    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    const o = rpcCall.payload.p_order;
    expect(o.status).toBe('pending_payment');
    expect(o.payment_mode).toBe('paid');
    expect(o.order_source).toBe('teamshop');
    expect(o.total).toBe(TOTAL);

    // PaymentIntent: bank-only, never automatic methods; server amount;
    // webstore idempotency key.
    const [piArgs, piOpts] = stripeMock.__pi.create.mock.calls[0];
    expect(piArgs.payment_method_types).toEqual(['us_bank_account']);
    expect(piArgs.automatic_payment_methods).toBeUndefined();
    expect(piArgs.amount).toBe(Math.round(TOTAL * 100));
    expect(piOpts).toEqual({ idempotencyKey: 'wsorder_ord1' });
  });

  test('quote drift (stale hash) → 409 totals_changed, nothing written, Stripe never touched', async () => {
    const sb = fakeSb(placeScript());
    const res = await ts.placeOrder(sb, placeBody({ quote_hash: 'stale-hash' }), COACH, { ach: true });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('totals_changed');
    expect(sb.calls.filter((c) => c.op === 'rpc' || c.op === 'insert')).toHaveLength(0);
    expect(stripeMock.__pi.create).not.toHaveBeenCalled();
  });

  test('Stripe create failure rolls the committed order back — same compensation as card', async () => {
    const rollbackSpy = jest.spyOn(ws, 'rollbackOrder').mockResolvedValue(undefined);
    stripeMock.__pi.create.mockRejectedValue(new Error('ach rails down'));
    const quote_hash = await freshQuoteHash();
    const res = await ts.placeOrder(fakeSb(placeScript()), placeBody({ quote_hash }), COACH, { ach: true });
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/bank payment/i);
    expect(rollbackSpy).toHaveBeenCalledWith(expect.anything(), 'ord1');
    rollbackSpy.mockRestore();
  });

  test('SETTLE-THEN-PRODUCE: convert_order refuses the processing (pending_payment) ACH order — a client calling convert early cannot start production', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ord1', status: 'pending_payment', order_source: 'teamshop', so_id: null }], error: null }],
    });
    const res = await ts.convertOrder(sb, { order_id: 'ord1' });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toMatch(/not paid/i);
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });
});

// ── stripe-webhook: the ONLY writer of 'paid' for ACH ─────────────────
const WH_EVENT = { httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' };
const ACH_PI = (over) => ({
  id: 'pi_ach_1', amount: Math.round(TOTAL * 100), payment_method_types: ['us_bank_account'],
  last_payment_error: null, ...over,
});
async function runWebhook(sb, evt) {
  createClient.mockReturnValue(sb);
  stripeMock.__wh.constructEvent.mockReturnValue(evt);
  const res = await webhook.handler(WH_EVENT);
  expect(res.statusCode).toBe(200);
  return res;
}

describe('stripe-webhook × teamshop ACH', () => {
  test('payment_intent.succeeded settles the ACH order: pending_payment → paid, then converts to a Sales Order', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [{ id: 'ord1', total: TOTAL }], error: null },              // pending check
        { data: [{ id: 'ord1', order_source: 'teamshop', so_id: null, status: 'paid' }], error: null }, // conversion check
      ],
      'webstore_orders.update': [
        { data: null, error: null },                                        // status → paid
        { data: [], error: null },                                          // confirmation claim (already sent elsewhere)
      ],
      'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-9001' }, error: null }],
    });
    await runWebhook(sb, { type: 'payment_intent.succeeded', data: { object: ACH_PI() } });

    const paidFlip = sb.calls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'paid');
    expect(paidFlip).toBeTruthy();
    const conv = sb.calls.find((c) => c.op === 'rpc' && c.table === 'create_teamshop_sales_order');
    expect(conv.payload).toEqual({ p_webstore_order_id: 'ord1' });
  });

  test('succeeded with a MISMATCHED amount never marks paid and never converts', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [{ id: 'ord1', total: TOTAL }], error: null },
        { data: [{ id: 'ord1', order_source: 'teamshop', so_id: null, status: 'pending_payment' }], error: null },
      ],
      'webstore_orders.update': [{ data: [], error: null }], // confirmation claim finds nothing paid
    });
    await runWebhook(sb, { type: 'payment_intent.succeeded', data: { object: ACH_PI({ amount: 1 }) } });
    expect(sb.calls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'paid')).toBeFalsy();
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('a late succeeded for an order already cancelled (failed ACH) does NOT resurrect or convert it', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [], error: null }, // pending_payment filter matches nothing — order is cancelled
        { data: [{ id: 'ord1', order_source: 'teamshop', so_id: null, status: 'cancelled' }], error: null },
      ],
      'webstore_orders.update': [{ data: [], error: null }], // confirmation claim: nothing paid
    });
    await runWebhook(sb, { type: 'payment_intent.succeeded', data: { object: ACH_PI() } });
    expect(sb.calls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'paid')).toBeFalsy();
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });

  test('payment_failed on the ACH-only intent cancels the pending order and records the Stripe reason on the message thread', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ord1', order_source: 'teamshop', status: 'pending_payment', buyer_name: 'Coach Carter', so_id: null }], error: null }],
      'webstore_orders.update': [{ data: [{ id: 'ord1' }], error: null }], // compare-and-set claims the row
      'messages.insert': [{ data: null, error: null }],
    });
    const pi = ACH_PI({ last_payment_error: { message: 'Insufficient funds in the bank account.' } });
    await runWebhook(sb, { type: 'payment_intent.payment_failed', data: { object: pi } });

    const cancel = sb.calls.find((c) => c.op === 'update');
    expect(cancel.payload).toEqual({ status: 'cancelled' });
    const note = sb.calls.find((c) => c.op === 'insert' && c.table === 'messages');
    expect(note.payload.entity_type).toBe('webstore_order');
    expect(note.payload.entity_id).toBe('ord1');
    expect(note.payload.from_customer).toBe(false);
    expect(note.payload.text).toMatch(/ACH/);
    expect(note.payload.text).toMatch(/Insufficient funds in the bank account\./);
  });

  test('payment_failed redelivery (order already cancelled by the CAS) writes no second message', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ord1', order_source: 'teamshop', status: 'pending_payment', buyer_name: 'Coach Carter', so_id: null }], error: null }],
      'webstore_orders.update': [{ data: [], error: null }], // CAS lost — someone already moved it
    });
    await runWebhook(sb, { type: 'payment_intent.payment_failed', data: { object: ACH_PI() } });
    expect(sb.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  test('payment_failed for a CARD-capable intent (declined attempt mid-retry) touches nothing — not even a read', async () => {
    for (const types of [['card'], ['card', 'us_bank_account'], undefined]) {
      const sb = fakeSb({});
      await runWebhook(sb, { type: 'payment_intent.payment_failed', data: { object: ACH_PI({ payment_method_types: types }) } });
      expect(sb.calls).toHaveLength(0);
    }
  });

  test('payment_failed for an ACH order that already settled (paid) never cancels it', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ord1', order_source: 'teamshop', status: 'paid', buyer_name: 'Coach Carter', so_id: 'SO-1' }], error: null }],
    });
    await runWebhook(sb, { type: 'payment_intent.payment_failed', data: { object: ACH_PI() } });
    expect(sb.calls.filter((c) => c.op === 'update' || c.op === 'insert')).toHaveLength(0);
  });

  test('payment_failed for a non-teamshop (storefront) ACH-shaped intent is left alone', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ordX', order_source: null, status: 'pending_payment', so_id: null }], error: null }],
    });
    await runWebhook(sb, { type: 'payment_intent.payment_failed', data: { object: ACH_PI() } });
    expect(sb.calls.filter((c) => c.op === 'update' || c.op === 'insert')).toHaveLength(0);
  });
});

// ── stripe-webhook honesty (Team Shop backend hardening #4): a failed
// paid-flip or conversion RPC now makes Stripe retry (500) instead of the
// old silent-200-and-log. Both writes are idempotent, so a retry can never
// double-apply. Signature failures and unrecognized events are unaffected —
// covered here too as a regression check on the "current codes" contract.
describe('stripe-webhook honesty — DB-write/RPC failures return 500', () => {
  test('signature verification failure still returns 400 (unaffected by the honesty change)', async () => {
    createClient.mockReturnValue(fakeSb({}));
    stripeMock.__wh.constructEvent.mockImplementation(() => { throw new Error('bad signature'); });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(400);
  });

  test('an unrecognized event type still returns 200 (unaffected by the honesty change)', async () => {
    const sb = fakeSb({});
    createClient.mockReturnValue(sb);
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'customer.created', data: { object: {} } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(200);
  });

  test('paid-flip write failure returns 500 so Stripe retries', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [{ id: 'ord1', total: TOTAL }], error: null }], // pending check
      'webstore_orders.update': [{ data: null, error: { message: 'connection reset by peer' } }], // flip FAILS
    });
    createClient.mockReturnValue(sb);
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: ACH_PI() } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(500);
    // The flip was still attempted exactly once — a genuine write failure, not skipped.
    const flip = sb.calls.find((c) => c.op === 'update' && c.payload && c.payload.status === 'paid');
    expect(flip).toBeTruthy();
  });

  test('teamshop conversion RPC failure returns 500 (RPC is so_id-replay idempotent, safe to retry)', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [{ id: 'ord1', total: TOTAL }], error: null },
        { data: [{ id: 'ord1', order_source: 'teamshop', so_id: null, status: 'paid' }], error: null },
      ],
      'webstore_orders.update': [
        { data: null, error: null },  // flip succeeds
        { data: [], error: null },    // confirmation already claimed elsewhere
      ],
      'rpc.create_teamshop_sales_order': [{ data: null, error: { message: 'duplicate key value violates unique constraint' } }],
    });
    createClient.mockReturnValue(sb);
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: ACH_PI() } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(500);
  });

  test('club conversion RPC failure returns 500', async () => {
    const CLUB_PI = { id: 'pi_club_1', amount: Math.round(TOTAL * 100), payment_method_types: ['card'] };
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [{ id: 'ord2', total: TOTAL }], error: null },
        { data: [{ id: 'ord2', order_source: 'club', so_id: null, status: 'paid' }], error: null }, // teamshop check (no match)
        { data: [{ id: 'ord2', order_source: 'club', so_id: null, status: 'paid' }], error: null }, // club check
      ],
      'webstore_orders.update': [
        { data: null, error: null },
        { data: [], error: null },
      ],
      'rpc.create_club_sales_order': [{ data: null, error: { message: 'insufficient inventory' } }],
    });
    createClient.mockReturnValue(sb);
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: CLUB_PI } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(500);
  });

  test('a fully successful reconcile (no failures) still returns 200', async () => {
    const sb = fakeSb({
      'webstore_orders.select': [
        { data: [{ id: 'ord1', total: TOTAL }], error: null },
        { data: [{ id: 'ord1', order_source: 'teamshop', so_id: null, status: 'paid' }], error: null },
      ],
      'webstore_orders.update': [
        { data: null, error: null },
        { data: [], error: null },
      ],
      'rpc.create_teamshop_sales_order': [{ data: { so_id: 'SO-9001' }, error: null }],
    });
    createClient.mockReturnValue(sb);
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: ACH_PI() } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(200);
  });

  test('an unexpected exception in the reconcile path returns 500 (Stripe retries)', async () => {
    createClient.mockReturnValue({ from: () => { throw new Error('unexpected client failure'); } });
    stripeMock.__wh.constructEvent.mockReturnValue({ type: 'payment_intent.succeeded', data: { object: ACH_PI() } });
    const res = await webhook.handler(WH_EVENT);
    expect(res.statusCode).toBe(500);
  });
});
