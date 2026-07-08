/* place_order idempotency (client_ref, migration 00170) and the transactional
 * write path (place_webstore_order RPC + stock holds, migration 00171).
 *
 * A double-submit — double-click, or a retry after the response was lost — must
 * return the EXISTING order, never create a second order + second PaymentIntent.
 * Pre-migration DBs must keep working: a missing client_ref column disables
 * dedup, a missing RPC falls back to the legacy sequential writes.
 *
 * Driven through placeOrder() with a scripted fake supabase; the confirmation
 * email module is mocked so no network is touched. All scenarios use an unpaid
 * pickup store so Stripe never enters the picture.
 */
jest.mock('../../netlify/functions/_webstoreEmail', () => ({
  sendOrderConfirmation: jest.fn().mockResolvedValue(undefined),
  bumpCouponUse: jest.fn().mockResolvedValue(undefined),
}));

const checkout = require('../../netlify/functions/webstore-checkout');

// Scripted fake supabase: results are consumed in order per "table.op" (or
// "rpc.<fn>") key, and every call is recorded so tests can assert what was
// (not) written.
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

const STORE = {
  id: 'st1', slug: 'tigers', name: 'Tigers', status: 'open',
  payment_mode: 'unpaid', delivery_mode: 'pickup', flat_shipping: 0,
  processing_pct: 0, number_unique: false, fundraise_enabled: false,
};
const WP = { id: 'wp1', store_id: 'st1', kind: 'single', active: true, retail_price: 20, sku: 'TEE', product_id: 'p1', display_name: 'Tee', takes_name: false, takes_number: false };
const CART = [{ webstore_product_id: 'wp1', qty: 1, size: 'L' }];
const BUYER = { name: 'Pat', email: 'pat@example.com' };
const EXISTING = {
  id: 'ord-existing', status: 'unpaid', store_id: 'st1', buyer_email: 'pat@example.com',
  subtotal: 20, fundraise_amt: 0, shipping_fee: 0, processing_fee: 0, discount_amt: 0, tax: 0, total: 20,
  client_ref: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};
const REF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NEW_ORDER = { ...EXISTING, id: 'ord-new' };
const RPC_MISSING = { data: null, error: { message: 'Could not find the function public.place_webstore_order(p_claims, p_hold_minutes, p_holds, p_items, p_order) in the schema cache' } };
// A tracked in-stock storefront row so checkStock produces a hold for size L.
const SF_ROW = { webstore_product_id: 'wp1', name: 'Tee', size_stock: { L: 5 }, vendor_size_stock: {}, on_order_qty: 0, earliest_eta: null, vendor_eta: null, track_inventory: true, inventory_source: 'adidas' };

const body = (extra) => ({ storeSlug: 'tigers', cart: CART, buyer: BUYER, payMode: 'unpaid', ...extra });

// Table traffic for scenarios that reach the write phase, in order —
//   webstores.select (store) → [webstore_orders.select dup check when ref present]
//   → webstore_products.select (priceCart) → webstore_storefront_products.select (upcharges)
//   → webstore_storefront_products.select (checkStock) → rpc.place_webstore_order
//   → [legacy: webstore_orders.insert → webstore_order_items.insert]
//   → webstore_orders.update (confirmation_sent claim)
const happyTables = () => ({
  'webstores.select': [{ data: [STORE], error: null }],
  'webstore_products.select': [{ data: [WP], error: null }],
  'webstore_storefront_products.select': [{ data: [], error: null }, { data: [SF_ROW], error: null }],
  'webstore_order_items.insert': [{ data: null, error: null }],
  'webstore_orders.update': [{ data: [{ id: NEW_ORDER.id }], error: null }],
});

describe('transactional path (place_webstore_order RPC)', () => {
  test('happy path: RPC gets order/items/holds, no direct table inserts', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: { order: NEW_ORDER }, error: null }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-new');
    const rpcCall = sb.calls.find((c) => c.op === 'rpc');
    expect(rpcCall.payload.p_order.client_ref).toBe(REF);
    expect(rpcCall.payload.p_items).toHaveLength(1);
    expect(rpcCall.payload.p_items[0].order_id).toBeUndefined(); // proc injects it
    expect(rpcCall.payload.p_holds).toEqual([{ webstore_product_id: 'wp1', size: 'L', qty: 1, max_avail: 5, label: 'Tee (size L)' }]);
    expect(rpcCall.payload.p_hold_minutes).toBe(30);
    expect(sb.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
  });

  test('NSA_NUMBER_TAKEN maps to the number_taken 409', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: null, error: { message: 'NSA_NUMBER_TAKEN:10' } }],
    });
    const res = await checkout.placeOrder(sb, body());
    expect(res.statusCode).toBe(409);
    const out = JSON.parse(res.body);
    expect(out.code).toBe('number_taken');
    expect(out.number).toBe('10');
  });

  test('NSA_SOLD_OUT maps to the sold-out 409 with the item label', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [{ data: null, error: { message: 'NSA_SOLD_OUT:Tee (size L)' } }],
    });
    const res = await checkout.placeOrder(sb, body());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('Tee (size L)');
  });

  test('client_ref race inside the transaction replays the winner', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'webstore_orders.select': [
        { data: [], error: null },         // dup pre-check: nothing yet
        { data: [EXISTING], error: null }, // post-conflict re-select finds the winner
      ],
      'rpc.place_webstore_order': [{ data: null, error: { message: 'duplicate key value violates unique constraint "webstore_orders_client_ref_key"' } }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(out.order.id).toBe('ord-existing');
  });

  test('sold-out at checkStock never reaches the RPC', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [STORE], error: null }],
      'webstore_products.select': [{ data: [WP], error: null }],
      'webstore_storefront_products.select': [
        { data: [], error: null },
        { data: [{ ...SF_ROW, size_stock: {} }], error: null }, // zero stock, nothing incoming
      ],
    });
    const res = await checkout.placeOrder(sb, body());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error).toContain('sold out');
    expect(sb.calls.filter((c) => c.op === 'rpc')).toHaveLength(0);
  });
});

describe('place_order idempotency + legacy fallback (pre-00171 DBs)', () => {
  test('duplicate submit returns the existing order without inserting', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [STORE], error: null }],
      'webstore_orders.select': [{ data: [EXISTING], error: null }], // dup check hits
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(out.order.id).toBe('ord-existing');
    expect(out.totals.total).toBe(20);
    expect(sb.calls.filter((c) => c.op === 'insert' || c.op === 'rpc')).toHaveLength(0);
  });

  test('replay works even if the store has since closed', async () => {
    const sb = fakeSb({
      'webstores.select': [{ data: [{ ...STORE, status: 'closed' }], error: null }],
      'webstore_orders.select': [{ data: [EXISTING], error: null }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-existing');
  });

  test('missing RPC falls back to legacy writes', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.select': [{ data: [], error: null }],
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-new');
    const ins = sb.calls.find((c) => c.table === 'webstore_orders' && c.op === 'insert');
    expect(ins.payload.client_ref).toBe(REF);
    const itemIns = sb.calls.find((c) => c.table === 'webstore_order_items' && c.op === 'insert');
    expect(itemIns.payload[0].order_id).toBe('ord-new'); // legacy path injects order_id itself
  });

  test('legacy insert race: unique violation re-selects and returns the winner', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.select': [
        { data: [], error: null },         // dup check: nothing yet
        { data: [EXISTING], error: null }, // post-conflict re-select finds the winner
      ],
      'webstore_orders.insert': [
        { data: null, error: { message: 'duplicate key value violates unique constraint "webstore_orders_client_ref_key"' } },
      ],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    const out = JSON.parse(res.body);
    expect(out.replayed).toBe(true);
    expect(out.order.id).toBe('ord-existing');
  });

  test('pre-migration DB: missing column disables dedup but checkout succeeds', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.select': [
        { data: null, error: { message: "Could not find the 'client_ref' column of 'webstore_orders' in the schema cache" } },
      ],
      'webstore_orders.insert': [
        { data: null, error: { message: "Could not find the 'client_ref' column of 'webstore_orders' in the schema cache" } },
        { data: NEW_ORDER, error: null }, // retry without the token succeeds
      ],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: REF }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-new');
    const inserts = sb.calls.filter((c) => c.table === 'webstore_orders' && c.op === 'insert');
    expect(inserts).toHaveLength(2);
    expect(inserts[0].payload.client_ref).toBe(REF);
    expect(inserts[1].payload.client_ref).toBeUndefined();
  });

  test('no clientRef: legacy path unchanged, no dup check performed', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
    });
    const res = await checkout.placeOrder(sb, body());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-new');
    expect(sb.calls.filter((c) => c.table === 'webstore_orders' && c.op === 'select')).toHaveLength(0);
    expect(sb.calls.find((c) => c.op === 'insert' && c.table === 'webstore_orders').payload.client_ref).toBeUndefined();
  });

  test('malformed clientRef is ignored', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'rpc.place_webstore_order': [RPC_MISSING],
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: 'short' }));
    expect(res.statusCode).toBe(200);
    expect(sb.calls.filter((c) => c.table === 'webstore_orders' && c.op === 'select')).toHaveLength(0);
  });
});
