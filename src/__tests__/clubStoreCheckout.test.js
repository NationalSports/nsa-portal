/* Club-store individual-order flow — checkout branching (migration 00204 workstream).
 *
 * Club webstores (org_type='club') stamp order_source='club' + customer_id (from
 * webstores.customer_id) at placeOrder time, and trigger create_club_sales_order
 * best-effort right after webstore-checkout's own `finalize` flips an order to
 * 'paid' — the same post-payment trigger point stripe-webhook.js's teamshop branch
 * uses. Team stores (org_type 'team'/undefined/null) must see NEITHER field and
 * NEVER call the club conversion RPC — batchOrders' `.is('so_id', null)` staff flow
 * stays the only path to production for them.
 *
 * Driven through placeOrder()/finalize() with the scripted fake supabase + stripe
 * mock pattern established by webstoreCheckoutIdempotency.test.js / teamshopCheckout.test.js.
 */
process.env.STRIPE_SECRET_KEY = 'sk_test_123';
jest.mock('stripe', () => {
  const paymentIntents = { create: jest.fn(), retrieve: jest.fn() };
  const factory = (key) => ({ paymentIntents });
  factory.__pi = paymentIntents;
  return factory;
});
jest.mock('../../netlify/functions/_webstoreEmail', () => ({
  sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
  bumpCouponUse: jest.fn().mockResolvedValue(undefined),
}));

const checkout = require('../../netlify/functions/webstore-checkout');
const stripeMock = require('stripe');

// Scripted fake supabase — identical shape to webstoreCheckoutIdempotency.test.js's
// fakeSb: results consumed in order per "table.op" (or "rpc.<fn>") key, every call
// recorded so tests can assert what was (not) written/called.
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
        neq: () => chain,
        in: () => chain,
        order: () => chain,
        ilike: () => chain,
        limit: () => chain,
        single: () => chain,
        maybeSingle: () => chain,
        insert: (payload) => { call.op = 'insert'; call.payload = payload; return chain; },
        update: (payload) => { call.op = 'update'; call.payload = payload; return chain; },
        delete: () => { call.op = 'delete'; return chain; },
        then: (resolve, reject) => Promise.resolve(nextResult(table + '.' + call.op, call)).then(resolve, reject),
      };
      return chain;
    },
  };
}

const CLUB_STORE = {
  id: 'st-club', slug: 'club1', name: 'Club Store', status: 'open', org_type: 'club',
  customer_id: 'cust-club-1', payment_mode: 'either', delivery_mode: 'pickup',
  flat_shipping: 0, processing_pct: 0, number_unique: false, fundraise_enabled: false,
};
const TEAM_STORE = {
  id: 'st-team', slug: 'team1', name: 'Team Store', status: 'open', org_type: 'team',
  customer_id: 'cust-team-1', payment_mode: 'either', delivery_mode: 'pickup',
  flat_shipping: 0, processing_pct: 0, number_unique: false, fundraise_enabled: false,
};
const NULL_ORG_STORE = { ...TEAM_STORE, id: 'st-null', slug: 'null1', org_type: undefined };
const WP = { id: 'wp1', store_id: 'x', kind: 'single', active: true, retail_price: 20, sku: 'TEE', product_id: 'p1', display_name: 'Tee', takes_name: false, takes_number: false };
const CART = [{ webstore_product_id: 'wp1', qty: 1, size: 'L' }];
const BUYER = { name: 'Pat', email: 'pat@example.com' };
const NEW_ORDER = { id: 'ord-new', status: 'unpaid', store_id: 'st-club' };

const happyTables = () => ({
  'webstore_products.select': [{ data: [WP], error: null }],
  'webstore_storefront_products.select': [{ data: [], error: null }, { data: [], error: null }],
});
const body = (store, extra) => ({ storeSlug: store.slug, cart: CART, buyer: BUYER, payMode: 'unpaid', ...extra });

describe('placeOrder — order_source/customer_id stamping', () => {
  test('club store: RPC path stamps order_source=club and customer_id from webstores.customer_id', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [CLUB_STORE], error: null }],
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: { order: NEW_ORDER }, error: null }],
    });
    const res = await checkout.placeOrder(sb, body(CLUB_STORE));
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc' && c.table === 'place_webstore_order');
    expect(rpcCall.payload.p_order.order_source).toBe('club');
    expect(rpcCall.payload.p_order.customer_id).toBe('cust-club-1');
  });

  test('team store: RPC path carries neither order_source nor customer_id', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [TEAM_STORE], error: null }],
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: { order: { ...NEW_ORDER, store_id: 'st-team' } }, error: null }],
    });
    const res = await checkout.placeOrder(sb, body(TEAM_STORE));
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc' && c.table === 'place_webstore_order');
    expect(rpcCall.payload.p_order.order_source).toBeUndefined();
    expect(rpcCall.payload.p_order.customer_id).toBeUndefined();
  });

  test('store with no org_type (legacy team store) also carries neither field', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [NULL_ORG_STORE], error: null }],
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: { order: { ...NEW_ORDER, store_id: 'st-null' } }, error: null }],
    });
    const res = await checkout.placeOrder(sb, body(NULL_ORG_STORE));
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc' && c.table === 'place_webstore_order');
    expect(rpcCall.payload.p_order.order_source).toBeUndefined();
    expect(rpcCall.payload.p_order.customer_id).toBeUndefined();
  });

  test('club store: legacy insert path (missing RPC) stamps the same two fields', async () => {
    const RPC_MISSING = { data: null, error: { message: 'Could not find the function public.place_webstore_order in the schema cache' } };
    const sb = fakeSb({
      'webstores.select': [{ data: [CLUB_STORE], error: null }],
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
      'webstore_order_items.insert': [{ data: null, error: null }],
    });
    const res = await checkout.placeOrder(sb, body(CLUB_STORE));
    expect(res.statusCode).toBe(200);
    const ins = sb.calls.find((c) => c.table === 'webstore_orders' && c.op === 'insert');
    expect(ins.payload.order_source).toBe('club');
    expect(ins.payload.customer_id).toBe('cust-club-1');
  });

  test('club store with no customer_id stamps order_source but a null customer_id (RPC guards NSA_BAD_INPUT itself)', async () => {
    const store = { ...CLUB_STORE, customer_id: null };
    const sb = fakeSb({
      'webstores.select': [{ data: [store], error: null }],
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: { order: NEW_ORDER }, error: null }],
    });
    const res = await checkout.placeOrder(sb, body(store));
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc' && c.table === 'place_webstore_order');
    expect(rpcCall.payload.p_order.order_source).toBe('club');
    expect(rpcCall.payload.p_order.customer_id).toBeNull();
  });
});

describe('finalize — post-payment club conversion trigger', () => {
  const PI_ID = 'pi_123';
  const clubOrder = (over) => ({
    id: 'ord-club-1', store_id: 'st-club', stripe_pi_id: PI_ID, order_source: 'club',
    so_id: null, total: 20, buyer_email: null, ...over,
  });

  beforeEach(() => {
    stripeMock.__pi.retrieve.mockReset();
    stripeMock.__pi.create.mockReset();
  });

  test('paid club order (unconverted) calls create_club_sales_order with the order id', async () => {
    stripeMock.__pi.retrieve.mockResolvedValue({ id: PI_ID, status: 'succeeded', amount: 2000, metadata: {} });
    const order = clubOrder();
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [order], error: null }],
      'rpc.create_club_sales_order': [{ data: { so_id: 'SO-1001', replayed: false }, error: null }],
    });
    const res = await checkout.finalize(sb, { orderId: order.id, stripePiId: PI_ID });
    expect(res.statusCode).toBe(200);
    const rpcCall = sb.calls.find((c) => c.op === 'rpc' && c.table === 'create_club_sales_order');
    expect(rpcCall).toBeDefined();
    expect(rpcCall.payload).toEqual({ p_order_id: order.id });
  });

  test('a failed conversion RPC never fails the checkout response (best-effort)', async () => {
    stripeMock.__pi.retrieve.mockResolvedValue({ id: PI_ID, status: 'succeeded', amount: 2000, metadata: {} });
    const order = clubOrder();
    const sb = fakeSb({
      'webstore_orders.select': [{ data: [order], error: null }],
      'rpc.create_club_sales_order': [{ data: null, error: { message: 'boom' } }],
    });
    const res = await checkout.finalize(sb, { orderId: order.id, stripePiId: PI_ID });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).ok).toBe(true);
  });

  test('already-converted club order (so_id set) does not call the RPC again', async () => {
    stripeMock.__pi.retrieve.mockResolvedValue({ id: PI_ID, status: 'succeeded', amount: 2000, metadata: {} });
    const order = clubOrder({ so_id: 'SO-1001' });
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [order], error: null }] });
    const res = await checkout.finalize(sb, { orderId: order.id, stripePiId: PI_ID });
    expect(res.statusCode).toBe(200);
    expect(sb.calls.some((c) => c.op === 'rpc' && c.table === 'create_club_sales_order')).toBe(false);
  });

  test('a team-store order never calls create_club_sales_order', async () => {
    stripeMock.__pi.retrieve.mockResolvedValue({ id: PI_ID, status: 'succeeded', amount: 2000, metadata: {} });
    const order = clubOrder({ order_source: null, store_id: 'st-team' });
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [order], error: null }] });
    const res = await checkout.finalize(sb, { orderId: order.id, stripePiId: PI_ID });
    expect(res.statusCode).toBe(200);
    expect(sb.calls.some((c) => c.op === 'rpc' && c.table === 'create_club_sales_order')).toBe(false);
  });

  test('a teamshop order never calls create_club_sales_order either', async () => {
    stripeMock.__pi.retrieve.mockResolvedValue({ id: PI_ID, status: 'succeeded', amount: 2000, metadata: {} });
    const order = clubOrder({ order_source: 'teamshop' });
    const sb = fakeSb({ 'webstore_orders.select': [{ data: [order], error: null }] });
    const res = await checkout.finalize(sb, { orderId: order.id, stripePiId: PI_ID });
    expect(res.statusCode).toBe(200);
    expect(sb.calls.some((c) => c.op === 'rpc' && c.table === 'create_club_sales_order')).toBe(false);
  });
});
