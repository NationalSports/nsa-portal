/* End-to-end through dbEngine's real save code (mocked Supabase client): Art Dashboard saves no
 * longer move the order's version, so a rep's open order can hold STALE job / artwork rows. Saving
 * that stale copy must keep the artist's newer values and only apply what the rep changed
 * (lib/staleRowMerge). Bases come from this client's own earlier write, exactly as in the app.
 */

jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [], touchError: null };
  const DEFAULT = { data: null, error: null, count: 0 };
  const makeBuilder = (table) => {
    let method = null;
    const builder = {
      upsert: (...a) => { method = 'upsert'; return builder; },
      insert: (...a) => { method = 'insert'; return builder; },
      update: (...a) => { method = 'update'; return builder; },
      delete: (...a) => { method = 'delete'; return builder; },
      select: (...a) => { if (!method) method = 'select'; builder._select = a[0]; return builder; },
      eq: () => builder, in: () => builder, maybeSingle: () => builder, single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, select: builder._select });
        const q = state.responses[table] || [];
        return Promise.resolve(q.length ? q.shift() : DEFAULT).then(resolve, reject);
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
    rpc: (name, args) => {
      if (name === 'touch_sales_order') {
        state.calls.push({ table: 'RPC', method: name, args: [args] });
        if (state.touchError) return Promise.resolve({ data: null, error: state.touchError });
        return Promise.resolve({ data: { touched: true }, error: null });
      }
      return require('../testHelpers/atomicSaveRpc')(state, name, args);
    },
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
const planned = (calls, table) => calls.filter(c => c.table === table && c.planned && c.method === 'upsert').flatMap(c => c.args[0]);

const jobAt = (extra = {}) => ({
  id: 'JOB-2444-04', key: 'screen_print::art_af1', art_file_id: 'af1', art_name: '11in Arch', deco_type: 'screen_print',
  art_status: 'art_requested', item_status: 'items_received', prod_status: 'hold', total_units: 25, fulfilled_units: 25,
  assigned_artist: null, art_requests: [{ id: 'AR-1', status: 'requested', artist: null }], rep_notes: null, notes: null,
  items: [{ sku: 'JX4481', units: 25 }], art_messages: [], sent_history: [], rejections: [], follow_up_auto: false, follow_up_count: 0,
  art_reuse_confirmed: false, ...extra,
});
const artAt = (extra = {}) => ({
  id: 'af1', name: '11in Arch San Mateo', deco_type: 'screen_print', color_ways: [{ id: 'cw1', inks: ['White'] }], notes: '',
  files: [], mockup_files: [], prod_files: [{ url: 'old-sep.ai', name: 'old-sep.ai' }], sample_art: [], web_logos: [],
  item_mockups: {}, mock_links: {}, status: 'approved', archived: false, is_tbd: false, ...extra,
});

describe('stale job/art rows are three-way merged at save time', () => {
  beforeEach(() => {
    process.env.REACT_APP_SUPABASE_URL = 'https://stale-row-test.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
    jest.resetModules();
  });
  afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

  test('job: the artist\'s assignment and closed request survive the rep\'s stale save; the rep\'s note lands', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtJobs } = require('../lib/dbEngine');
    // 1. This client saves the job (DB had it at v18) → it now holds v19 and recorded that base.
    const so = { id: 'SO-2444', art_files: [], jobs: [jobAt({ _version: 18 })] };
    st.responses = { so_art_files: [{ data: [], error: null }], so_jobs: [{ data: [{ ...jobAt(), so_id: 'SO-2444', _version: 18 }], error: null }] };
    expect(await _dbSaveArtJobs(so)).toBe(true);
    expect(so.jobs[0]._version).toBe(19);
    // 2. The artist assigns himself and closes the request elsewhere → DB at v20.
    const artistRow = { ...jobAt({ assigned_artist: 'tm-evan', art_requests: [{ id: 'AR-1', status: 'completed', artist: 'tm-evan' }], art_status: 'waiting_approval' }), so_id: 'SO-2444', _version: 20 };
    // 3. The rep's tab (still at v19) adds a note and saves.
    st.calls.length = 0;
    st.responses = { so_art_files: [{ data: [], error: null }], so_jobs: [{ data: [artistRow], error: null }] };
    const repSO = { id: 'SO-2444', art_files: [], jobs: [{ ...so.jobs[0], rep_notes: 'rush — game Friday' }] };
    expect(await _dbSaveArtJobs(repSO)).toBe(true);
    const [row] = planned(st.calls, 'so_jobs');
    expect(row.assigned_artist).toBe('tm-evan');
    expect(row.art_requests).toEqual([{ id: 'AR-1', status: 'completed', artist: 'tm-evan' }]);
    expect(row.art_status).toBe('waiting_approval');
    expect(row.rep_notes).toBe('rush — game Friday');
    expect(st.calls.some(c => c.table === 'so_jobs' && c.select === '*')).toBe(true);
  });

  test('art: a stale copy neither reverts the artist\'s rename nor resurrects a deleted file; the rep\'s upload is added', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtFiles } = require('../lib/dbEngine');
    const so = { id: 'SO-2444', _hydratedArtIds: ['af1'], art_files: [artAt({ _version: 29 })] };
    st.responses = { so_art_files: [{ data: [{ ...artAt(), so_id: 'SO-2444', _version: 29 }], error: null }] };
    expect(await _dbSaveArtFiles(so)).toBe(true);
    expect(so.art_files[0]._version).toBe(30);
    // Artist renames, replaces the old seps with new ones → DB v31.
    const artistRow = { ...artAt({ name: '11in Arch San Mateo Basketball', prod_files: [{ url: 'new-sep.ai', name: 'new-sep.ai' }] }), so_id: 'SO-2444', _version: 31 };
    st.calls.length = 0;
    st.responses = { so_art_files: [{ data: [artistRow], error: null }] };
    const repArt = { ...so.art_files[0], mockup_files: [{ url: 'rep-mock.png', name: 'rep-mock.png' }] };
    expect(await _dbSaveArtFiles({ id: 'SO-2444', _hydratedArtIds: ['af1'], art_files: [repArt] })).toBe(true);
    const [row] = planned(st.calls, 'so_art_files');
    expect(row.name).toBe('11in Arch San Mateo Basketball');
    expect(row.prod_files.map(f => f.url)).toEqual(['new-sep.ai']);
    expect(row.mockup_files.map(f => f.url)).toEqual(['rep-mock.png']);
  });

  test('a rep\'s own rename on a stale copy still wins', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtFiles } = require('../lib/dbEngine');
    const so = { id: 'SO-9', _hydratedArtIds: ['af1'], art_files: [artAt({ _version: 4 })] };
    st.responses = { so_art_files: [{ data: [{ ...artAt(), so_id: 'SO-9', _version: 4 }], error: null }] };
    expect(await _dbSaveArtFiles(so)).toBe(true);
    st.calls.length = 0;
    st.responses = { so_art_files: [{ data: [{ ...artAt({ notes: 'artist note' }), so_id: 'SO-9', _version: 6 }], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-9', _hydratedArtIds: ['af1'], art_files: [{ ...so.art_files[0], name: 'Rep rename' }] })).toBe(true);
    const [row] = planned(st.calls, 'so_art_files');
    expect(row.name).toBe('Rep rename');
    expect(row.notes).toBe('artist note');
  });

  test('no recorded base (fresh session): previous behavior — the client\'s content is overlaid', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtFiles } = require('../lib/dbEngine');
    st.responses = { so_art_files: [{ data: [{ ...artAt({ name: 'DB name' }), so_id: 'SO-7', _version: 9 }], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-7', _hydratedArtIds: ['af1'], art_files: [artAt({ name: 'Client name', _version: 3 })] })).toBe(true);
    expect(planned(st.calls, 'so_art_files')[0].name).toBe('Client name');
  });

  test('a quiet light save fails without a toast (the router retries it as a full save); a normal one still toasts', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtJobs, _dbSaveArtFiles, _setDbNotify } = require('../lib/dbEngine');
    const toasts = [];
    _setDbNotify((msg, kind) => toasts.push([msg, kind]));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      st.responses = { so_art_files: [{ data: [], error: null }], so_jobs: [{ data: [], error: null }] };
      st.atomicError = { message: 'save token mismatch' };
      expect(await _dbSaveArtJobs({ id: 'SO-Q', art_files: [artAt()], jobs: [jobAt()] }, { quiet: true })).toBe(false);
      st.responses = { so_art_files: [{ data: [], error: null }] };
      st.atomicError = { message: 'save token mismatch' };
      expect(await _dbSaveArtFiles({ id: 'SO-Q', _hydratedArtIds: [], art_files: [artAt()] }, { quiet: true })).toBe(false);
      expect(toasts).toEqual([]);
      st.responses = { so_art_files: [{ data: [], error: null }] };
      st.atomicError = { message: 'save token mismatch' };
      expect(await _dbSaveArtFiles({ id: 'SO-Q', _hydratedArtIds: [], art_files: [artAt({ name: 'y' })] })).toBe(false);
      expect(toasts).toEqual([['Artwork was not saved: save token mismatch', 'error']]);
    } finally { warn.mockRestore(); _setDbNotify(null); }
  });

  test('light saves touch the order; a missing touch RPC turns the light path off', async () => {
    const { __mockState: st } = require('@supabase/supabase-js');
    const { _dbSaveArtFiles, _soTouchAvailable } = require('../lib/dbEngine');
    st.calls.length = 0;
    st.responses = { so_art_files: [{ data: [], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-5', _hydratedArtIds: [], art_files: [artAt()] })).toBe(true);
    expect(st.calls.filter(c => c.method === 'touch_sales_order').map(c => c.args[0])).toEqual([{ p_so_id: 'SO-5' }]);
    expect(_soTouchAvailable()).toBe(true);
    st.touchError = { code: 'PGRST202', message: 'Could not find the function public.touch_sales_order' };
    st.responses = { so_art_files: [{ data: [], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-5', _hydratedArtIds: [], art_files: [artAt({ name: 'x' })] })).toBe(true);
    expect(_soTouchAvailable()).toBe(false);
    st.touchError = null;
  });
});
