/* Unit tests for the Claude-powered Team Shop assistant function
 * (netlify/functions/teamshop-assistant.js). Same mocking style as
 * teamshopOrders.test.js: _shared mocked so getSupabaseAdmin never needs
 * real credentials, plus @anthropic-ai/sdk mocked so no network/API key is
 * ever touched. Covers: missing-API-key fallback, server-side message caps,
 * the grounded system prompt + exact request shape (claude-sonnet-5,
 * thinking disabled, effort low, cached system block, no sampling params),
 * coach-tool gating on a verified token, family lookup matching + safe-field
 * filtering + abuse caps, and the bounded tool loop. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => {
    if (!mockAdmin) throw new Error('Supabase service credentials missing');
    return mockAdmin;
  },
}));

let mockCreate = jest.fn();
// Plain function, not jest.fn(): CRA's jest config sets resetMocks:true, which
// would wipe a factory-time mockImplementation before every test.
jest.mock('@anthropic-ai/sdk', () => function AnthropicMock() {
  return { messages: { create: (...args) => mockCreate(...args) } };
});

const assistant = require('../../netlify/functions/teamshop-assistant');
const { FAQS } = require('../../src/lib/teamshopFaq');

// ── Fake supabase admin: chainable, records the filters applied per query ──
function fakeSb(tables, user) {
  const queries = [];
  return {
    queries,
    auth: {
      getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }),
    },
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const q = { table, filters: [] };
      queries.push(q);
      const chain = {
        select: (cols) => { q.select = cols; return chain; },
        eq: (col, val) => { q.filters.push(['eq', col, val]); return chain; },
        in: (col, val) => { q.filters.push(['in', col, val]); return chain; },
        ilike: (col, val) => { q.filters.push(['ilike', col, val]); return chain; },
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: 'custA', auth_user_id: 'auth1' };

const COACH_ORDER = {
  id: 'ord1', order_number: 1010042, created_at: '2026-07-01T00:00:00Z', status: 'paid', total: 249.5,
  buyer_name: 'Coach A', status_token: 'tokC', so_id: 'SO-1', customer_id: 'custA', order_source: 'teamshop',
};

const FAMILY_ORDER = {
  id: 'ordF', order_number: 1010099, created_at: '2026-07-02T00:00:00Z', status: 'paid',
  status_token: 'tokF', so_id: null,
  // Fields that must NEVER leak (the real select never asks for them, but the
  // stub returns the whole row — the function's whitelists must strip them):
  buyer_email: 'family@example.com', ship_address: '1 Main St', po_number: 'PO-77', total: 55,
};

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [{ customer_id: 'custA' }], error: null },
  webstore_orders: { data: [COACH_ORDER], error: null },
  webstore_order_items: { data: [{ order_id: 'ord1', product_id: 'p1', sku: 'SKU1', name: 'Polo', qty: 2, size: 'M', image_url: null }], error: null },
  webstore_shipments: { data: [], error: null },
  so_jobs: { data: [{ so_id: 'SO-1', prod_status: 'in_process' }], error: null },
  ...over,
});

const textResponse = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const toolUseResponse = (uses) => ({ stop_reason: 'tool_use', content: uses.map((u, i) => ({ type: 'tool_use', id: `tu${i}`, name: u.name, input: u.input || {} })) });

const call = ({
  user = { id: 'auth1', email: 'coach@team.com' },
  tables = baseTables(),
  auth = null,
  method = 'POST',
  body = { messages: [{ role: 'user', text: 'hello' }] },
} = {}) => {
  mockAdmin = fakeSb(tables, user);
  return assistant.handler({
    httpMethod: method,
    headers: auth ? { authorization: auth } : {},
    body: JSON.stringify(body),
  });
};

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  mockCreate = jest.fn(async () => textResponse('Hi there!'));
  mockAdmin = null;
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

describe('guards and fallback', () => {
  test('rejects non-POST', async () => {
    const r = await call({ method: 'GET' });
    expect(r.statusCode).toBe(405);
  });

  test('missing ANTHROPIC_API_KEY -> { fallback: true }, no model call', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const r = await call();
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ fallback: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  test('unconfigured supabase -> { fallback: true }', async () => {
    const r = await (() => {
      mockAdmin = null; // getSupabaseAdmin throws
      return assistant.handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ messages: [{ role: 'user', text: 'hi' }] }) });
    })();
    expect(JSON.parse(r.body)).toEqual({ fallback: true });
  });

  test('an Anthropic API failure -> { fallback: true } (widget keeps v1)', async () => {
    mockCreate = jest.fn(async () => { throw new Error('overloaded'); });
    const r = await call();
    expect(JSON.parse(r.body)).toEqual({ fallback: true });
  });

  test('empty / assistant-only messages -> 400', async () => {
    const r1 = await call({ body: { messages: [] } });
    expect(r1.statusCode).toBe(400);
    const r2 = await call({ body: { messages: [{ role: 'assistant', text: 'hi' }] } });
    expect(r2.statusCode).toBe(400);
  });
});

describe('message caps (enforced server-side)', () => {
  test('caps to the last 12 turns and 2000 chars each, first turn is user', async () => {
    const long = 'x'.repeat(5000);
    const many = [];
    for (let i = 0; i < 20; i += 1) many.push({ role: i % 2 ? 'user' : 'assistant', text: `${long} turn ${i}` }); // ends on a user turn
    const r = await call({ body: { messages: many } });
    expect(r.statusCode).toBe(200);
    const params = mockCreate.mock.calls[0][0];
    expect(params.messages.length).toBeLessThanOrEqual(12);
    expect(params.messages[0].role).toBe('user');
    expect(params.messages[params.messages.length - 1].role).toBe('user');
    params.messages.forEach((m) => expect(m.content.length).toBeLessThanOrEqual(2000));
  });

  test('normalizeMessages drops junk roles and blank turns', () => {
    const out = assistant.normalizeMessages([
      { role: 'system', text: 'evil' },
      { role: 'user', text: '   ' },
      { role: 'user', text: 'real question' },
    ]);
    expect(out).toEqual([{ role: 'user', content: 'real question' }]);
  });
});

describe('request shape and grounded system prompt', () => {
  test('claude-sonnet-5, thinking disabled, effort low, cached system, no sampling params', async () => {
    await call();
    const params = mockCreate.mock.calls[0][0];
    expect(params.model).toBe('claude-sonnet-5');
    expect(params.max_tokens).toBe(1024);
    expect(params.thinking).toEqual({ type: 'disabled' });
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.temperature).toBeUndefined();
    expect(params.top_p).toBeUndefined();
    expect(params.top_k).toBeUndefined();
    expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
  });

  test('system prompt carries the never-invent rule, the FAQ facts, and the deco-method framing', () => {
    const sys = assistant.buildSystemPrompt();
    expect(sys).toMatch(/Never invent prices, dates, minimums, turnaround times/);
    expect(sys).toMatch(/info@nationalsportsapparel\.com/);
    expect(sys).toMatch(/Never present DTF as a top-level method/);
    // Every shared FAQ fact is inlined verbatim — the bot's only policy source.
    FAQS.forEach((f) => {
      expect(sys).toContain(f.question);
      expect(sys).toContain(f.answer);
    });
  });
});

describe('coach tool gating', () => {
  test('anonymous request: only the family lookup tool is offered', async () => {
    await call({ body: { messages: [{ role: 'user', text: 'where is my order' }], customer_id: 'custA' } });
    const names = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
    expect(names).toEqual(['lookup_order_for_family']);
  });

  test('verified coach + customer_id: get_my_orders is offered too', async () => {
    await call({ auth: 'Bearer coach-jwt', body: { messages: [{ role: 'user', text: 'where is my order' }], customer_id: 'custA' } });
    const names = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
    expect(names).toEqual(['get_my_orders', 'lookup_order_for_family']);
  });

  test('invalid token degrades to anonymous (no coach tool, no error)', async () => {
    const r = await call({ user: null, auth: 'Bearer stale', body: { messages: [{ role: 'user', text: 'hi' }], customer_id: 'custA' } });
    expect(r.statusCode).toBe(200);
    const names = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
    expect(names).toEqual(['lookup_order_for_family']);
  });

  test('coach without a customer_id gets no coach tool', async () => {
    await call({ auth: 'Bearer coach-jwt', body: { messages: [{ role: 'user', text: 'hi' }] } });
    const names = mockCreate.mock.calls[0][0].tools.map((t) => t.name);
    expect(names).toEqual(['lookup_order_for_family']);
  });

  test('get_my_orders reuses the teamshop-orders list and exposes only the safe fields', async () => {
    mockCreate = jest.fn()
      .mockResolvedValueOnce(toolUseResponse([{ name: 'get_my_orders' }]))
      .mockResolvedValueOnce(textResponse('Your latest order is in production.'));
    const r = await call({ auth: 'Bearer coach-jwt', body: { messages: [{ role: 'user', text: 'track my order' }], customer_id: 'custA' } });
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.text).toBe('Your latest order is in production.');

    // The tool result handed to the model: exact whitelist, labeled status.
    const secondParams = mockCreate.mock.calls[1][0];
    const toolResult = secondParams.messages[secondParams.messages.length - 1].content[0];
    expect(toolResult.type).toBe('tool_result');
    const rows = JSON.parse(toolResult.content).orders;
    expect(Object.keys(rows[0]).sort()).toEqual(['created_at', 'item_count', 'order_number', 'production_stage', 'status', 'total', 'tracker_path'].sort());
    expect(rows[0]).toMatchObject({
      order_number: 1010042,
      status: 'In production',
      production_stage: 'in production',
      item_count: 1,
      total: 249.5,
      tracker_path: '/shop/order/tokC',
    });
    expect(JSON.stringify(rows)).not.toMatch(/buyer_name|buyer_email|customer_id/);

    // Card hint for the widget's existing OrderCard.
    expect(body.cards).toHaveLength(1);
    expect(body.cards[0].type).toBe('order');
    expect(body.cards[0].order.status_token).toBe('tokC');
    expect(JSON.stringify(body.cards)).not.toMatch(/buyer_name|buyer_email/);
  });

  test('the model asking for get_my_orders anonymously gets an error result, not data', async () => {
    mockCreate = jest.fn()
      .mockResolvedValueOnce(toolUseResponse([{ name: 'get_my_orders' }]))
      .mockResolvedValueOnce(textResponse('Sorry, sign in first.'));
    const r = await call({ body: { messages: [{ role: 'user', text: 'track' }] } });
    const secondParams = mockCreate.mock.calls[1][0];
    const toolResult = JSON.parse(secondParams.messages[secondParams.messages.length - 1].content[0].content);
    expect(toolResult.error).toMatch(/Unknown or unavailable tool/);
    expect(JSON.parse(r.body).cards).toEqual([]);
  });
});

describe('family lookup', () => {
  const lookupCall = (tables) => {
    mockCreate = jest.fn()
      .mockResolvedValueOnce(toolUseResponse([{ name: 'lookup_order_for_family', input: { order_number: '1010099', email: 'Family@Example.com' } }]))
      .mockResolvedValueOnce(textResponse('Found it — here is your order.'));
    return call({ tables, body: { messages: [{ role: 'user', text: 'look up order 1010099 for family@example.com' }] } });
  };

  test('matches on teamshop source + order_number + case-insensitive email, returns ONLY safe fields', async () => {
    const r = await lookupCall(baseTables({ webstore_orders: { data: [FAMILY_ORDER], error: null } }));
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);

    // The query really filtered on all three keys (never body-trusted output).
    const q = mockAdmin.queries.find((x) => x.table === 'webstore_orders');
    expect(q.filters).toEqual(expect.arrayContaining([
      ['eq', 'order_source', 'teamshop'],
      ['eq', 'order_number', 1010099],
      ['ilike', 'buyer_email', 'Family@Example.com'],
    ]));
    // The select never asks for buyer_email/address/PO fields.
    expect(q.select).not.toMatch(/buyer_email|ship_address|po_number|buyer_phone/);

    // Tool result to the model: whitelisted fields only.
    const secondParams = mockCreate.mock.calls[1][0];
    const result = JSON.parse(secondParams.messages[secondParams.messages.length - 1].content[0].content);
    expect(Object.keys(result).sort()).toEqual(['found', 'order_number', 'production_stage', 'status', 'tracker_path'].sort());
    expect(result).toMatchObject({ found: true, order_number: 1010099, status: 'Processing', tracker_path: '/shop/order/tokF' });

    // Nothing sensitive anywhere in the HTTP response (card included).
    expect(r.body).not.toMatch(/family@example\.com|1 Main St|PO-77|buyer_email|ship_address|po_number/);
    expect(body.cards[0].order.status_token).toBe('tokF');
    expect(body.cards[0].order.total).toBeNull(); // family view never includes money
  });

  test('no match -> not-found result, no invented order', async () => {
    const r = await lookupCall(baseTables({ webstore_orders: { data: [], error: null } }));
    const secondParams = mockCreate.mock.calls[1][0];
    const result = JSON.parse(secondParams.messages[secondParams.messages.length - 1].content[0].content);
    expect(result.found).toBe(false);
    expect(JSON.parse(r.body).cards).toEqual([]);
  });

  test('both fields required — an empty email is refused without touching the DB', async () => {
    mockCreate = jest.fn()
      .mockResolvedValueOnce(toolUseResponse([{ name: 'lookup_order_for_family', input: { order_number: '1010099', email: '  ' } }]))
      .mockResolvedValueOnce(textResponse('What email did you use at checkout?'));
    await call({ body: { messages: [{ role: 'user', text: 'look up 1010099' }] } });
    const secondParams = mockCreate.mock.calls[1][0];
    const result = JSON.parse(secondParams.messages[secondParams.messages.length - 1].content[0].content);
    expect(result.error).toMatch(/order_number and email are required/);
    expect(mockAdmin.queries.find((x) => x.table === 'webstore_orders')).toBeUndefined();
  });

  test('abuse cap: the model gets at most 2 lookups per invocation', async () => {
    mockCreate = jest.fn()
      .mockResolvedValueOnce(toolUseResponse([
        { name: 'lookup_order_for_family', input: { order_number: '1', email: 'a@b.com' } },
        { name: 'lookup_order_for_family', input: { order_number: '2', email: 'a@b.com' } },
        { name: 'lookup_order_for_family', input: { order_number: '3', email: 'a@b.com' } },
      ]))
      .mockResolvedValueOnce(textResponse('Done.'));
    await call({ body: { messages: [{ role: 'user', text: 'try a few' }] } });
    const secondParams = mockCreate.mock.calls[1][0];
    const results = secondParams.messages[secondParams.messages.length - 1].content.map((c) => JSON.parse(c.content));
    expect(results[0].error).toBeUndefined();
    expect(results[1].error).toBeUndefined();
    expect(results[2].error).toMatch(/Lookup limit reached/);
    // Only two webstore_orders queries ever ran.
    expect(mockAdmin.queries.filter((x) => x.table === 'webstore_orders')).toHaveLength(2);
  });
});

describe('bounded tool loop', () => {
  test('a model that never stops asking for tools is cut off after 3 calls with a safe message', async () => {
    mockCreate = jest.fn(async () => toolUseResponse([{ name: 'lookup_order_for_family', input: { order_number: '1', email: 'a@b.com' } }]));
    const r = await call();
    expect(mockCreate).toHaveBeenCalledTimes(3);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.text).toMatch(/info@nationalsportsapparel\.com/);
  });
});
