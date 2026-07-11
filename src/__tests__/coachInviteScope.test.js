/* Coach-invite authorization scoping (audit #3 + #11).
 *
 * The coach portal is a public alpha_tag link with no login; coach-invite provisions
 * coach_accounts + roster_team_coaches with the service role, so a coach-portal caller
 * must not reach outside its own club family. Two guarantees under test:
 *   1. resolveCustomerFamily includes sub-customers (the old inline check was parents-only).
 *   2. A coach-portal caller passing another club's team_id is rejected (403), not provisioned.
 */

// fake supabase admin: from(table) → chainable, awaited value is the canned result.
function fakeSb(tables) {
  return {
    from(table) {
      const result = tables[table] || { data: [], error: null };
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain, ilike: () => chain,
        not: () => chain, maybeSingle: () => Promise.resolve(result),
        then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
      };
      return chain;
    },
  };
}

// The handler tests below mock _shared (jest.mock is hoisted), so the helper tests
// must reach the REAL implementations explicitly.
const shared = jest.requireActual('../../netlify/functions/_shared');

describe('resolveCustomerFamily — parents + sub-customers', () => {
  test('family includes children found via parent_id (drift fix)', async () => {
    const sb = fakeSb({
      // ilike alpha_tag → the parent; .in('parent_id',[parent]) → two sub-customers
      customers: { data: [{ id: 'parent1' }], error: null },
    });
    // second query (kids) hits the same 'customers' stub; return both via a call counter.
    let call = 0;
    sb.from = (table) => {
      const chain = {
        select: () => chain, eq: () => chain, ilike: () => chain, not: () => chain,
        in: () => chain,
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then: (res, rej) => {
          call += 1;
          const data = call === 1 ? [{ id: 'parent1' }] : [{ id: 'sub1' }, { id: 'sub2' }];
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return chain;
    };
    const out = await shared.resolveCustomerFamily(sb, 'EAGLES-' + Math.random());
    expect(out.error).toBeUndefined();
    expect(out.fam.has('parent1')).toBe(true);
    expect(out.fam.has('sub1')).toBe(true);
    expect(out.fam.has('sub2')).toBe(true);
  });

  test('a failed kids lookup surfaces an error, not a shrunken family', async () => {
    let call = 0;
    const sb = { from: () => {
      const chain = {
        select: () => chain, eq: () => chain, ilike: () => chain, not: () => chain, in: () => chain,
        then: (res, rej) => {
          call += 1;
          const r = call === 1 ? { data: [{ id: 'p1' }], error: null } : { data: null, error: { message: 'timeout' } };
          return Promise.resolve(r).then(res, rej);
        },
      };
      return chain;
    } };
    const out = await shared.resolveCustomerFamily(sb, 'HAWKS-' + Math.random());
    expect(out.fam).toBeUndefined();
    expect(out.error).toBe('timeout');
  });
});

describe('rosterTeamCustomerId — team → owning customer', () => {
  test('resolves the session customer_id through the join', async () => {
    const sb = fakeSb({ roster_teams: { data: { roster_order_sessions: { customer_id: 'cust7' } }, error: null } });
    const out = await shared.rosterTeamCustomerId(sb, 'team-1');
    expect(out.customerId).toBe('cust7');
  });
  test('unknown team → null customerId (not an error)', async () => {
    const sb = fakeSb({ roster_teams: { data: null, error: null } });
    const out = await shared.rosterTeamCustomerId(sb, 'ghost');
    expect(out.error).toBeUndefined();
    expect(out.customerId).toBeNull();
  });
  test('empty teamId short-circuits without a query', async () => {
    const out = await shared.rosterTeamCustomerId(fakeSb({}), '');
    expect(out.customerId).toBeNull();
  });
});

// Handler-level denial paths. Mock _shared so we drive the auth decision directly;
// denials return before any provisioning/email, so no Brevo/fetch mock is needed.
jest.mock('../../netlify/functions/_shared', () => {
  const actual = jest.requireActual('../../netlify/functions/_shared');
  return { ...actual, verifyUser: jest.fn(), resolveCustomerFamily: jest.fn(), rosterTeamCustomerId: jest.fn(), getSupabaseAdmin: jest.fn() };
});

const mockedShared = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/coach-invite');

const call = (body) => handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) });

describe('coach-invite handler — family/team scoping', () => {
  beforeEach(() => {
    mockedShared.verifyUser.mockReset().mockResolvedValue({ ok: false });   // no staff JWT → coach path
    mockedShared.getSupabaseAdmin.mockReset().mockReturnValue({});          // truthy admin stub
    mockedShared.resolveCustomerFamily.mockReset();
    mockedShared.rosterTeamCustomerId.mockReset();
  });

  test('foreign customer_id (not in family) → 401', async () => {
    mockedShared.resolveCustomerFamily.mockResolvedValue({ fam: new Set(['mine']) });
    const res = await call({ email: 'x@y.com', customer_id: 'victim', alpha_tag: 'MINE' });
    expect(res.statusCode).toBe(401);
  });

  test('own customer but foreign team_id → 403 (the audit #11 hole)', async () => {
    mockedShared.resolveCustomerFamily.mockResolvedValue({ fam: new Set(['mine']) });
    mockedShared.rosterTeamCustomerId.mockResolvedValue({ customerId: 'victim' }); // team belongs to another club
    const res = await call({ email: 'x@y.com', customer_id: 'mine', team_id: 'victim-team', alpha_tag: 'MINE' });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body).error).toMatch(/team/i);
  });

  test('own customer + team in family → passes scoping (not 401/403)', async () => {
    mockedShared.resolveCustomerFamily.mockResolvedValue({ fam: new Set(['mine', 'sub']) });
    mockedShared.rosterTeamCustomerId.mockResolvedValue({ customerId: 'sub' }); // sub-customer team, still in family
    const res = await call({ email: 'x@y.com', customer_id: 'mine', team_id: 'ok-team', alpha_tag: 'MINE' });
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });

  test('team ownership lookup error → 500 (retryable), not a silent allow', async () => {
    mockedShared.resolveCustomerFamily.mockResolvedValue({ fam: new Set(['mine']) });
    mockedShared.rosterTeamCustomerId.mockResolvedValue({ error: 'db down' });
    const res = await call({ email: 'x@y.com', customer_id: 'mine', team_id: 't', alpha_tag: 'MINE' });
    expect(res.statusCode).toBe(500);
  });
});
