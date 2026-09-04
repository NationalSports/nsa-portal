const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
let consoleError;
beforeEach(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { consoleError.mockRestore(); });

describe('atomic Stripe invoice settlement helper', () => {
  const { reconcileInvoiceFromIntent } = require('../../netlify/functions/_shared');

  test('sends the complete PaymentIntent to one RPC with actual ACH method and settlement date', async () => {
    const allocations = [
      { invoice_id: 'INV-A', principal_cents: 10000, fee_cents: 0, amount_cents: 10000 },
      { invoice_id: 'INV-B', principal_cents: 10000, fee_cents: 0, amount_cents: 10000 },
    ];
    const admin = { rpc: jest.fn().mockResolvedValue({ data: { ok: true, allocations }, error: null }) };

    const result = await reconcileInvoiceFromIntent(admin, {
      id: 'pi_atomic', status: 'succeeded', amount_received: 20000,
      metadata: { invoice_id: 'INV-B, INV-A, INV-A' },
      payment_method_types: ['us_bank_account'],
    }, { settledAt: Date.parse('2026-09-04T02:00:00Z') / 1000 });

    expect(admin.rpc).toHaveBeenCalledTimes(1);
    expect(admin.rpc).toHaveBeenCalledWith('settle_stripe_invoice_payment', {
      p_payment_intent_id: 'pi_atomic',
      p_invoice_ids: ['INV-B', 'INV-A'],
      p_captured_cents: 20000,
      p_payment_method: 'ach',
      p_payment_date: '09/03/2026',
    });
    expect(result.reconciled).toEqual(['INV-A', 'INV-B']);
  });

  test('throws on a failed transaction so callers cannot report success', async () => {
    const admin = { rpc: jest.fn().mockResolvedValue({ data: null, error: { message: 'rollback' } }) };
    await expect(reconcileInvoiceFromIntent(admin, {
      id: 'pi_failed', status: 'succeeded', amount_received: 20600,
      metadata: { invoice_id: 'INV-A,INV-B' }, payment_method_types: ['card'],
    })).rejects.toThrow('Invoice settlement failed: rollback');
  });

  test('rejects non-integral captured amounts before any database call', async () => {
    const admin = { rpc: jest.fn() };
    await expect(reconcileInvoiceFromIntent(admin, {
      id: 'pi_bad', status: 'succeeded', amount_received: 206.5, metadata: { invoice_id: 'INV-A' },
    })).rejects.toThrow('captured amount is invalid');
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  test('refuses to settle a PaymentIntent that has not succeeded', async () => {
    const admin = { rpc: jest.fn() };
    await expect(reconcileInvoiceFromIntent(admin, {
      id: 'pi_processing', status: 'processing', amount_received: 10000,
      metadata: { invoice_id: 'INV-A' },
    })).rejects.toThrow('Only a succeeded Stripe PaymentIntent');
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  test('does not report a coach invoice payment reconciled when no invoice exists', async () => {
    const admin = { rpc: jest.fn().mockResolvedValue({
      data: { ok: true, ignored: true, reason: 'no_invoices', allocations: [] }, error: null,
    }) };
    await expect(reconcileInvoiceFromIntent(admin, {
      id: 'pi_missing', status: 'succeeded', amount_received: 10000,
      metadata: { invoice_id: 'INV-MISSING', source: 'nsa_coach_portal' },
    })).rejects.toThrow('referenced invoices were not found');
  });
});

describe('settlement migration invariants', () => {
  const migration = read('supabase/migrations/20260904224514_atomic_stripe_invoice_settlement.sql');

  test('locks the PaymentIntent and full invoice set before applying cents', () => {
    expect(migration).toContain('pg_advisory_xact_lock(hashtextextended(p_payment_intent_id, 0))');
    expect(migration).toContain('order by i.id for update');
    expect(migration).toContain('v_found <> v_expected');
    expect(migration).toContain('v_fee_remaining');
    expect(migration).toContain('allocation cents do not equal captured cents');
    expect(migration).toContain("not in ('open', 'partial', 'overdue')");
    expect(migration).toContain('v_principal_cents * 0.10');
  });

  test('keeps invoice summaries, allocations, and required ledger rows in the RPC transaction', () => {
    expect(migration).toContain('update public.invoices');
    expect(migration).toContain('insert into public.invoice_payments');
    expect(migration).toContain('insert into public.stripe_invoice_payment_allocations');
    expect(migration).toContain('legacy partial Stripe application requires manual review');
  });

  test('allows only the service role to call the privileged function or allocation table', () => {
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).not.toMatch(/grant execute[\s\S]*to authenticated/i);
  });

  test('portal waits for commit and shows delayed-accounting feedback', () => {
    const portal = read('src/CoachPortal.js');
    expect(portal).toContain("const resp=await fetch('/.netlify/functions/stripe-payment'");
    expect(portal).toContain('Payment Received \u2014 Account Update Pending');
    expect(portal).toContain('Please do not pay again');
    expect(portal).not.toContain("if(result.intentId)fetch('/.netlify/functions/stripe-payment'");
  });
});

describe('finalization failure propagation', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.STRIPE_SECRET_KEY = 'sk_test';
  });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    jest.dontMock('stripe');
    jest.dontMock('../../netlify/functions/_shared');
    jest.dontMock('../../netlify/functions/_webstoreEmail');
  });

  test('public finalize returns retryable 503 when the accounting transaction rolls back', async () => {
    const retrieve = jest.fn().mockResolvedValue({ id: 'pi_rollback', status: 'succeeded' });
    jest.doMock('stripe', () => jest.fn(() => ({ paymentIntents: { retrieve } })));
    jest.doMock('../../netlify/functions/_shared', () => ({
      verifyUser: jest.fn(), verifyAdmin: jest.fn(), getSupabaseAdmin: jest.fn(() => ({})),
      reconcileInvoiceFromIntent: jest.fn().mockRejectedValue(new Error('rollback')),
    }));
    jest.doMock('../../netlify/functions/_webstoreEmail', () => ({ sendRefundNotice: jest.fn() }));
    const { handler } = require('../../netlify/functions/stripe-payment');

    const response = await handler({ httpMethod: 'POST', body: JSON.stringify({
      action: 'finalize_invoice', payment_intent_id: 'pi_rollback',
    }) });

    expect(retrieve).toHaveBeenCalledWith('pi_rollback', { expand: ['latest_charge', 'payment_method'] });
    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toMatchObject({ ok: false, retryable: true });
  });

  test('signed webhook returns 500 when invoice settlement rolls back', async () => {
    jest.resetModules();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

    const query = {};
    ['select', 'eq', 'neq', 'update', 'insert', 'limit'].forEach((name) => {
      query[name] = jest.fn(() => query);
    });
    query.then = (resolve) => Promise.resolve({ data: [], error: null }).then(resolve);
    const sb = { from: jest.fn(() => query), rpc: jest.fn().mockResolvedValue({ data: null, error: null }) };
    const evt = {
      type: 'payment_intent.succeeded', created: 1788487200,
      data: { object: { id: 'pi_webhook', amount_received: 10000, metadata: { invoice_id: 'INV-A' } } },
    };
    const reconcile = jest.fn().mockRejectedValue(new Error('transaction rollback'));

    jest.doMock('stripe', () => jest.fn(() => ({
      webhooks: { constructEvent: jest.fn(() => evt) },
    })));
    jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn(() => sb) }));
    jest.doMock('../../netlify/functions/_shared', () => ({ reconcileInvoiceFromIntent: reconcile }));
    jest.doMock('../../netlify/functions/_webstoreEmail', () => ({
      sendOrderConfirmation: jest.fn(), bumpCouponUse: jest.fn(),
    }));
    jest.doMock('../../netlify/functions/_uniformOrderEmail', () => ({
      sendCustomerEmail: jest.fn(), sendStaffEmail: jest.fn(),
    }));
    jest.doMock('../../netlify/functions/_stripeReconciliation', () => ({
      recordDisputeFinancials: jest.fn(),
      recordPaymentIntentFinancials: jest.fn().mockResolvedValue(null),
      recordPayoutReconciliation: jest.fn(), recordPayoutStatus: jest.fn(), recordRefundFinancials: jest.fn(),
    }));

    const { handler } = require('../../netlify/functions/stripe-webhook');
    const response = await handler({ httpMethod: 'POST', headers: { 'stripe-signature': 'sig' }, body: '{}' });

    expect(reconcile).toHaveBeenCalledWith(sb, evt.data.object, { settledAt: evt.created });
    expect(response.statusCode).toBe(500);

    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });
});
