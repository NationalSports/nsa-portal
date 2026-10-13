/* The common case: the rep's tab LOADED the order (bases recorded by _dbLoad), the artist changed
 * a job and an artwork row afterwards, and the rep then saves the stale copy. Runs the real loader
 * and the real save code against a mocked Supabase client.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { load: {}, responses: {}, calls: [] };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: () => { method = 'upsert'; return builder; },
      insert: () => { method = 'insert'; return builder; },
      update: () => { method = 'update'; return builder; },
      delete: () => { method = 'delete'; return builder; },
      select: () => { if (!method) method = 'select'; return builder; },
      eq: () => builder, in: () => builder, not: () => builder, or: () => builder, order: () => builder,
      gte: () => builder, gt: () => builder, lt: () => builder, lte: () => builder, is: () => builder, neq: () => builder,
      limit: () => builder, maybeSingle: () => builder, single: () => builder,
      range: () => Promise.resolve({ data: state.load[table] || [], error: null, status: 200 }),
      then: (resolve, reject) => {
        state.calls.push({ table, method });
        const q = state.responses[table] || [];
        return Promise.resolve(q.length ? q.shift() : { data: null, error: null, count: 0 }).then(resolve, reject);
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
    rpc: (name, args) => {
      if (name === 'touch_sales_order') return Promise.resolve({ data: { touched: true }, error: null });
      return require('../testHelpers/atomicSaveRpc')(state, name, args);
    },
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });
const planned = (calls, table) => calls.filter(c => c.table === table && c.planned && c.method === 'upsert').flatMap(c => c.args[0]);

test('bases recorded at load let a stale save keep the artist\'s job and artwork changes', async () => {
  process.env.REACT_APP_SUPABASE_URL = 'https://stale-load-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
  const { __mockState: st } = require('@supabase/supabase-js');
  const job = {
    id: 'JOB-L-1', so_id: 'SO-L', key: 'k', art_file_id: 'af-L', art_status: 'art_requested', item_status: 'items_received', prod_status: 'hold',
    assigned_artist: null, art_requests: [{ id: 'AR-1', status: 'requested' }], rep_notes: null, notes: null, items: [], art_messages: [],
    sent_history: [], rejections: [], follow_up_auto: false, follow_up_count: 0, art_reuse_confirmed: false,
    created_at: '2026-10-02', _version: 18,
  };
  const art = {
    id: 'af-L', so_id: 'SO-L', name: 'Bulldog', deco_type: 'screen_print', color_ways: [], notes: '', files: [], mockup_files: [],
    prod_files: [{ url: 'seps-v1.ai' }], sample_art: [], web_logos: [], item_mockups: {}, mock_links: {}, status: 'approved',
    archived: false, is_tbd: false, uploaded: '10/1/2026', _version: 29,
  };
  st.load = { sales_orders: [{ id: 'SO-L', created_at: '2026-10-01', status: 'waiting_receive', _version: 5 }], so_jobs: [job], so_art_files: [art] };
  const { _dbLoad, _dbSaveArtJobs } = require('../lib/dbEngine');
  const loaded = await _dbLoad();
  const so = (loaded?.sales_orders || []).find(s => s.id === 'SO-L');
  expect(so).toBeTruthy();
  expect(so.jobs.map(j => j._version)).toEqual([18]);
  expect(so.art_files.map(a => a._version)).toEqual([29]);
  // Artist: assigns himself (job v19) and swaps the seps (art v30), elsewhere.
  st.calls.length = 0;
  st.responses = {
    so_art_files: [{ data: [{ ...art, prod_files: [{ url: 'seps-v2.ai' }], _version: 30 }], error: null }],
    so_jobs: [{ data: [{ ...job, assigned_artist: 'tm-evan', art_requests: [{ id: 'AR-1', status: 'completed' }], _version: 19 }], error: null }],
  };
  // Rep: still holding the loaded copy, edits the job note and saves.
  const repSO = { ...so, jobs: [{ ...so.jobs[0], rep_notes: 'call coach' }] };
  expect(await _dbSaveArtJobs(repSO)).toBe(true);
  const [jobRow] = planned(st.calls, 'so_jobs');
  expect(jobRow.assigned_artist).toBe('tm-evan');
  expect(jobRow.art_requests).toEqual([{ id: 'AR-1', status: 'completed' }]);
  expect(jobRow.rep_notes).toBe('call coach');
  const [artRow] = planned(st.calls, 'so_art_files');
  expect(artRow.prod_files.map(f => f.url)).toEqual(['seps-v2.ai']);
});
