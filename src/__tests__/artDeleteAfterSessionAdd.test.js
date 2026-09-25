/* Regression (EST-2688): art added to an order AFTER it was opened (a Previous Artwork pull, an upload)
 * was saved to the DB but never became "known" to the delete guard, which only trusted _hydratedArtIds
 * captured at load. Deleting that art later in the same session never reached the DB, so the logo came
 * back on the next reload. Art this client wrote itself must be deletable; art added by someone else
 * (neither loaded nor written here) must still be preserved.
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
const artDeletes = (calls) => calls.filter(c => c.table === 'so_art_files' && c.method === 'delete' && c.planned);
const eagles = { id: 'af-eagles', name: 'Golden Eagles', deco_type: 'screen_print', files: [], mockup_files: [], prod_files: [] };

describe('art added this session can be deleted this session', () => {
  beforeEach(() => {
    process.env.REACT_APP_SUPABASE_URL = 'https://art-delete-test.supabase.co';
    process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
    jest.resetModules();
  });
  afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

  test('pull art in, save, delete it, save again: the delete is sent', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const { _dbSaveArtFiles } = require('../lib/dbEngine');
    // Opened with no art (nothing hydrated), rep pulls Golden Eagles in and it saves.
    __mockState.responses = { so_art_files: [{ data: [], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-ART-1', _hydratedArtIds: [], art_files: [{ ...eagles }] })).toBe(true);
    // Rep deletes it. The DB now holds the row this client wrote.
    __mockState.calls.length = 0;
    __mockState.responses = { so_art_files: [{ data: [{ ...eagles, so_id: 'SO-ART-1', _version: 1 }], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-ART-1', _hydratedArtIds: [], art_files: [] })).toBe(true);
    const del = artDeletes(__mockState.calls);
    expect(del.length).toBe(1);
    expect(del[0].inArgs).toEqual(['id', ['af-eagles']]);
  });

  test('art another user added (never loaded or written here) is still preserved', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    const { _dbSaveArtFiles } = require('../lib/dbEngine');
    __mockState.responses = { so_art_files: [{ data: [{ ...eagles, id: 'af-theirs', so_id: 'SO-ART-2', _version: 1 }], error: null }] };
    expect(await _dbSaveArtFiles({ id: 'SO-ART-2', _hydratedArtIds: [], art_files: [] })).toBe(true);
    expect(artDeletes(__mockState.calls).length).toBe(0);
  });
});
