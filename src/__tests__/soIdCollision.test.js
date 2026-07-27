/* Regression tests for the document-identity guard in src/lib/dbEngine.js (SO-1507, 2026-07-27).
 *
 * Background: ids are minted client-side from _dbMaxIds, which App.js syncs ONCE at page load, so a
 * tab left open mints a number another user already used. The pre-existing "brand-new orders INSERT
 * rather than upsert" guard keyed off `!existingSO` — "is this id free in the DB?" — which is false
 * on exactly the collisions it was meant to catch (the incumbent row is right there), so the save
 * fell through to upsert and silently replaced the other order's header. Confirmed in production on
 * SO-1507/1502/1485/1472/1454/1437/1340 and EST-1645/1646/1672.
 *
 * The guard now compares created_at — stamped once at creation, never rewritten by an edit — so a
 * differing value means the id holds a DIFFERENT document. These tests drive the real _dbSaveSOInner
 * through a mocked Supabase client and assert on the actual insert/upsert calls issued, so they fail
 * if the production behavior regresses rather than if some helper's shape changes.
 *
 * The no-false-positive cases (3 and 4) are the load-bearing ones: a guard that blocks legitimate
 * saves is worse than the bug, and a null created_at on either side means "can't tell", not "block".
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [] };
  const DEFAULT = { data: null, error: null, count: 0 };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: (...a) => { method = 'upsert'; builder._args = a; return builder; },
      insert: (...a) => { method = 'insert'; builder._args = a; return builder; },
      update: (...a) => { method = 'update'; builder._args = a; return builder; },
      delete: (...a) => { method = 'delete'; builder._args = a; return builder; },
      select: (...a) => { if (!method) method = 'select'; builder._selectArgs = a; return builder; },
      eq: (...a) => { builder._eqArgs = a; return builder; },
      in: (...a) => { builder._inArgs = a; return builder; },
      // _refreshSoMaxId chains .like().order().limit()
      like: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args });
        const q = state.responses[table] || [];
        const resp = q.length ? q.shift() : DEFAULT;
        return Promise.resolve(resp).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (table) => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const withSupabaseEnv = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://collision-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// An order with no items keeps the item-write guards out of the picture — this suite is only about
// which id the header lands on.
const emptyChildren = () => ({
  so_items: [{ data: [], error: null }],
  so_art_files: [{ data: [], error: null }],
  so_item_po_lines: [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }],
  so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
});

const soCalls = (state) => state.calls.filter(c => c.table === 'sales_orders');

describe('_dbSaveSOInner — document-identity guard on id collision', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('never-saved order whose id is held by another order re-mints instead of overwriting it', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        // The incumbent: Rachel's Encinitas order, created at a different moment than ours.
        { data: { updated_at: 'incumbent-ts', deco_pos: null, created_at: '7/13/2026, 10:35:00 AM' }, error: null },
        // _refreshSoMaxId full scan — highest live number is 1510
        { data: [{ id: 'SO-1510' }, { id: 'SO-1509' }], error: null },
        { error: null }, // the re-minted insert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1507', memo: 'JV Uniforms', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    await _dbSaveSO(so);

    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    // The incumbent must never be upserted over — this is the whole bug.
    expect(writes.some(c => c.method === 'upsert')).toBe(false);
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('insert');
    // Re-minted above the fresh DB max, not to the colliding number.
    expect(writes[0].args[0].id).toBe('SO-1511');
    expect(so.id).toBe('SO-1511');
    // And it must not carry the incumbent's updated_at.
    expect(writes[0].args[0].updated_at).not.toBe('incumbent-ts');
  });

  test('already-saved order whose id is now held by another order blocks rather than overwriting', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        // _version is set below, so _checkVersion's read runs FIRST — same version, no conflict.
        { data: { _version: 12 }, error: null },
        // then the existence probe: the incumbent, created at a different moment than ours
        { data: { updated_at: 'x', deco_pos: null, created_at: '7/13/2026, 10:35:00 AM' }, error: null },
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    // _version present => this order has been saved before, so renumbering would strand its children.
    const so = { id: 'SO-1507', memo: 'JV Uniforms', created_at: '7/13/2026, 10:36:38 AM', _version: 12, items: [] };
    const result = await _dbSaveSO(so);

    expect(result).toBe(false);
    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(0); // nothing written at all
    expect(so.id).toBe('SO-1507'); // and not silently renumbered
  });

  test('matching created_at is an ordinary edit and still upserts (no false positive)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'x', deco_pos: null, created_at: '7/13/2026, 10:36:38 AM' }, error: null },
        { error: null }, // upsert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1507', memo: 'edited', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    await _dbSaveSO(so);

    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('upsert');
    expect(so.id).toBe('SO-1507');
  });

  test('null created_at on the incumbent means "can\'t tell" and must not block the save', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'x', deco_pos: null, created_at: null }, error: null },
        { error: null }, // upsert
      ],
      ...emptyChildren(),
    };

    const { _dbSaveSO } = require('../lib/dbEngine');
    const so = { id: 'SO-1400', memo: 'legacy row edit', created_at: '7/13/2026, 10:36:38 AM', items: [] };
    const result = await _dbSaveSO(so);

    expect(result).not.toBe(false);
    const writes = soCalls(__mockState).filter(c => c.method === 'insert' || c.method === 'upsert');
    expect(writes.length).toBe(1);
    expect(writes[0].method).toBe('upsert');
  });
});
