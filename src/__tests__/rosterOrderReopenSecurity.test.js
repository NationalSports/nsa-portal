jest.mock('../../netlify/functions/_shared', () => ({
  verifyUser: jest.fn(),
  getSupabaseAdmin: jest.fn(),
}));
jest.mock('../../netlify/functions/_portalCredentials', () => ({
  issuePortalCredential: jest.fn(),
}), { virtual: true });

const shared = require('../../netlify/functions/_shared');
const credentials = require('../../netlify/functions/_portalCredentials');
const { handler } = require('../../netlify/functions/roster-order-reopen');

function fakeAdmin() {
  const calls = [];
  const results = {
    roster_order_sessions: { data: { id: 'session-1', name: 'Fall roster', season: 'Fall', customer_id: 'canonical-customer' }, error: null },
    customers: { data: { name: 'Canonical Club' }, error: null },
    roster_teams: { data: [], error: null },
    coach_customer_access: { data: [{ coach_accounts: { email: 'coach@example.com', name: 'Casey Coach' } }], error: null },
  };
  return {
    calls,
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const chain = {
        select() { return chain; },
        eq(column, value) { call.filters.push([column, value]); return chain; },
        in(column, value) { call.filters.push([column, value]); return chain; },
        maybeSingle() { return Promise.resolve(results[table]); },
        then(resolve, reject) { return Promise.resolve(results[table]).then(resolve, reject); },
      };
      return chain;
    },
  };
}

const call = (body, headers = {}) => handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) });

describe('roster-order-reopen authorization and customer binding', () => {
  beforeEach(() => {
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '' }));
    credentials.issuePortalCredential.mockReset().mockResolvedValue({ token: 'opaque-token', id: 'cred-1' });
    shared.verifyUser.mockReset();
    shared.getSupabaseAdmin.mockReset();
  });

  test('rejects an unauthenticated request before reading or issuing anything', async () => {
    shared.verifyUser.mockResolvedValue({ ok: false, status: 401, error: 'Missing bearer token' });
    const response = await call({ session_id: 'session-1', customer_id: 'canonical-customer' });
    expect(response.statusCode).toBe(401);
    expect(credentials.issuePortalCredential).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('rejects a body customer that does not match the roster session', async () => {
    const admin = fakeAdmin();
    shared.verifyUser.mockResolvedValue({ ok: true, admin });
    const response = await call({ session_id: 'session-1', customer_id: 'attacker-choice' });
    expect(response.statusCode).toBe(403);
    expect(credentials.issuePortalCredential).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('issues and emails only for the customer stored on the roster session', async () => {
    process.env.BREVO_API_KEY = 'test-key';
    process.env.URL = 'https://portal.test';
    const admin = fakeAdmin();
    shared.verifyUser.mockResolvedValue({ ok: true, admin });
    const response = await call({ session_id: 'session-1', customer_id: 'canonical-customer', note: 'Fix sizes' }, { authorization: 'Bearer staff-jwt' });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, emailed: 1 });
    expect(credentials.issuePortalCredential).toHaveBeenCalledWith(admin, 'canonical-customer', { label: 'Roster reopened' });
    const customerLookup = admin.calls.find((entry) => entry.table === 'customers');
    expect(customerLookup.filters).toContainEqual(['id', 'canonical-customer']);
    const email = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(email.htmlContent).toContain('/coach?portal=opaque-token');
    expect(email.htmlContent).not.toContain('attacker-choice');
  });
});
