/* eslint-disable */
const mockState = { uniform_order_requests: [], uniform_order_proofs: [], uniform_order_events: [] };
let mockOrderSeq = 1001;
let mockEventSeq = 1;

class MockQuery {
  constructor(table) { this.table = table; this.operation = 'select'; this.filters = []; this.payload = null; this.orders = []; this.max = null; }
  select() { return this; }
  insert(payload) { this.operation = 'insert'; this.payload = Array.isArray(payload) ? payload : [payload]; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  eq(key, value) { this.filters.push([key, value, 'eq']); return this; }
  neq(key, value) { this.filters.push([key, value, 'neq']); return this; }
  order(key, options = {}) { this.orders.push([key, !!options.ascending]); return this; }
  limit(value) { this.max = value; return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve, reject) { return this.execute(false).then(resolve, reject); }
  matches(row) { return this.filters.every(([key, value, op]) => (op === 'neq' ? row[key] !== value : row[key] === value)); }
  stamp(table, row) {
    const now = new Date().toISOString();
    if (table === 'uniform_order_requests') return {
      id: row.id || `order-${mockOrderSeq}`,
      order_number: row.order_number || `UB-${String(mockOrderSeq++).padStart(6, '0')}`,
      public_token: row.public_token || `token-${Math.random().toString(36).slice(2)}`,
      proof_version: 0, approved_proof_version: null, locked_at: null,
      production_status: 'submitted', payment_status: 'unpaid',
      created_at: now, updated_at: now, ...row,
    };
    if (table === 'uniform_order_events') return { id: mockEventSeq++, created_at: now, ...row };
    if (table === 'uniform_order_proofs') return { id: `proof-${mockState.uniform_order_proofs.length + 1}`, created_at: now, ...row };
    return { ...row };
  }
  async execute(one) {
    const rows = mockState[this.table];
    if (!rows) return { data: one ? null : [], error: null };
    if (this.operation === 'insert') {
      if (this.table === 'uniform_order_requests') {
        const duplicate = this.payload.find((r) => r.client_ref && rows.some((x) => x.client_ref === r.client_ref));
        if (duplicate) return { data: null, error: { code: '23505', message: 'duplicate client_ref' } };
      }
      const created = this.payload.map((row) => this.stamp(this.table, row));
      rows.push(...created);
      return { data: one ? created[0] : created, error: null };
    }
    let found = rows.filter((row) => this.matches(row));
    if (this.operation === 'update') {
      found.forEach((row) => Object.assign(row, this.payload, { updated_at: new Date().toISOString() }));
    }
    for (const [key, asc] of this.orders.slice().reverse()) found.sort((a, b) => asc ? String(a[key]).localeCompare(String(b[key])) : String(b[key]).localeCompare(String(a[key])));
    if (this.max != null) found = found.slice(0, this.max);
    return { data: one ? (found[0] || null) : found.map((row) => ({ ...row })), error: null };
  }
}

const mockSupabase = { from: (table) => new MockQuery(table) };
const mockCustomerEmail = jest.fn(async () => ({ sent: true }));
const mockStaffEmail = jest.fn(async () => ({ sent: true }));
const mockPaymentIntents = new Map();
const mockStripeCreate = jest.fn(async (params) => {
  const intent = { id: 'pi_uniform_test', client_secret: 'secret_uniform_test', status: 'requires_payment_method', ...params };
  mockPaymentIntents.set(intent.id, intent);
  return intent;
});
const mockStripeRetrieve = jest.fn(async (id) => ({ ...mockPaymentIntents.get(id), status: 'succeeded' }));

jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockSupabase,
  verifyUser: async () => ({ ok: true, teamMemberId: 'staff-1', userId: 'auth-1' }),
  pickCols: (obj, allowed) => Object.fromEntries(Object.entries(obj || {}).filter(([key]) => allowed.has(key))),
}));
jest.mock('../../netlify/functions/_uniformOrderEmail', () => ({ sendCustomerEmail: (...args) => mockCustomerEmail(...args), sendStaffEmail: (...args) => mockStaffEmail(...args) }));
jest.mock('stripe', () => () => ({ paymentIntents: { create: (...args) => mockStripeCreate(...args), retrieve: (...args) => mockStripeRetrieve(...args) } }));

const { handler } = require('../../netlify/functions/uniform-order');

const call = async (body, auth = false) => {
  const result = await handler({ httpMethod: 'POST', headers: auth ? { authorization: 'Bearer test' } : {}, body: JSON.stringify(body) });
  return { status: result.statusCode, body: JSON.parse(result.body) };
};

describe('uniform order lifecycle', () => {
  beforeEach(() => {
    mockState.uniform_order_requests.length = 0;
    mockState.uniform_order_proofs.length = 0;
    mockState.uniform_order_events.length = 0;
    mockOrderSeq = 1001; mockEventSeq = 1; mockCustomerEmail.mockClear(); mockStaffEmail.mockClear();
    mockPaymentIntents.clear(); mockStripeCreate.mockClear(); mockStripeRetrieve.mockClear();
    mockStripeCreate.mockImplementation(async (params) => {
      const intent = { id: 'pi_uniform_test', client_secret: 'secret_uniform_test', status: 'requires_payment_method', ...params };
      mockPaymentIntents.set(intent.id, intent);
      return intent;
    });
    mockStripeRetrieve.mockImplementation(async (id) => ({ ...mockPaymentIntents.get(id), status: 'succeeded' }));
    delete process.env.STRIPE_SECRET_KEY;
  });

  const createPayload = {
    action: 'create', client_ref: 'browser-attempt-1', team_name: 'North Stars', sport: 'soccer',
    contact_name: 'Coach Lane', contact_email: 'coach@example.com', total_qty: 12,
    unit_price: 80, total: 960, public_unit_price: 80, fulfillment: 'manual',
    config: { neckStyle: 'agi1012' }, spec: { garmentId: 'agi1012' }, roster: [{ size: 'AM', qty: 12, nums: '1,2' }],
  };

  test('creates one authoritative numbered order and safely reuses a retry', async () => {
    const first = await call(createPayload);
    expect(first.status).toBe(201);
    expect(first.body.order.order_number).toBe('UB-001001');
    expect(first.body.order.production_status).toBe('submitted');
    expect(first.body.order.total).toBe(960);
    expect(mockState.uniform_order_requests).toHaveLength(1);
    expect(mockCustomerEmail).toHaveBeenCalledTimes(1);
    expect(mockStaffEmail).toHaveBeenCalledTimes(1);

    const retry = await call(createPayload);
    expect(retry.status).toBe(200);
    expect(retry.body.reused).toBe(true);
    expect(retry.body.order.order_number).toBe('UB-001001');
    expect(mockState.uniform_order_requests).toHaveLength(1);
  });

  test('replaces tampered browser pricing with the server policy', async () => {
    const result = await call({ ...createPayload, client_ref: 'tampered-price', unit_price: 1, public_unit_price: 1, total: 12, discount_percent: 99 });
    expect(result.status).toBe(201);
    expect(result.body.order.public_unit_price).toBe(80);
    expect(result.body.order.unit_price).toBe(80);
    expect(result.body.order.discount_percent).toBe(0);
    expect(result.body.order.total).toBe(960);
  });

  test('versions proof approval, locks production, ships, and creates a reorder', async () => {
    const created = await call(createPayload);
    const order = created.body.order;
    const publish = await call({ action: 'staff_publish_proof', order_id: order.id, note: 'Check every name and number.' }, true);
    expect(publish.status).toBe(200);
    expect(publish.body.order.proof_version).toBe(1);
    expect(mockState.uniform_order_proofs).toHaveLength(1);

    const approved = await call({ action: 'customer_decision', order_number: order.order_number, token: order.token, decision: 'approved', note: 'Approved.' });
    expect(approved.status).toBe(200);
    expect(approved.body.order.approved_proof_version).toBe(1);

    const locked = await call({ action: 'staff_lock', order_id: order.id }, true);
    expect(locked.status).toBe(200);
    expect(locked.body.order.locked_at).toBeTruthy();

    const production = await call({ action: 'staff_update', order_id: order.id, production_status: 'production' }, true);
    expect(production.body.order.production_status).toBe('production');
    const noTracking = await call({ action: 'staff_update', order_id: order.id, production_status: 'shipped' }, true);
    expect(noTracking.status).toBe(409);
    const shipped = await call({ action: 'staff_update', order_id: order.id, production_status: 'shipped', carrier: 'UPS', tracking_number: '1ZTEST' }, true);
    expect(shipped.status).toBe(200);
    expect(shipped.body.order.tracking_number).toBe('1ZTEST');

    const reorder = await call({ action: 'reorder', order_number: order.order_number, token: order.token, client_ref: 'reorder-1' });
    expect(reorder.status).toBe(201);
    expect(reorder.body.order.parent_order_id).toBe(order.id);
    expect(reorder.body.order.order_number).toBe('UB-001002');
    expect(reorder.body.order.production_status).toBe('submitted');
  });

  test('requires a note when the coach requests changes', async () => {
    const created = await call(createPayload);
    await call({ action: 'staff_publish_proof', order_id: created.body.order.id }, true);
    const result = await call({ action: 'customer_decision', order_number: created.body.order.order_number, token: created.body.order.token, decision: 'changes_requested', note: '' });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/what should change/i);
  });

  test('never trusts a public card-paid claim without server verification', async () => {
    const result = await call({ ...createPayload, client_ref: 'card-attempt-1', fulfillment: 'card', stripe_intent_id: 'pi_test' });
    expect(result.status).toBe(201);
    expect(result.body.order.payment_status).toBe('pending');
    expect(result.body.order.payment_status).not.toBe('paid');
  });

  test('creates the permanent order before Stripe and finalizes only the matching intent', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    const prepared = await call({ ...createPayload, action: 'prepare_card', client_ref: 'order-first-card', method: 'card' });
    expect(prepared.status).toBe(200);
    expect(prepared.body.order.order_number).toBe('UB-001001');
    expect(prepared.body.order.payment_status).toBe('pending');
    expect(prepared.body.subtotal).toBe(960);
    expect(prepared.body.fee).toBe(27.84);
    expect(mockStripeCreate).toHaveBeenCalledWith(expect.objectContaining({ amount: 98784, metadata: expect.objectContaining({ uniform_order_id: prepared.body.order.id }) }), expect.any(Object));

    const finalized = await call({ action: 'finalize_card', order_number: prepared.body.order.order_number, token: prepared.body.order.token, stripe_intent_id: prepared.body.intentId });
    expect(finalized.status).toBe(200);
    expect(finalized.body.order.payment_status).toBe('paid');
    expect(mockState.uniform_order_requests).toHaveLength(1);
  });

  test('never leaks staff-only columns in customer-facing responses', async () => {
    const created = await call({ ...createPayload, client_ref: 'leak-check' });
    const order = created.body.order;
    const noted = await call({ action: 'staff_update', order_id: order.id, rep_review_notes: 'Internal: check credit hold', assigned_rep_id: 'rep-9' }, true);
    expect(noted.status).toBe(200);
    for (const res of [created, await call({ ...createPayload, client_ref: 'leak-check' }), await call({ action: 'status', order_number: order.order_number, token: order.token })]) {
      expect(res.body.order.rep_review_notes).toBeUndefined();
      expect(res.body.order.assigned_rep_id).toBeUndefined();
      expect(res.body.order.stripe_intent_id).toBeUndefined();
      expect(res.body.order.customer_id).toBeUndefined();
      expect(res.body.order.public_token).toBeUndefined();
      expect(res.body.order.token).toBeTruthy();
    }
  });
});
