/* Regression tests for ghost-job retirement in the so_jobs empty-list wipe guard
 * (src/lib/dbEngine.js, JOB-1053-02, 2026-07-28).
 *
 * Background: the wipe guard (SO-1487, 2026-07-10) protects released/submitted jobs from a client
 * that transiently computes jobs:[] — but it protected on `art_status !== 'needs_art'` alone, which
 * made a DEAD job immortal. JOB-1053-02 kept its `waiting_approval` status after the rep removed
 * every decoration from SO-1053 (7/23) and deleted the job's art file (7/24): syncJobs then computed
 * jobs:[] on every open, the wipe was blocked every time, and the ghost surfaced on the art board's
 * Needs Approval column forever, with no rep-facing way to clear it.
 *
 * The fix retires a protected job ONLY when the DATABASE itself proves it dead: zero decorations on
 * the SO's items AND none of the job's declared art files still exists on the SO. The client payload
 * is never trusted for this — a stale/short-loaded tab is exactly what the guard defends against.
 *
 * The no-false-positive cases are the load-bearing ones: a live released job must stay protected
 * when its art file still exists, when the SO still has decorations, when the job declares no art
 * at all (numbers/names-only), and when any liveness read errors.
 *
 * The mock matches responses by (table, method, select-signature) rather than call order, because
 * the save path issues many reads per table and positional queues are unmaintainable. The payload
 * carries ONE item with no decorations — the real SO-1053 shape; a zero-item payload never reaches
 * the jobs branch (the empty-over-orphan-jobs no-op guard returns first).
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
    rpc: (name,args) => require('../testHelpers/atomicSaveRpc')(state,name,args),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const withSupabaseEnv = () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://deadjob-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

// The ghost, as it sits in production: auto-format key, stuck approval status, dead art pointer.
const GHOST = { id: 'JOB-1053-02', key: 'embroidery::art_af1773688228325', art_status: 'waiting_approval', art_file_id: 'af1773688228325', _art_ids: null };

// A save that reaches the empty-jobs wipe branch: jobs hydrated to [], one live item with no
// decorations (the real SO-1053 shape — a zero-item payload short-circuits before the jobs branch).
// created_at matches the identity-guard probe so the save is never mistaken for a collision.
const wipeSO = () => ({
  id: 'SO-1053', memo: '2026 AdiCustom Uniforms', created_at: '5/20/2026, 11:04:22 AM',
  items: [{ sku: 'JC5330', name: 'AdiCustom Jersey', color: 'Black', sizes: { M: 10 }, decorations: [] }],
  jobs: [], _jobsHydrated: true, _itemsHydrated: true, _decosHydrated: true, _artHydrated: true,
});

// Baseline rules every case shares. The liveness reads are the per-test variables and are passed in.
const baseRules = ({ jobsInDb, liveArt, liveItems, liveDecos }) => [
  // identity probe: same created_at → same document, no collision handling engaged
  { table: 'sales_orders', sel: 'updated_at,deco_pos,created_at,status,po_number', resp: { data: { updated_at: 'x', deco_pos: null, created_at: '5/20/2026, 11:04:22 AM' }, error: null } },
  // pre-save reads of existing children (all empty — nothing to guard)
  { table: 'so_items', sel: 'id,line_id,item_index,sku,color,product_id', resp: { data: [], error: null } },
  { table: 'so_art_files', sel: '*', resp: { data: [], error: null } },
  // the wipe branch's own read of existing jobs
  { table: 'so_jobs', sel: 'id,key,art_status,art_file_id,_art_ids,items', resp: { data: jobsInDb, error: null } },
  // DB-side liveness reads
  { table: 'so_art_files', sel: 'id,deco_type', resp: liveArt },
  { table: 'so_items', sel: 'id,item_index', resp: liveItems },
  { table: 'so_item_decorations', sel: 'so_item_id,deco_index,kind,fulfillment,deco_po_id,deco_type,art_file_id,num_method,name_method', resp: liveDecos },
  // the new item row's insert returns its id
  { table: 'so_items', method: 'insert', sel: 'id', resp: { data: [{ id: 'new-1' }], error: null } },
];

const jobDeletes = (state) => state.calls.filter(c => c.table === 'so_jobs' && c.method === 'delete');

describe('_dbSaveSOInner — dead protected jobs are retired by DB-side liveness, live ones stay blocked', () => {
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

  test('ghost job — art file gone, zero decorations in DB — is deleted despite its protected status', async () => {
    const state = await run(baseRules({
      jobsInDb: [GHOST],
      liveArt: { data: [], error: null },                 // no art files left on the SO
      liveItems: { data: [{ id: 'it-1' }], error: null }, // items exist...
      liveDecos: { data: [], error: null },               // ...but carry zero decorations
    }));
    const dels = jobDeletes(state);
    expect(dels.length).toBe(1);
    expect(dels[0].inArgs).toEqual(['id', ['JOB-1053-02']]);
  });

  test('protected job whose art file still exists on the SO stays blocked', async () => {
    const state = await run(baseRules({
      jobsInDb: [GHOST],
      liveArt: { data: [{ id: 'af1773688228325' }], error: null }, // the art file is alive
      liveItems: { data: [{ id: 'it-1' }], error: null },
      liveDecos: { data: [], error: null },
    }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('protected job on an SO that still has decorations in the DB stays blocked even if its own art is gone', async () => {
    const state = await run(baseRules({
      jobsInDb: [GHOST],
      liveArt: { data: [], error: null },
      liveItems: { data: [{ id: 'it-1' }], error: null },
      liveDecos: { data: [{ id: 'd-1' }], error: null }, // a live decoration exists
    }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('numbers/names-only protected job (no declared art) stays blocked — nothing to prove dead against', async () => {
    const numbersJob = { id: 'JOB-1053-09', key: 'released_heat_transfer_JOB-1053-09', art_status: 'waiting_approval', art_file_id: null, _art_ids: [] };
    const state = await run(baseRules({
      jobsInDb: [numbersJob],
      liveArt: { data: [], error: null },
      liveItems: { data: [{ id: 'it-1' }], error: null },
      liveDecos: { data: [], error: null },
    }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('a liveness read error keeps the protection (no delete on "can\'t tell")', async () => {
    const state = await run(baseRules({
      jobsInDb: [GHOST],
      liveArt: { data: null, error: { message: 'network sadness' } }, // liveness art read fails
      liveItems: { data: [{ id: 'it-1' }], error: null },
      liveDecos: { data: [], error: null },
    }));
    expect(jobDeletes(state).length).toBe(0);
  });

  test('unprotected needs_art placeholder still deletes alongside a retired ghost', async () => {
    const placeholder = { id: 'JOB-1053-03', key: 'screen_print::unassigned@Front', art_status: 'needs_art', art_file_id: null, _art_ids: null };
    const state = await run(baseRules({
      jobsInDb: [GHOST, placeholder],
      liveArt: { data: [], error: null },
      liveItems: { data: [{ id: 'it-1' }], error: null },
      liveDecos: { data: [], error: null },
    }));
    const dels = jobDeletes(state);
    expect(dels.length).toBe(1);
    expect([...dels[0].inArgs[1]].sort()).toEqual(['JOB-1053-02', 'JOB-1053-03']);
  });
});
