describe('coach invoice PaymentIntent capture boundary', () => {
  let previousEnv;

  beforeEach(() => {
    jest.resetModules();
    previousEnv = { ...process.env };
    process.env.STRIPE_SECRET_KEY = 'sk_test';
  });

  afterEach(() => {
    process.env = previousEnv;
    jest.restoreAllMocks();
  });

  const loadHandler = ({
    rows = [], dbError = null, family = new Set(['cust-1']), intent,
    setting = { ccFeePct: 0.029 }, settingError = null,
  } = {}) => {
    const create = jest.fn().mockResolvedValue({ id: 'pi_created', client_secret: 'secret' });
    const update = jest.fn().mockResolvedValue({ amount: 100000 });
    const retrieve = jest.fn().mockResolvedValue(intent);
    const list = jest.fn().mockResolvedValue({ data: [], has_more: false });
    const stripeClient = { paymentIntents: { create, update, retrieve, list } };
    const invoiceQuery = {};
    invoiceQuery.select = jest.fn(() => invoiceQuery);
    invoiceQuery.in = jest.fn().mockResolvedValue({ data: rows, error: dbError });
    const settingQuery = {};
    settingQuery.select = jest.fn(() => settingQuery);
    settingQuery.eq = jest.fn(() => settingQuery);
    settingQuery.maybeSingle = jest.fn().mockResolvedValue({
      data: setting == null ? null : { value: JSON.stringify(setting) }, error: settingError,
    });
    const admin = { from: jest.fn((table) => (table === 'app_state' ? settingQuery : invoiceQuery)) };
    const resolveCustomerFamily = jest.fn().mockResolvedValue({ fam: family });

    jest.doMock('stripe', () => jest.fn(() => stripeClient));
    jest.doMock('../../netlify/functions/_shared', () => ({
      verifyUser: jest.fn(), verifyAdmin: jest.fn(),
      getSupabaseAdmin: jest.fn(() => admin), resolveCustomerFamily,
      reconcileInvoiceFromIntent: jest.fn(),
    }));
    jest.doMock('../../netlify/functions/_webstoreEmail', () => ({ sendRefundNotice: jest.fn() }));
    const { handler } = require('../../netlify/functions/stripe-payment');
    return { handler, create, update, retrieve, list, admin, resolveCustomerFamily, settingQuery };
  };

  const invoke = (handler, body) => handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  const invoice = (id = 'INV-1', customer_id = 'cust-1', total = 1000, paid = 0) => (
    { id, customer_id, total, paid, status: 'open' }
  );

  test('rejects a $0.50 request for a $1,000 invoice before any Stripe lookup or create', async () => {
    const ctx = loadHandler({ rows: [invoice()] });
    const response = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 50, method: 'bank',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });

    expect(response.statusCode).toBe(400);
    expect(ctx.list).not.toHaveBeenCalled();
    expect(ctx.create).not.toHaveBeenCalled();
  });

  test('rejects a real invoice plus typo unless the entire requested set resolves', async () => {
    const ctx = loadHandler({ rows: [invoice()] });
    const response = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 100000, method: 'bank',
      invoice_id: 'INV-1,INV-TYPO', alpha_tag: 'TEAM',
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/Every requested invoice/);
    expect(ctx.list).not.toHaveBeenCalled();
    expect(ctx.create).not.toHaveBeenCalled();
  });

  test('fails closed on invoice read errors and cross-family invoices', async () => {
    const failed = loadHandler({ dbError: { message: 'database unavailable' } });
    const failedResponse = await invoke(failed.handler, {
      action: 'create_intent', amount_cents: 100000, method: 'bank',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });
    expect(failedResponse.statusCode).toBe(503);
    expect(failed.create).not.toHaveBeenCalled();

    jest.resetModules();
    const outside = loadHandler({ rows: [invoice('INV-1', 'cust-other')] });
    const outsideResponse = await invoke(outside.handler, {
      action: 'create_intent', amount_cents: 100000, method: 'bank',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });
    expect(outsideResponse.statusCode).toBe(403);
    expect(outside.create).not.toHaveBeenCalled();
  });

  test('rejects terminal invoice status before any Stripe lookup or create', async () => {
    const ctx = loadHandler({ rows: [{ ...invoice(), status: 'void' }] });
    const response = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 100000, method: 'bank',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });

    expect(response.statusCode).toBe(409);
    expect(ctx.list).not.toHaveBeenCalled();
    expect(ctx.create).not.toHaveBeenCalled();
  });

  test('creates only the exact authoritative bank balance', async () => {
    const ctx = loadHandler({ rows: [invoice()] });
    const response = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 100000, method: 'bank',
      invoice_id: 'INV-1', alpha_tag: 'TEAM', customer_email: 'coach@example.com',
    });

    expect(response.statusCode).toBe(200);
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({
      amount: 100000, payment_method_types: ['us_bank_account'],
      metadata: expect.objectContaining({ invoice_id: 'INV-1', source: 'nsa_coach_portal' }),
    }), expect.objectContaining({ idempotencyKey: expect.any(String) }));
    expect(ctx.create.mock.calls[0][0].metadata).not.toHaveProperty('alpha_tag');
    expect(JSON.parse(response.body)).toMatchObject({ subtotal: 1000, fee: 0 });
  });

  test('requires and returns the exact canonical 3% portal-settings card fee', async () => {
    const ctx = loadHandler({ rows: [invoice()], setting: { ccFeePct: 0.03 } });
    const config = await invoke(ctx.handler, { action: 'config' });
    expect(config.statusCode).toBe(200);
    expect(JSON.parse(config.body).invoiceCardFeePct).toBe(0.03);

    const wrong = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 102900, method: 'card',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });
    expect(wrong.statusCode).toBe(400);
    expect(ctx.create).not.toHaveBeenCalled();

    const exact = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 103000, method: 'card',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });
    expect(exact.statusCode).toBe(200);
    expect(ctx.create).toHaveBeenCalledWith(expect.objectContaining({ amount: 103000, payment_method_types: ['card'] }), expect.any(Object));
    expect(JSON.parse(exact.body)).toMatchObject({ subtotal: 1000, fee: 30 });
  });

  test('fails closed on portal payment settings errors before a card intent is created', async () => {
    const ctx = loadHandler({ rows: [invoice()], settingError: { message: 'database unavailable' } });
    const response = await invoke(ctx.handler, {
      action: 'create_intent', amount_cents: 102900, method: 'card',
      invoice_id: 'INV-1', alpha_tag: 'TEAM',
    });

    expect(response.statusCode).toBe(503);
    expect(ctx.list).not.toHaveBeenCalled();
    expect(ctx.create).not.toHaveBeenCalled();
  });

  test('update_intent cannot mutate Stripe to a client-chosen underpayment', async () => {
    const intent = {
      id: 'pi_existing', status: 'requires_payment_method',
      payment_method_types: ['card', 'us_bank_account'],
      metadata: { source: 'nsa_coach_portal', invoice_id: 'INV-1' },
    };
    const ctx = loadHandler({ rows: [invoice()], intent });
    const response = await invoke(ctx.handler, {
      action: 'update_intent', intent_id: 'pi_existing', amount_cents: 50,
    });

    expect(ctx.retrieve).toHaveBeenCalledWith('pi_existing');
    expect(response.statusCode).toBe(400);
    expect(ctx.update).not.toHaveBeenCalled();
  });

  test('update_intent permits only the exact authoritative ACH balance', async () => {
    const intent = {
      id: 'pi_existing', status: 'requires_payment_method',
      payment_method_types: ['card', 'us_bank_account'],
      metadata: { source: 'nsa_coach_portal', invoice_id: 'INV-1' },
    };
    const ctx = loadHandler({ rows: [invoice()], intent });
    const response = await invoke(ctx.handler, {
      action: 'update_intent', intent_id: 'pi_existing', amount_cents: 100000,
    });

    expect(response.statusCode).toBe(200);
    expect(ctx.update).toHaveBeenCalledWith('pi_existing', { amount: 100000 });
  });
});
