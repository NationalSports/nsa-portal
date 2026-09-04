const auth = require('../../netlify/functions/_portalAuth');

function builder(result, calls, table) {
  const call = { table, filters: [] };
  calls.push(call);
  const b = {
    select(value) { call.select = value; return b; },
    in(column, values) { call.filters.push(['in', column, values]); return b; },
    is(column, value) { call.filters.push(['is', column, value]); return b; },
    ilike(column, value) { call.filters.push(['ilike', column, value]); return b; },
    then(resolve, reject) { return Promise.resolve(typeof result === 'function' ? result(call) : result).then(resolve, reject); },
  };
  return b;
}

describe('hash-only portal credential resolution', () => {
  beforeEach(() => auth._cache.clear());

  test('resolves an opaque token to its owner family without querying alpha_tag', async () => {
    const calls = [];
    const token = 'opaque-' + Math.random();
    const admin = { from: (table) => builder((call) => {
      if (table === 'portal_access_credentials') {
        expect(call.filters.find((f) => f[1] === 'credential_hash')[2]).toContain(auth.tokenHash(token));
        return { data: [{ customer_id: 'P', credential_kind: 'token', expires_at: null }], error: null };
      }
      if (table === 'customers' && call.filters.some((f) => f[1] === 'id')) return { data: [{ id: 'P', parent_id: null }], error: null };
      if (table === 'customers' && call.filters.some((f) => f[1] === 'parent_id')) return { data: [{ id: 'C' }], error: null };
      throw new Error('unexpected query');
    }, calls, table) };

    const result = await auth.resolvePortalCredential(admin, token);

    expect([...result.fam]).toEqual(['P', 'C']);
    expect(calls.some((call) => call.filters.some((f) => f[0] === 'ilike'))).toBe(false);
  });

  test('does not revive a revoked/unknown credential through alpha_tag fallback', async () => {
    const calls = [];
    const admin = { from: (table) => builder(
      table === 'portal_access_credentials' ? { data: [], error: null } : { data: [{ id: 'SHOULD-NOT-LOAD' }], error: null },
      calls, table
    ) };

    const result = await auth.resolvePortalCredential(admin, 'legacy-looking-tag');

    expect(result).toMatchObject({ notFound: true });
    expect(calls.map((call) => call.table)).toEqual(['portal_access_credentials']);
  });

  test('uses alpha_tag only during a pre-migration deployment', async () => {
    const calls = [];
    const admin = { from: (table) => builder((call) => {
      if (table === 'portal_access_credentials') return { data: null, error: { code: '42P01', message: 'relation does not exist' } };
      if (call.filters.some((f) => f[0] === 'ilike')) return { data: [{ id: 'T', parent_id: null, alpha_tag: ' Team ' }], error: null };
      return { data: [], error: null };
    }, calls, table) };

    const result = await auth.resolvePortalCredential(admin, 'team');

    expect([...result.fam]).toEqual(['T']);
    expect(calls.some((call) => call.filters.some((f) => f[0] === 'ilike'))).toBe(true);
  });

  test('fails closed on a credential-table schema error', async () => {
    const calls = [];
    const admin = { from: (table) => builder(
      table === 'portal_access_credentials'
        ? { data: null, error: { code: 'PGRST204', message: "Could not find the 'disabled_at' column of 'portal_access_credentials' in the schema cache" } }
        : { data: [{ id: 'SHOULD-NOT-LOAD' }], error: null },
      calls, table
    ) };

    const result = await auth.resolvePortalCredential(admin, 'legacy-looking-tag');

    expect(result.error).toContain('disabled_at');
    expect(calls.map((call) => call.table)).toEqual(['portal_access_credentials']);
  });
});
