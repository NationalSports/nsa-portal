/* Regression: a STALE_SO_WRITE rejection must not be re-POSTed in a tight loop.
 *
 * 2026-09-05: one tab re-fired a rejected sales-order save on every state change — 3.9M
 * STALE_SO_WRITE rejections in 11 hours — which exhausted the DB connection pool and took
 * PostgREST down (503 for every user). Estimates already had a stale cooldown; this pins the
 * same behavior for sales orders.
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
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method });
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
    rpc: (name, args) => require('../testHelpers/atomicSaveRpc')(state, name, args),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const so = () => ({ id: 'SO-STALE-1', memo: 'm', _version: 3, items: [{ sku: 'TEE', color: 'Red' }], jobs: [] });
const saveResponses = () => ({
  sales_orders: [{ data: { _version: 3 }, error: null }, { data: { updated_at: 'yesterday', deco_pos: null }, error: null }],
  so_items: [{ data: [], error: null }],
  so_art_files: [{ data: [], error: null }],
  so_item_po_lines: [{ data: [], error: null }],
  so_jobs: [{ data: [], error: null }, { data: [], error: null }],
});
const rpcSaves = (calls) => calls.filter(c => c.table === 'RPC' && c.method === 'save_sales_order_atomic');

describe('sales-order stale-write cooldown', () => {
  beforeEach(() => {
    process.env.REACT_APP_SUPABASE_URL = 'https://cooldown-test.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
    jest.resetModules();
  });
  afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

  test('a STALE_SO_WRITE rejection returns false once, then skips the network until the cooldown clears', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses();
    __mockState.atomicError = { code: '40001', message: 'STALE_SO_WRITE: edit is based on a different version' };
    const engine = require('../lib/dbEngine');
    const { _dbSaveSO, _isDocumentConflictCooling, _clearDocumentConflictCooldown } = engine;

    expect(await _dbSaveSO(so())).toBe(false);
    expect(rpcSaves(__mockState.calls).length).toBe(1);
    expect(_isDocumentConflictCooling('SO-STALE-1')).toBe(true);

    // The re-firing auto-save: same edit, immediately. Must not touch Supabase at all.
    __mockState.calls.length = 0;
    expect(await _dbSaveSO(so())).toBe(false);
    expect(__mockState.calls.length).toBe(0);

    // Rep applies the conflict card → cooldown cleared → the next save may POST again.
    _clearDocumentConflictCooldown('SO-STALE-1');
    expect(_isDocumentConflictCooling('SO-STALE-1')).toBe(false);
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses();
    expect(await _dbSaveSO(so())).toBe(true);
    expect(rpcSaves(__mockState.calls).length).toBe(1);
  });

  test('a successful save is not cooling down', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = saveResponses();
    const { _dbSaveSO, _isDocumentConflictCooling } = require('../lib/dbEngine');
    expect(await _dbSaveSO(so())).toBe(true);
    expect(_isDocumentConflictCooling('SO-STALE-1')).toBe(false);
  });
});
