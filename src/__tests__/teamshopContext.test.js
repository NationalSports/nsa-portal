/* Unit tests for the coach-facing Team Shop context function (coach profile +
 * linked customers). Same mocking style as quickorderQuote.test.js: a fake
 * supabase admin client, with _shared mocked so getSupabaseAdmin never needs
 * real credentials. */

let mockAdmin = null;
jest.mock('../../netlify/functions/_shared', () => ({
  corsHeaders: () => ({ 'Content-Type': 'application/json' }),
  getSupabaseAdmin: () => mockAdmin,
}));

const teamshopContext = require('../../netlify/functions/teamshop-context');

// Minimal chainable supabase stub: from(table) returns a thenable whose query
// methods are no-ops; maybeSingle resolves the first canned row. auth.getUser
// resolves the canned user.
function fakeSb(tables, user) {
  return {
    auth: { getUser: async () => (user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'bad token' } }) },
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
        ilike: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve(result.error ? { data: null, error: result.error } : { data: (result.data || [])[0] || null, error: null }),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

const COACH = { id: 'coach1', email: 'coach@team.com', name: 'Coach', status: 'active', customer_id: null, auth_user_id: 'auth1' };
const CUST_A = { id: 'custA', name: 'Central High' };
const CUST_B = { id: 'custB', name: 'Eastside Academy' };

const baseTables = (over = {}) => ({
  coach_accounts: { data: [COACH], error: null },
  coach_customer_access: { data: [{ customer_id: 'custA' }], error: null },
  customers: { data: [CUST_A, CUST_B], error: null },
  ...over,
});

const call = ({ user = { id: 'auth1', email: 'coach@team.com' }, tables = baseTables(), auth = 'Bearer tok', method = 'POST' } = {}) => {
  mockAdmin = fakeSb(tables, user);
  return teamshopContext.handler({ httpMethod: method, headers: auth ? { authorization: auth } : {}, body: '{}' });
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

  test('rejects a disabled coach account', async () => {
    const r = await call({ tables: baseTables({ coach_accounts: { data: [{ ...COACH, status: 'disabled' }], error: null } }) });
    expect(r.statusCode).toBe(403);
  });
});

describe('customer resolution', () => {
  test('single customer via coach_customer_access', async () => {
    const r = await call({ tables: baseTables({ customers: { data: [CUST_A], error: null } }) });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.coach).toEqual({ id: 'coach1', email: 'coach@team.com', name: 'Coach' });
    expect(body.customers).toEqual([{ id: 'custA', name: 'Central High' }]);
  });

  test('unions and dedupes the account customer_id with coach_customer_access rows', async () => {
    const r = await call({
      tables: baseTables({
        coach_accounts: { data: [{ ...COACH, customer_id: 'custA' }], error: null },
        coach_customer_access: { data: [{ customer_id: 'custA' }, { customer_id: 'custB' }], error: null },
        customers: { data: [CUST_A, CUST_B], error: null },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.customers.map((c) => c.id).sort()).toEqual(['custA', 'custB']);
  });

  test('multiple distinct customers from access rows alone', async () => {
    const r = await call({
      tables: baseTables({
        coach_customer_access: { data: [{ customer_id: 'custA' }, { customer_id: 'custB' }], error: null },
      }),
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.customers.map((c) => c.id).sort()).toEqual(['custA', 'custB']);
  });

  test('no linked customers returns an empty list, not an error', async () => {
    const r = await call({ tables: baseTables({ coach_customer_access: { data: [], error: null } }) });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).customers).toEqual([]);
  });
});
