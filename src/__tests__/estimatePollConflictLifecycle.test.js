/* End-to-end regression for #2276's unsafe version adoption.
 *
 * Exercise the real estimate save wrapper and stale RPC handling, then the poll decision, then a
 * new edit based on the cloud row. The important invariant is that v4's content reaches the v5
 * write; the rejected v3 document is only retained in the outbox for explicit review.
 */
jest.mock('../lib/draftJournal', () => ({
  protectDocumentDraft: (_table, _payload, save) => save(),
  currentDraftOwner: () => 'rep-1',
  draftJournal: { list: () => Promise.resolve([]), acknowledge: () => Promise.resolve(true) },
}));

jest.mock('@supabase/supabase-js', () => {
  const state = { responses: {}, calls: [], estimateRpcResults: [] };
  const DEFAULT = { data: null, error: null };
  const makeBuilder = table => {
    let method = null;
    const builder = {
      select: (...args) => { method = 'select'; builder.args = args; return builder; },
      eq: () => builder,
      in: () => builder,
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder.args });
        const queue = state.responses[table] || [];
        return Promise.resolve(queue.length ? queue.shift() : DEFAULT).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: table => makeBuilder(table),
    auth: {
      getSession: () => Promise.resolve({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'rep-1' } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: (name, args) => {
      state.calls.push({ table: 'RPC', method: name, args: [args] });
      if (name === 'estimate_save_token') return Promise.resolve({ data: 'test-save-token', error: null });
      if (name === 'save_estimate') return Promise.resolve(state.estimateRpcResults.shift() || DEFAULT);
      return Promise.resolve(DEFAULT);
    },
  };
  return { createClient: () => client, __mockState: state };
});

const ORIGINAL_ENV = { ...process.env };
const ID = 'EST-2522';
const CREATED_AT = '2026-09-11T13:00:00.000Z';
const DB_TS = '2026-09-11T13:29:46.000Z';
const LOCAL_TS = new Date('2026-09-11T13:39:18.000Z').toLocaleString();
const item = () => ({ sku: 'TEE', name: 'Tee', color: 'Red', sizes: { M: 1 }, decorations: [] });
const estimate = overrides => ({
  id: ID,
  customer_id: 'customer-1',
  customer_name: 'Glen A Wilson HS',
  created_by: 'rep-1',
  created_at: CREATED_AT,
  updated_at: LOCAL_TS,
  _itemsHydrated: true,
  _artHydrated: true,
  _decosHydrated: true,
  art_files: [],
  items: [item()],
  ...overrides,
});

describe('estimate stale-save -> poll conflict -> safe next save', () => {
  beforeEach(() => {
    process.env.REACT_APP_SUPABASE_URL = 'https://estimate-poll-conflict-test.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
    localStorage.clear();
    localStorage.setItem('nsa_user', JSON.stringify({ id: 'rep-1', name: 'Test Rep' }));
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    localStorage.clear();
    jest.resetModules();
  });

  test('does not turn rejected v3 content into a v4 overwrite; an edit from cloud v4 saves as v5', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      estimates: [
        { data: { _version: 4 }, error: null },
        { data: { id: ID, created_at: CREATED_AT }, error: null },
      ],
      estimate_art_files: [{ data: [], error: null }],
      estimate_items: [{ data: [], error: null }],
    };
    __mockState.estimateRpcResults = [{ data: { stale: true, version: 4 }, error: null }];

    const engine = require('../lib/dbEngine');
    const { estimatePollRecencyDecision } = require('../lib/pollMergeRecency');
    const staleV3 = estimate({ _version: 3, memo: 'rejected v3 edit', deco_pos: 'v3 layout' });

    expect(await engine._dbSaveEstimate(staleV3)).toBe('stale');
    const staleRpc = __mockState.calls.find(call => call.method === 'save_estimate');
    expect(staleRpc.args[0].p_base_version).toBe(3);

    const [preserved] = engine._outboxList();
    expect(preserved).toMatchObject({ id: ID, baseVersion: 3 });
    expect(preserved.payload).toMatchObject({ _version: 4, _obBaseVersion: 3, memo: 'rejected v3 edit' });

    const cloudV4 = estimate({
      _version: 4,
      updated_at: DB_TS,
      memo: 'cloud v4 change',
      deco_pos: 'v4 layout must survive',
    });
    expect(estimatePollRecencyDecision(preserved.payload, cloudV4)).toBe('conflict');
    // The poll accepts cloudV4; the rejected payload remains only in the recovery entry above.

    engine._clearDocumentConflictCooldown(ID);
    __mockState.calls.length = 0;
    __mockState.responses = {
      estimates: [
        { data: { _version: 4 }, error: null },
        { data: { id: ID, created_at: CREATED_AT }, error: null },
      ],
      estimate_art_files: [{ data: [], error: null }],
      estimate_items: [{ data: [], error: null }],
    };
    __mockState.estimateRpcResults = [{
      data: { estimate_id: ID, version: 5, line_ids: [{ item_index: 0, line_id: 'line-v5' }] },
      error: null,
    }];

    const editedFromV4 = { ...cloudV4, memo: 'new edit made after loading v4', updated_at: new Date().toLocaleString() };
    expect(await engine._dbSaveEstimate(editedFromV4)).toBe(true);

    const v5Rpc = __mockState.calls.find(call => call.method === 'save_estimate');
    expect(v5Rpc.args[0].p_base_version).toBe(4);
    expect(v5Rpc.args[0].p_estimate).toMatchObject({
      memo: 'new edit made after loading v4',
      deco_pos: 'v4 layout must survive',
    });
    expect(editedFromV4._version).toBe(5);
    expect(engine._outboxList()).toHaveLength(0);
  });
});
