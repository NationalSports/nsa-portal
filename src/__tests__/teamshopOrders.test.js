/* Unit tests for the coach-facing Team Shop order-history function (Stage 8).
 * Same mocking style as teamshopContext.test.js: a fake supabase admin
 * client, with _shared mocked so getSupabaseAdmin never needs real
 * credentials. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const teamshopOrders = require('../../netlify/functions/teamshop-orders');

// Minimal chainable supabase stub, same shape as teamshopContext.test.js's
// fakeSb: from(table) returns a thenable whose query methods are no-ops.
function fakeSb(tables, user) {
  return {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain, maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: 'custA', auth_user_id: 'auth1' };

const ORDER_1 = { id: 'ord1', created_at: '2026-07-01T00:00:00Z', status: 'paid', total: 120, buyer_name: 'Coach A', status_token: 'tok1', so_id: null, customer_id: 'custA', order_source: 'teamshop' };
const ORDER_2 = { id: 'ord2', created_at: '2026-06-01T00:00:00Z', status: 'batched', total: 300, buyer_name: 'Coach A', status_token: 'tok2', so_id: 'SO-1001', customer_id: 'custA', order_source: 'teamshop' };

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [{ customer_id: 'custA' }], error: null },
  webstore_orders: { data: [ORDER_1, ORDER_2], error: null },
  webstore_order_items: {
    data: [
      { order_id: 'ord1', product_id: 'p1', sku: 'SKU1', name: 'Polo', qty: 2, size: 'M', image_url: null, po_file_path: '/internal/po.pdf' },
      { order_id: 'ord2', product_id: 'p2', sku: 'SKU2', name: 'Hoodie', qty: 1, size: 'L', image_url: 'https://x/y.png' },
    ],
    error: null,
  },
  webstore_shipments: { data: [], error: null },
  so_jobs: { data: [{ so_id: 'SO-1001', prod_status: 'in_process' }], error: null },
  ...over,
});

const call = ({ user = { id: 'auth1', email: 'coach@team.com' }, tables = baseTables(), auth = 'Bearer tok', method = 'POST', body = { action: 'list', customer_id: 'custA' } } = {}) => {
  mockAdmin = fakeSb(tables, user);
  return teamshopOrders.handler({ httpMethod: method, headers: auth ? { authorization: auth } : {}, body: JSON.stringify(body) });
};

describe('method guard', () => {
  test('rejects non-POST', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(405);
  });
});

describe('auth gating', () => {
  test('rejects a missing bearer token', async () => {
    const r = await call({ auth: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects an invalid token', async () => {
    const r = await call({ user: null });
    expect(r.statusCode).toBe(401);
  });

  test('rejects a signed-in user with no coach account', async () => {
    const r = await call({ tables: baseTables({ coach_accounts: { data: [], error: null } }) });
    expect(r.statusCode).toBe(403);
  });

  test('unknown action is rejected', async () => {
    const r = await call({ body: { action: 'nope', customer_id: 'custA' } });
    expect(r.statusCode).toBe(400);
  });
});

describe('customer access gating', () => {
  test('rejects a customer_id the coach has no access to', async () => {
    const r = await call({
      tables: baseTables({ coach_accounts: { data: [{ ...COACH, customer_id: null }], error: null }, coach_customer_access: { data: [], error: null } }),
      body: { action: 'list', customer_id: 'custZ' },
    });
    expect(r.statusCode).toBe(403);
  });

  test('missing customer_id is a 400', async () => {
    const r = await call({ body: { action: 'list' } });
    expect(r.statusCode).toBe(400);
  });
});

describe('teamshop-only filter and shape', () => {
  test('returns only this customer\'s teamshop orders, newest first, with items attached', async () => {
    const r = await call();
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.orders.map((o) => o.id)).toEqual(['ord1', 'ord2']);
    expect(body.orders[0].items).toEqual([{ product_id: 'p1', sku: 'SKU1', name: 'Polo', qty: 2, size: 'M', image_url: null }]);
  });

  test('sanitizes items — never leaks po_file_path or other internal fields', async () => {
    const r = await call();
    const body = JSON.parse(r.body);
    const raw = JSON.stringify(body);
    expect(raw).not.toMatch(/po_file_path/);
    expect(raw).not.toMatch(/internal\/po\.pdf/);
  });

  test('order with no so_id gets production: null', async () => {
    const r = await call();
    const body = JSON.parse(r.body);
    const o1 = body.orders.find((o) => o.id === 'ord1');
    expect(o1.production).toBeNull();
  });
});

describe('production-stage summarization', () => {
  const { summarizeProdStage } = teamshopOrders;

  test('any shipment -> shipped, regardless of job state', () => {
    expect(summarizeProdStage([{ prod_status: 'hold' }], true)).toBe('shipped');
    expect(summarizeProdStage([{ prod_status: 'completed' }], true)).toBe('shipped');
  });

  test('all jobs completed -> decorated', () => {
    expect(summarizeProdStage([{ prod_status: 'completed' }, { prod_status: 'completed' }], false)).toBe('decorated');
  });

  test('any job in_process -> in production', () => {
    expect(summarizeProdStage([{ prod_status: 'completed' }, { prod_status: 'in_process' }], false)).toBe('in production');
  });

  test('any job staging (none in_process) -> queued', () => {
    expect(summarizeProdStage([{ prod_status: 'hold' }, { prod_status: 'staging' }], false)).toBe('queued');
  });

  test('all hold, or no jobs -> received', () => {
    expect(summarizeProdStage([{ prod_status: 'hold' }], false)).toBe('received');
    expect(summarizeProdStage([], false)).toBe('received');
  });

  test('list endpoint wires the summary through: SO-1001 has an in_process job -> "in production"', async () => {
    const r = await call();
    const body = JSON.parse(r.body);
    const o2 = body.orders.find((o) => o.id === 'ord2');
    expect(o2.production).toEqual({ stage: 'in production' });
  });
});
