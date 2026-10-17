/** @jest-environment node */

const crypto = require('crypto');

function fakeAdmin(invoice) {
  const db = {
    invoices: Array.isArray(invoice) ? invoice : [invoice],
    app_state: [{ id: 'portal_settings', value: { ccFeePct: 0.029 } }],
    invoice_payment_intents: [],
  };
  const attempts = new Map();
  const from = (table) => {
    const state = { filters: [], one: false };
    const rows = () => (db[table] || []).filter((row) => state.filters.every(([kind, col, value]) => {
      if (kind === 'eq') return String(row[col]) === String(value);
      if (kind === 'in') return value.map(String).includes(String(row[col]));
      if (kind === 'is') return row[col] == null;
      if (kind === 'overlaps') return (row[col] || []).some((item) => value.includes(item));
      return true;
    }));
    const chain = {
      select: () => chain,
      eq: (col, value) => { state.filters.push(['eq', col, value]); return chain; },
      in: (col, value) => { state.filters.push(['in', col, value]); return chain; },
      is: (col, value) => { state.filters.push(['is', col, value]); return chain; },
      overlaps: (col, value) => { state.filters.push(['overlaps', col, value]); return chain; },
      maybeSingle: () => { state.one = true; return chain; },
      then: (resolve, reject) => Promise.resolve({
        data: state.one ? (rows()[0] || null) : rows().map((row) => ({ ...row })),
        error: null,
      }).then(resolve, reject),
    };
    return chain;
  };
  const rpc = async (name, args) => {
    if (name === 'claim_stripe_payment_attempt') {
      let row = attempts.get(args.p_payable_scope_key);
      if (!row) {
        row = [...attempts.values()].find((attempt) =>
          (attempt.invoice_ids || []).some((id) => args.p_invoice_ids.includes(id)) && !attempt.superseded);
      }
      if (!row) {
        row = {
          payable_scope_key: args.p_payable_scope_key,
          payable_key: args.p_payable_key,
          attempt_version: 1,
          idempotency_key: `nsa_pi_${args.p_payable_key}_v1`,
          amount_cents: args.p_amount_cents,
          currency: args.p_currency,
          method: args.p_method,
          invoice_ids: args.p_invoice_ids,
          stripe_intent_id: null,
          stripe_status: 'claimed',
        };
        attempts.set(args.p_payable_scope_key, row);
      }
      return { data: { ...row }, error: null };
    }
    if (name === 'attach_stripe_payment_intent') {
      const row = [...attempts.values()].find((attempt) => attempt.payable_key === args.p_payable_key);
      if (row.stripe_intent_id && row.stripe_intent_id !== args.p_stripe_intent_id) {
        return { data: null, error: { message: 'different intent' } };
      }
      Object.assign(row, { stripe_intent_id: args.p_stripe_intent_id, stripe_status: args.p_stripe_status });
      return { data: { ...row }, error: null };
    }
    if (name === 'supersede_stripe_payment_attempt') {
      const prior = attempts.get(args.p_payable_scope_key);
      if (prior.stripe_intent_id !== args.p_prior_intent_id) return { data: { ...prior }, error: null };
      const next = {
        ...prior,
        payable_key: args.p_payable_key,
        attempt_version: prior.attempt_version + 1,
        idempotency_key: `nsa_pi_${args.p_payable_key}_v${prior.attempt_version + 1}`,
        amount_cents: args.p_amount_cents,
        currency: args.p_currency,
        method: args.p_method,
        invoice_ids: args.p_invoice_ids,
        stripe_intent_id: null,
        stripe_status: 'claimed',
      };
      attempts.set(args.p_payable_scope_key, next);
      return { data: { ...next }, error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  };
  return { db, attempts, from, rpc };
}

describe('server-owned Stripe invoice payment attempts', () => {
  let admin;
  let intents;
  let byKey;
  let createCalls;
  let listedIntents;
  let handler;

  beforeEach(() => {
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test_idempotency';
    admin = fakeAdmin({ id: 'INV-42', total: 100, paid: 0, status: 'open', customer_id: 'C-7', so_id: 'SO-9' });
    intents = new Map();
    byKey = new Map();
    createCalls = [];
    listedIntents = [];
    const client = {
      paymentIntents: {
        create: jest.fn(async (params, options) => {
          createCalls.push({ params, options });
          await new Promise((resolve) => setImmediate(resolve));
          if (byKey.has(options.idempotencyKey)) return byKey.get(options.idempotencyKey);
          const intent = {
            id: `pi_${byKey.size + 1}`,
            client_secret: `cs_${byKey.size + 1}`,
            status: 'requires_payment_method',
            amount: params.amount,
            amount_received: 0,
            currency: params.currency,
            payment_method_types: params.payment_method_types,
            metadata: params.metadata,
            latest_charge: null,
          };
          byKey.set(options.idempotencyKey, intent);
          intents.set(intent.id, intent);
          return intent;
        }),
        retrieve: jest.fn(async (id) => intents.get(id)),
        cancel: jest.fn(async (id) => {
          const intent = intents.get(id);
          intent.status = 'canceled';
          return intent;
        }),
        // Force the durable attempt ledger + Stripe key to prove the concurrent
        // case rather than letting the legacy seven-day scan win the race.
        list: jest.fn(async () => ({ data: listedIntents, has_more: false })),
      },
    };
    jest.doMock('stripe', () => () => client);
    jest.doMock('../../netlify/functions/_shared', () => ({
      ...jest.requireActual('../../netlify/functions/_shared'),
      getSupabaseAdmin: () => admin,
    }));
    ({ handler } = require('../../netlify/functions/stripe-payment'));
  });

  const call = async (extra = {}) => {
    const response = await handler({
      httpMethod: 'POST',
      body: JSON.stringify({
        action: 'create_intent',
        invoice_id: 'INV-42',
        customer_email: 'payer@example.com',
        customer_name: 'Payer',
        method: 'bank',
        amount_cents: 10000,
        ...extra,
      }),
    });
    return { status: response.statusCode, body: JSON.parse(response.body) };
  };

  test('a retry with a different caller key reuses the recorded intent', async () => {
    const first = await call({ idempotency_key: crypto.randomUUID() });
    const second = await call({ idempotency_key: crypto.randomUUID() });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.intentId).toBe(first.body.intentId);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0].options.idempotencyKey).toMatch(/^nsa_pi_[a-f0-9]{64}_v1$/);
  });

  test('concurrent double-submit converges on one Stripe intent', async () => {
    const [left, right] = await Promise.all([
      call({ idempotency_key: 'attacker-key-a' }),
      call({ idempotency_key: 'attacker-key-b' }),
    ]);
    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(left.body.intentId).toBe(right.body.intentId);
    expect(new Set(createCalls.map((entry) => entry.options.idempotencyKey)).size).toBe(1);
    expect(intents.size).toBe(1);
  });

  test('overlapping invoice groups cannot acquire separate live attempts', async () => {
    admin.db.invoices.push({ id: 'INV-43', total: 50, paid: 0, status: 'open', customer_id: 'C-7', so_id: 'SO-10' });
    const [single, overlapping] = await Promise.all([
      call(),
      call({ invoice_id: 'INV-42,INV-43', amount_cents: 15000 }),
    ]);
    expect([single.status, overlapping.status].sort()).toEqual([200, 409]);
    expect(intents.size).toBe(1);
  });

  test('a pre-migration requires_action intent is adopted instead of duplicated', async () => {
    const legacy = {
      id: 'pi_legacy_action',
      client_secret: 'cs_legacy_action',
      status: 'requires_action',
      amount: 10000,
      amount_received: 0,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      metadata: { invoice_id: 'INV-42' },
    };
    intents.set(legacy.id, legacy);
    listedIntents.push(legacy);
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body.intentId).toBe(legacy.id);
    expect(createCalls).toHaveLength(0);
  });

  test('extra pre-migration intents are canceled before one is adopted', async () => {
    const legacy = ['a', 'b'].map((suffix) => ({
      id: `pi_legacy_${suffix}`,
      client_secret: `cs_legacy_${suffix}`,
      status: 'requires_action',
      amount: 10000,
      amount_received: 0,
      currency: 'usd',
      payment_method_types: ['us_bank_account'],
      metadata: { invoice_id: 'INV-42' },
    }));
    legacy.forEach((intent) => intents.set(intent.id, intent));
    listedIntents.push(...legacy);
    const result = await call();
    expect(result.status).toBe(200);
    expect(result.body.intentId).toBe('pi_legacy_a');
    expect(intents.get('pi_legacy_b').status).toBe('canceled');
    expect(createCalls).toHaveLength(0);
  });

  test('a fully refunded charge advances the server version exactly once', async () => {
    const first = await call();
    const original = intents.get(first.body.intentId);
    Object.assign(original, {
      status: 'succeeded',
      amount_received: 10000,
      latest_charge: { amount_refunded: 10000 },
    });
    const replacement = await call({ idempotency_key: 'ignored-new-key' });
    expect(replacement.status).toBe(200);
    expect(replacement.body.intentId).not.toBe(first.body.intentId);
    expect(createCalls).toHaveLength(2);
    expect(createCalls[1].options.idempotencyKey).toMatch(/_v2$/);
  });

  test('an authoritative amount change gets a distinct payable key', async () => {
    const first = await call();
    admin.db.invoices[0].total = 125;
    const changed = await call({ amount_cents: 12500 });
    expect(changed.status).toBe(200);
    expect(changed.body.intentId).not.toBe(first.body.intentId);
    expect(intents.get(first.body.intentId).status).toBe('canceled');
    expect(new Set(createCalls.map((entry) => entry.options.idempotencyKey)).size).toBe(2);
  });

  test('a caller cannot underpay the server-computed balance', async () => {
    const result = await call({ amount_cents: 50 });
    expect(result.status).toBe(409);
    expect(createCalls).toHaveLength(0);
  });

  test('legacy in-place repricing is disabled', async () => {
    const result = await call({ action: 'update_intent', intent_id: 'pi_any', amount_cents: 50 });
    expect(result.status).toBe(409);
    expect(createCalls).toHaveLength(0);
  });

  test('void invoices are rejected before Stripe is called', async () => {
    admin.db.invoices[0].status = 'void';
    const result = await call();
    expect(result.status).toBe(409);
    expect(createCalls).toHaveLength(0);
  });
});
