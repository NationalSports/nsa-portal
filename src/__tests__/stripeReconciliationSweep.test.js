/** @jest-environment node */

jest.mock('stripe', () => jest.fn());
jest.mock('../../netlify/functions/_shared', () => ({ getSupabaseAdmin: jest.fn() }));
jest.mock('../../netlify/functions/_webstoreNotifications', () => ({
  escapeHtml: (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
  sendBrevoEmail: jest.fn().mockResolvedValue('brevo-msg-1'),
}));

const { sendBrevoEmail } = require('../../netlify/functions/_webstoreNotifications');
const {
  buildAlertEmail,
  catchUpUnlinkedOrders,
  claimAndSendAlert,
  isScheduled,
  runSweep,
  runtimeFindings,
  selectCatchUpOrders,
} = require('../../netlify/functions/stripe-reconciliation-sweep');

// A Supabase double that actually applies the filters, ordering and limit the
// production query builds, so the two-lane selection is exercised rather than
// asserted against a hand-picked fixture.
function fakeAdmin({ orders = [], incidents = [], rpc = {} } = {}) {
  const calls = { rpc: [], claims: 0 };
  const tables = { webstore_orders: orders, stripe_reconciliation_incidents: incidents };

  function chain(table) {
    const ops = [];
    const api = {};
    for (const method of ['select', 'eq', 'neq', 'not', 'is', 'in', 'gte', 'lt', 'order', 'limit', 'range']) {
      api[method] = (...args) => { ops.push([method, args]); return api; };
    }
    api.then = (onOk, onErr) => Promise.resolve().then(() => {
      let rows = [...(tables[table] || [])];
      for (const [method, args] of ops) {
        if (method === 'eq') rows = rows.filter((r) => r[args[0]] === args[1]);
        if (method === 'neq') rows = rows.filter((r) => r[args[0]] !== args[1]);
        if (method === 'not') rows = rows.filter((r) => r[args[0]] != null);
        if (method === 'is') rows = rows.filter((r) => r[args[0]] == null);
        if (method === 'in') rows = rows.filter((r) => args[1].includes(r[args[0]]));
        if (method === 'order') {
          const [col, opts] = args;
          const dir = opts && opts.ascending === false ? -1 : 1;
          rows.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0) * dir);
        }
        if (method === 'limit') rows = rows.slice(0, args[0]);
      }
      return { data: rows, error: null };
    }).then(onOk, onErr);
    return api;
  }

  return {
    calls,
    from: (table) => ({ select: (...a) => chain(table).select(...a) }),
    rpc: async (name, params) => {
      calls.rpc.push({ name, params });
      if (name === 'claim_stripe_reconciliation_alert') calls.claims += 1;
      const handler = rpc[name];
      if (typeof handler === 'function') return handler(params, calls);
      if (handler !== undefined) return handler;
      return { data: null, error: null };
    },
  };
}

const order = (id, overrides = {}) => ({
  id,
  so_id: null,
  status: 'paid',
  total: 47.36,
  payment_mode: 'paid',
  stripe_pi_id: `pi_${id}`,
  stripe_balance_transaction_id: null,
  created_at: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  sendBrevoEmail.mockClear();
  sendBrevoEmail.mockResolvedValue('brevo-msg-1');
});

const succeededClient = (btId = 'txn_1') => ({
  paymentIntents: {
    retrieve: jest.fn().mockResolvedValue({
      id: 'pi_x',
      status: 'succeeded',
      latest_charge: {
        id: 'ch_x',
        payment_intent: 'pi_x',
        balance_transaction: {
          id: btId, amount: 4736, fee: 167, net: 4569, currency: 'usd',
          reporting_category: 'charge', type: 'charge', status: 'available',
          created: 1788451200, available_on: 1788624000, fee_details: [],
        },
      },
    }),
  },
});

describe('scheduled-function boundary', () => {
  test('accepts Netlify schedule invocations', () => {
    expect(isScheduled({ headers: { 'x-nf-event': 'schedule' }, body: '{}' })).toBe(true);
    expect(isScheduled({ headers: {}, body: JSON.stringify({ next_run: '2026-09-04T09:17:00Z' }) })).toBe(true);
  });

  test('does not treat an ordinary public request as scheduled', () => {
    expect(isScheduled({ headers: {}, body: '{}' })).toBe(false);
  });
});

describe('actionable-order prioritization', () => {
  // The September 4 incident: one old cancelled order sat behind 54 newer
  // abandoned checkouts and a newest-first batch of 25 never reached it.
  test('a run of newer pending_payment orders cannot starve an old actionable order', async () => {
    const pending = Array.from({ length: 30 }, (_, i) => order(`pending-${String(i).padStart(2, '0')}`, {
      status: 'pending_payment',
      created_at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
    }));
    const admin = fakeAdmin({ orders: [...pending, order('old-actionable', { status: 'cancelled', created_at: '2026-07-06T22:59:17.381Z' })] });

    const selected = await selectCatchUpOrders(admin);
    expect(selected.map((row) => row.id)).toContain('old-actionable');
    // Still bounded, and newest incomplete checkouts remain in the batch so a
    // webhook missed tonight is applied tonight.
    expect(selected.length).toBeLessThanOrEqual(25);
    expect(selected.some((row) => row.status === 'pending_payment')).toBe(true);
  });

  test('the actionable lane is ordered oldest first so an exception cannot stay queued', async () => {
    const admin = fakeAdmin({ orders: [
      order('newer', { created_at: '2026-08-20T00:00:00.000Z' }),
      order('oldest', { created_at: '2026-07-06T22:59:17.381Z' }),
    ] });
    const selected = await selectCatchUpOrders(admin, { actionableLimit: 1, recentLimit: 0 });
    expect(selected.map((row) => row.id)).toEqual(['oldest']);
  });

  test('does not attempt the same order twice when both lanes select it', async () => {
    const admin = fakeAdmin({ orders: [order('only-one')] });
    const selected = await selectCatchUpOrders(admin);
    expect(selected).toHaveLength(1);
  });
});

describe('PaymentIntent classification', () => {
  test('links a succeeded PaymentIntent and records the disposition', async () => {
    const admin = fakeAdmin({ orders: [order('paid-1')] });
    admin.from = ((inner) => (table) => (table === 'webstore_orders'
      ? inner(table)
      : { select: () => ({ eq: () => ({ limit: async () => ({ data: [{ id: 'paid-1', total: 47.36 }], error: null }) }) }),
          upsert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }) }))(admin.from);

    const result = await catchUpUnlinkedOrders(admin, succeededClient());
    expect(result.linked).toEqual(['paid-1']);
    expect(result.checks[0]).toMatchObject({ order_id: 'paid-1', disposition: 'linked', payment_intent_status: 'succeeded' });
  });

  test.each([
    ['requires_payment_method', 'not_succeeded'],
    ['processing', 'not_succeeded'],
    ['canceled', 'not_succeeded'],
  ])('never links a %s PaymentIntent', async (status, disposition) => {
    const admin = fakeAdmin({ orders: [order('unpaid-1')] });
    const client = { paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_x', status, latest_charge: null }) } };
    const result = await catchUpUnlinkedOrders(admin, client);
    expect(result.linked).toEqual([]);
    expect(result.skipped[0]).toMatchObject({ order_id: 'unpaid-1', disposition, payment_intent_status: status });
    expect(result.checks[0]).toMatchObject({ disposition, portal_status: 'paid' });
  });

  test('separates a PaymentIntent Stripe will not return from a transport failure', async () => {
    const missing = Object.assign(new Error('No such payment_intent'), { code: 'resource_missing', statusCode: 404 });
    const admin = fakeAdmin({ orders: [order('gone-1')] });
    const missingResult = await catchUpUnlinkedOrders(admin, {
      paymentIntents: { retrieve: jest.fn().mockRejectedValue(missing) },
    });
    expect(missingResult.checks[0]).toMatchObject({ disposition: 'missing_in_stripe' });
    expect(missingResult.errors).toEqual([]);

    const outage = Object.assign(new Error('connection reset'), { type: 'StripeConnectionError' });
    const errorResult = await catchUpUnlinkedOrders(fakeAdmin({ orders: [order('gone-1')] }), {
      paymentIntents: { retrieve: jest.fn().mockRejectedValue(outage) },
    });
    expect(errorResult.checks[0]).toMatchObject({ disposition: 'error' });
    expect(errorResult.errors[0].error).toContain('connection reset');
  });

  test('stops cleanly at the time budget and reports the remaining work', async () => {
    const admin = fakeAdmin({ orders: [order('a'), order('b'), order('c')] });
    let clock = 0;
    const client = { paymentIntents: { retrieve: jest.fn().mockImplementation(async () => {
      clock += 100;
      return { id: 'pi_x', status: 'processing', latest_charge: null };
    }) } };
    const result = await catchUpUnlinkedOrders(admin, client, { deadlineAt: 150, now: () => clock });
    expect(result.attempted).toBe(2);
    expect(result.remaining).toBe(1);
  });
});

describe('runtime findings', () => {
  test('raises a webhook-coverage incident only when coverage is incomplete', () => {
    expect(runtimeFindings({ webhook: { healthy: true }, payoutSweep: { errors: [] } })).toEqual([]);
    const findings = runtimeFindings({
      webhook: { healthy: false, missing_events: ['charge.refunded'], endpoints: [] },
      payoutSweep: { errors: [{ payout_id: 'po_1', error: 'Stripe timeout' }] },
    });
    expect(findings.map((f) => f.incident_key)).toEqual(['stripe:webhook-coverage', 'payout:catchup-error:po_1']);
    expect(findings.every((f) => f.severity === 'critical')).toBe(true);
  });
});

describe('durable alert delivery', () => {
  const incident = {
    incident_key: 'order:unlinked:dae7f31c',
    category: 'portal_payment_status_review',
    severity: 'warning',
    summary: 'A non-pending card order has no successful Stripe payment.',
    record_type: 'webstore_order',
    record_id: 'dae7f31c',
    details: { portal_status: 'cancelled', portal_total_cents: 4736, payment_intent_status: 'canceled', disposition: 'not_succeeded' },
  };

  test('sends nothing when the outbox has no claimable alert', async () => {
    const admin = fakeAdmin({ rpc: { claim_stripe_reconciliation_alert: { data: [], error: null } } });
    await expect(claimAndSendAlert(admin)).resolves.toEqual({ claimed: false, sent: false });
    expect(sendBrevoEmail).not.toHaveBeenCalled();
  });

  test('sends one email per claimed alert and keys Brevo on the outbox row', async () => {
    const admin = fakeAdmin({
      incidents: [incident],
      rpc: { claim_stripe_reconciliation_alert: { data: [{ id: 'outbox-1', incident_keys: [incident.incident_key] }], error: null } },
    });
    await expect(claimAndSendAlert(admin)).resolves.toMatchObject({ claimed: true, sent: true, incident_count: 1 });
    expect(sendBrevoEmail).toHaveBeenCalledTimes(1);
    expect(sendBrevoEmail.mock.calls[0][1]).toBe('outbox-1');
    expect(admin.calls.rpc).toContainEqual({
      name: 'complete_stripe_reconciliation_alert',
      params: { p_id: 'outbox-1', p_provider_message_id: 'brevo-msg-1' },
    });
  });

  test('requeues the alert when the completion update fails after a provider success', async () => {
    const admin = fakeAdmin({
      incidents: [incident],
      rpc: {
        claim_stripe_reconciliation_alert: { data: [{ id: 'outbox-2', incident_keys: [incident.incident_key] }], error: null },
        complete_stripe_reconciliation_alert: { data: null, error: { message: 'network lost' } },
      },
    });
    await expect(claimAndSendAlert(admin)).rejects.toThrow(/network lost/);
    const failed = admin.calls.rpc.find((call) => call.name === 'fail_stripe_reconciliation_alert');
    expect(failed).toBeTruthy();
    expect(failed.params.p_error).toMatch(/network lost/);
  });

  test('a claimed alert whose incidents already resolved is requeued, not sent blank', async () => {
    const admin = fakeAdmin({
      incidents: [],
      rpc: { claim_stripe_reconciliation_alert: { data: [{ id: 'outbox-3', incident_keys: ['gone'] }], error: null } },
    });
    await expect(claimAndSendAlert(admin)).rejects.toThrow(/no incident rows/);
    expect(sendBrevoEmail).not.toHaveBeenCalled();
  });
});

describe('alert content', () => {
  test('renders the portal status, Stripe status and catch-up disposition for a skipped order', () => {
    const email = buildAlertEmail([{
      incident_key: 'order:unlinked:dae7f31c',
      category: 'portal_payment_status_review',
      severity: 'warning',
      summary: 'A non-pending card order has no successful Stripe payment.',
      record_type: 'webstore_order',
      record_id: 'dae7f31c-02e6-4407-aa82-2cea5d145052',
      details: {
        so_id: null, portal_status: 'cancelled', portal_total_cents: 4736,
        created_at: '2026-07-06T22:59:17.381Z',
        payment_intent_id: 'pi_3TqLTtAMQabcdefghijkl',
        payment_intent_status: 'canceled', disposition: 'not_succeeded',
      },
    }]);
    expect(email.htmlContent).toContain('Portal status: cancelled');
    expect(email.htmlContent).toContain('Stripe status: canceled');
    expect(email.htmlContent).toContain('Catch-up disposition: not_succeeded');
    expect(email.htmlContent).toContain('Portal total: $47.36');
    // Truncated, never the full PaymentIntent reference.
    expect(email.htmlContent).toContain('pi_3TqLTtAMQab…');
    expect(email.htmlContent).not.toContain('pi_3TqLTtAMQabcdefghijkl');
    expect(email.htmlContent).toContain('Do not link or mark it paid');
    expect(email.htmlContent).toContain('No QuickBooks transaction is posted automatically');
    expect(email.subject).toContain('0 critical');
  });

  test('escapes every diagnostic field taken from a record', () => {
    const email = buildAlertEmail([{
      incident_key: 'order:unlinked:x',
      category: 'order_link_error',
      severity: 'critical',
      summary: 'A card order could not be checked against Stripe.',
      record_type: 'webstore_order',
      record_id: '<img src=x onerror=alert(1)>',
      details: { portal_status: '<script>alert("xss")</script>', last_error: "it's <bad>" },
    }]);
    expect(email.htmlContent).not.toContain('<script>');
    expect(email.htmlContent).not.toContain('<img src=x');
    expect(email.htmlContent).toContain('&lt;script&gt;');
    expect(email.htmlContent).toContain('&#39;s &lt;bad&gt;');
  });
});

describe('sweep composition', () => {
  test('records checks, syncs incidents with runtime findings, and drains one alert', async () => {
    const admin = fakeAdmin({
      orders: [order('unpaid-1')],
      incidents: [{
        incident_key: 'order:unlinked:unpaid-1', category: 'portal_payment_status_review',
        severity: 'warning', summary: 'review', record_type: 'webstore_order',
        record_id: 'unpaid-1', details: {},
      }],
      rpc: {
        record_stripe_reconciliation_order_checks: { data: 1, error: null },
        sync_stripe_reconciliation_incidents: { data: { finding_count: 1, open_incident_count: 1, resolved_count: 0, alert_created: true }, error: null },
        claim_stripe_reconciliation_alert: { data: [{ id: 'outbox-9', incident_keys: ['order:unlinked:unpaid-1'] }], error: null },
      },
    });
    const client = {
      paymentIntents: { retrieve: jest.fn().mockResolvedValue({ id: 'pi_x', status: 'canceled', latest_charge: null }) },
      payouts: { list: jest.fn().mockResolvedValue({ data: [], has_more: false }) },
      webhookEndpoints: { list: jest.fn().mockResolvedValue({ data: [{ id: 'we_1', url: 'https://nsa-portal.netlify.app/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: ['*'] }], has_more: false }) },
    };

    const result = await runSweep(admin, client);

    expect(result).toMatchObject({ ok: false, open_incident_count: 1, alert_sent: true, checks_recorded: 1 });
    const recorded = admin.calls.rpc.find((call) => call.name === 'record_stripe_reconciliation_order_checks');
    expect(recorded.params.p_checks[0]).toMatchObject({ order_id: 'unpaid-1', disposition: 'not_succeeded', portal_status: 'paid' });
    const synced = admin.calls.rpc.find((call) => call.name === 'sync_stripe_reconciliation_incidents');
    expect(synced.params.p_runtime_findings).toEqual([]);
    // Exactly one claim per invocation: a retry cannot fan out into extra sends.
    expect(admin.calls.claims).toBe(1);
    expect(result.timings.total_ms).toBeGreaterThanOrEqual(0);
  });

  test('reports a healthy sweep with no open incidents and no alert', async () => {
    const admin = fakeAdmin({
      orders: [],
      rpc: {
        sync_stripe_reconciliation_incidents: { data: { finding_count: 0, open_incident_count: 0, resolved_count: 2, alert_created: false }, error: null },
        claim_stripe_reconciliation_alert: { data: [], error: null },
      },
    });
    const client = {
      payouts: { list: jest.fn().mockResolvedValue({ data: [], has_more: false }) },
      webhookEndpoints: { list: jest.fn().mockResolvedValue({ data: [{ id: 'we_1', url: 'https://nsa-portal.netlify.app/.netlify/functions/stripe-webhook', status: 'enabled', enabled_events: ['*'] }], has_more: false }) },
    };
    const result = await runSweep(admin, client);
    expect(result).toMatchObject({ ok: true, resolved_count: 2, alert_sent: false });
    expect(sendBrevoEmail).not.toHaveBeenCalled();
  });
});
