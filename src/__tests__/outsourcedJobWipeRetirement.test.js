/* Regression tests for OUTSOURCED retirement in the so_jobs empty-list wipe guard
 * (src/lib/dbEngine.js, SO-1403, 2026-08-19).
 *
 * Background: syncJobs retires a released job whose every remaining claimed decoration is routed
 * to an outside decorator (jobAllRoutedOutside — deleted claims are neutral). When that was the
 * SO's LAST job, the save lands in the empty-jobs wipe branch, where the SO-1487 protection
 * blocked the retirement forever: JOB-1403-02 (tee deco routed outside, pant deco deleted) fired
 * the "Blocked deletion" banner and the data-loss email on every open of the order.
 *
 * The fix follows the guard's own rule — liveness is decided by the DATABASE, never the client
 * payload: the guard rebuilds the order shape from the DB's own rows (items, decorations, PO
 * lines, deco POs, art types) and retires a protected job only when the DB itself proves every
 * remaining claim vendor-routed. The no-false-positive cases are load-bearing: an in-house claim
 * keeps the protection, a claims-less job keeps it, and any read error keeps it.
 *
 * Mock matches responses by (table, method, select-signature); see deadJobRetirement.test.js.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { rules: [], calls: [] };
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
      like: () => builder,
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        const sel = builder._selectArgs ? String(builder._selectArgs[0]) : '';
        state.calls.push({ table, method, sel, args: builder._args, inArgs: builder._inArgs, eqArgs: builder._eqArgs });
        const i = state.rules.findIndex(r => r.table === table && (r.method || 'select') === (method || 'select') && (r.sel === undefined || r.sel === sel));
        const resp = i >= 0 ? state.rules[i].resp : DEFAULT;
        if (i >= 0 && !state.rules[i].sticky) state.rules.splice(i, 1);
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
  process.env.REACT_APP_SUPABASE_URL = 'https://outsourced-wipe-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// The stuck job, as it sat in production: released, art_complete, claiming the tee's deco 0 and
// the pant's (since deleted) deco 0.
const STUCK = {
  id: 'JOB-1403-02', key: 'released_screen_print_JOB-1403-02', art_status: 'art_complete',
  art_file_id: 'af1', _art_ids: ['af1'],
  items: [{ item_idx: 0, deco_idxs: [0] }, { item_idx: 7, deco_idxs: [0] }],
};

// A save that reaches the empty-jobs wipe branch (client already computed the retirement).
const wipeSO = () => ({
  id: 'SO-1403', memo: 'Fall Gear', created_at: '5/20/2026, 11:04:22 AM',
  items: [{ sku: 'JX4461', name: 'Pregame Tee', color: 'Navy', sizes: { M: 10 }, decorations: [] }],
  jobs: [], _jobsHydrated: true, _itemsHydrated: true, _decosHydrated: true, _artHydrated: true,
});

// DB truth for the SO-1403 shape: the tee (item_index 0) still carries deco 0, routed outside;
// the pant (item_index 7) exists but its decoration is gone.
const DB_ITEMS = { data: [{ id: 'it-0', item_index: 0 }, { id: 'it-7', item_index: 7 }], error: null };
const outsideDeco = (over) => ({ data: [{ so_item_id: 'it-0', deco_index: 0, kind: 'art', fulfillment: 'outside', deco_po_id: null, deco_type: null, art_file_id: 'af1', num_method: null, name_method: null, ...over }], error: null });

const baseRules = ({ jobsInDb, liveDecos, poLines }) => [
  { table: 'sales_orders', sel: 'updated_at,deco_pos,created_at,status,po_number', resp: { data: { updated_at: 'x', deco_pos: null, created_at: '5/20/2026, 11:04:22 AM' }, error: null } },
  { table: 'so_items', sel: 'id,item_index,sku,color,product_id', resp: { data: [], error: null } },
  { table: 'so_art_files', sel: '*', resp: { data: [], error: null } },
  { table: 'so_jobs', sel: 'id,key,art_status,art_file_id,_art_ids,items', resp: { data: jobsInDb, error: null } },
  // DB-side liveness / routing reads. The art file still exists (deco_type typed), so the
  // dead-job branch never fires — only the outsourced rule can retire the job here.
  { table: 'so_art_files', sel: 'id,deco_type', resp: { data: [{ id: 'af1', deco_type: 'screen_print' }], error: null } },
  { table: 'so_items', sel: 'id,item_index', resp: DB_ITEMS },
  { table: 'so_item_decorations', sel: 'so_item_id,deco_index,kind,fulfillment,deco_po_id,deco_type,art_file_id,num_method,name_method', resp: liveDecos },
  { table: 'so_item_po_lines', sel: 'so_item_id,sizes', resp: poLines || { data: [], error: null } },
  { table: 'sales_orders', sel: 'deco_pos', resp: { data: { deco_pos: null }, error: null } },
  { table: 'so_items', method: 'insert', sel: 'id', resp: { data: [{ id: 'new-1' }], error: null } },
];

const jobDeletes = (state) => state.calls.filter(c => c.table === 'so_jobs' && c.method === 'delete');

describe('_dbSaveSOInner — outsourced protected jobs retire via DB-side routing, in-house ones stay blocked', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const run = async (rules) => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.rules = rules;
    const { _dbSaveSO } = require('../lib/dbEngine');
    await _dbSaveSO(wipeSO());
    return __mockState;
  };

  test('SO-1403: outside-routed live claim + deleted claim → job retires despite protection', async () => {
    const state = await run(baseRules({ jobsInDb: [STUCK], liveDecos: outsideDeco() }));
    const dels = jobDeletes(state);
    expect(dels.length).toBe(1);
    expect(dels[0].inArgs).toEqual(['id', ['JOB-1403-02']]);
  });

  test('deco_po_id routing counts the same as the fulfillment flag', async () => {
    const state = await run(baseRules({ jobsInDb: [STUCK], liveDecos: outsideDeco({ fulfillment: null, deco_po_id: 'DPO-7801' }) }));
    expect(jobDeletes(state).length).toBe(1);
  });

  test('PO routing metadata is read from the surviving sizes JSONB column', async () => {
    const state = await run(baseRules({
      jobsInDb: [STUCK],
      liveDecos: outsideDeco({ fulfillment: null }),
      poLines: { data: [{ so_item_id: 'it-0', sizes: { po_type: 'outside_deco', deco_type: 'screen_print' } }], error: null },
    }));
    expect(state.calls.some((c) => c.table === 'so_item_po_lines' && c.sel === 'so_item_id,sizes')).toBe(true);
    expect(jobDeletes(state).length).toBe(1);
  });

  test('an in-house live claim keeps the protection (no delete)', async () => {
    const state = await run(baseRules({ jobsInDb: [STUCK], liveDecos: outsideDeco({ fulfillment: null }) }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('a job with no claims at all stays blocked — nothing to prove routed', async () => {
    const noClaims = { ...STUCK, items: [] };
    const state = await run(baseRules({ jobsInDb: [noClaims], liveDecos: outsideDeco() }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('a routing read error keeps the protection (no delete on "can\'t tell")', async () => {
    const state = await run(baseRules({
      jobsInDb: [STUCK], liveDecos: outsideDeco(),
      poLines: { data: null, error: { message: 'network sadness' } },
    }));
    expect(jobDeletes(state).length).toBe(0);
  });
});
