/* _dbLoad's table pool (src/lib/dbEngine.js).
 *
 * The initial load used to run its ~45 table queries in lock-step groups of 5: no table in group
 * N+1 could start until the slowest table in group N finished. On 2026-10-07 a new tab spent
 * 18.7s that way — 9 serial groups, mostly tiny tables each paying a full round trip. The load
 * now runs through a bounded pool: a free lane starts the next table immediately, at most 8
 * tables are in flight, and results still come back in query order.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { requested: [], inFlight: new Set(), maxInFlight: 0, holds: {} };
  const makeBuilder = (table) => {
    const builder = {
      select: () => builder, not: () => builder, or: () => builder, order: () => builder, eq: () => builder, in: () => builder,
      range: () => {
        state.requested.push(table);
        state.inFlight.add(table);
        state.maxInFlight = Math.max(state.maxInFlight, state.inFlight.size);
        const finish = () => { state.inFlight.delete(table); return { data: [{ id: table + '-1' }], error: null, status: 200 }; };
        // A held table stays pending until the test releases it; every other table answers after 5ms.
        if (state.holds[table]) return new Promise((res) => { state.holds[table] = () => res(finish()); });
        return new Promise((res) => setTimeout(() => res(finish()), 5));
      },
    };
    return builder;
  };
  const client = {
    from: (t) => makeBuilder(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __loadState: state };
});

const ORIG_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIG_ENV }; });

const freshEngine = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://pool-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
  const { __loadState } = require('@supabase/supabase-js');
  Object.assign(__loadState, { requested: [], inFlight: new Set(), maxInFlight: 0, holds: {} });
  return { state: __loadState, _dbLoad: require('../lib/dbEngine')._dbLoad };
};

describe('_dbLoad table pool', () => {
  test('one slow table does not hold up the tables queued after it', async () => {
    const { state, _dbLoad } = freshEngine();
    state.holds.sales_orders = true;
    const load = _dbLoad({ essential: true, fullState: true });
    await new Promise((r) => setTimeout(r, 300));
    // Under lock-step groups nothing past sales_orders' group could have been requested yet.
    expect(state.requested).toContain('dismissed_notifs');
    expect(state.requested).toContain('message_reads');
    expect(state.inFlight.has('sales_orders')).toBe(true);
    state.holds.sales_orders();
    const d = await load;
    expect(d).not.toBeNull();
    // Results stay attached to the right tables despite finishing out of order.
    expect(d.sales_orders.map((s) => s.id)).toEqual(['sales_orders-1']);
    expect(d.team.map((t) => t.id)).toEqual(['team_members-1']);
  });

  test('never more than 8 tables in flight at once', async () => {
    const { state, _dbLoad } = freshEngine();
    const d = await _dbLoad({ essential: true, fullState: true });
    expect(d).not.toBeNull();
    expect(state.maxInFlight).toBe(8);
  });
});
