/* place_order idempotency (client_ref, migration 00170).
 *
 * A double-submit — double-click, or a retry after the response was lost — must
 * return the EXISTING order, never create a second order + second PaymentIntent.
 * Pre-migration DBs (no client_ref column) must keep working with dedup off.
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

// Scripted fake supabase: results are consumed in order per "table.op" key, and
// every call is recorded so tests can assert what was (not) written.
function fakeSb(script) {
  const calls = [];
  return {
    calls,
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
        then: (resolve, reject) => {
          const key = table + '.' + call.op;
          const queue = script[key] || [];
          const result = queue.length ? queue.shift() : { data: [], error: null };
          call.result = result;
          return Promise.resolve(result).then(resolve, reject);
        },
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
const CART = [{ webstore_product_id: 'wp1', qty: 1 }];
const BUYER = { name: 'Pat', email: 'pat@example.com' };
const EXISTING = {
  id: 'ord-existing', status: 'unpaid', store_id: 'st1', buyer_email: 'pat@example.com',
  subtotal: 20, fundraise_amt: 0, shipping_fee: 0, processing_fee: 0, discount_amt: 0, tax: 0, total: 20,
  client_ref: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
};
const REF = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const NEW_ORDER = { ...EXISTING, id: 'ord-new' };

const body = (extra) => ({ storeSlug: 'tigers', cart: CART, buyer: BUYER, payMode: 'unpaid', ...extra });

// Script pieces shared by the "order gets created" scenarios:
// placeOrder's table traffic, in order —
//   webstores.select (store) → [webstore_orders.select dup check when ref present]
//   → webstore_products.select (priceCart) → webstore_storefront_products.select (upcharges)
//   → webstore_storefront_products.select (checkStock) → webstore_orders.insert
//   → webstore_order_items.insert → webstore_orders.update (confirmation_sent claim)
const happyTables = () => ({
  'webstores.select': [{ data: [STORE], error: null }],
  'webstore_products.select': [{ data: [WP], error: null }],
  'webstore_storefront_products.select': [{ data: [], error: null }, { data: [], error: null }],
  'webstore_order_items.insert': [{ data: null, error: null }],
  'webstore_orders.update': [{ data: [{ id: NEW_ORDER.id }], error: null }],
});

describe('place_order idempotency', () => {
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
    expect(sb.calls.filter((c) => c.op === 'insert')).toHaveLength(0);
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

  test('insert race: unique violation re-selects and returns the winner', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'webstore_orders.select': [
        { data: [], error: null },        // dup check: nothing yet
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
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
    });
    const res = await checkout.placeOrder(sb, body());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).order.id).toBe('ord-new');
    // The only webstore_orders SELECT traffic should be zero — dup check skipped.
    expect(sb.calls.filter((c) => c.table === 'webstore_orders' && c.op === 'select')).toHaveLength(0);
    expect(sb.calls.find((c) => c.op === 'insert' && c.table === 'webstore_orders').payload.client_ref).toBeUndefined();
  });

  test('malformed clientRef is ignored', async () => {
    const sb = fakeSb({
      ...happyTables(),
      'webstore_orders.insert': [{ data: NEW_ORDER, error: null }],
    });
    const res = await checkout.placeOrder(sb, body({ clientRef: 'short' }));
    expect(res.statusCode).toBe(200);
    expect(sb.calls.filter((c) => c.table === 'webstore_orders' && c.op === 'select')).toHaveLength(0);
  });
});
