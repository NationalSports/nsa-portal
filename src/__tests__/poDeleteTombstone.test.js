/* REGRESSION — a deliberately deleted product PO must stay deleted (SO-2015 / "PO 57204 SAHV").
 *
 * so_items are deleted and reinserted on every SO save, so the save re-supplies each item's PO
 * lines from the client payload and re-injects any DB line the client "never knew about" — the
 * guard that stops a stale tab from wiping POs another session added. Intent was inferred from
 * _hydratedPoIds (the po_ids present when the SO loaded). Whenever that marker was absent — a poll
 * merge that kept local po_lines over an empty DB read, or a load whose so_item_po_lines read timed
 * out — a rep's Delete PO was read as stale state and the line came straight back on reload, with
 * only a "PO deleted" toast to the contrary. The editor now stamps a session tombstone
 * (_deletedPoIds) the same way it already does for deco POs (_deletedDecoPoIds) and items
 * (_deletedItemKeys), and the guard honors it.
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
      maybeSingle: () => builder, single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args });
        const q = state.responses[table] || [];
        return Promise.resolve(q.length ? q.shift() : DEFAULT).then(resolve, reject);
      },
    };
    return builder;
  };
  const client = {
    from: (t) => makeBuilder(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
beforeEach(() => {
  process.env.REACT_APP_SUPABASE_URL = 'https://po-tombstone-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
});
afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

const PO = 'PO 57204 SAHV';
// The three District lines SO-2015 carried on that PO.
const dbItems = () => [
  { id: 'oi-7', item_index: 7, sku: 'DT104', color: 'Ash', product_id: null },
  { id: 'oi-8', item_index: 8, sku: 'DT2800', color: 'Navy', product_id: null },
  { id: 'oi-9', item_index: 9, sku: 'DM104L', color: 'Heathered Steel', product_id: null },
];
const poRows = () => [
  { id: 'r1', so_item_id: 'oi-7', po_id: PO, vendor: 'SanMar', status: 'waiting', sizes: { XS: 1, S: 2, M: 4, L: 5, XL: 2, unit_cost: 3.25 }, received: {}, billed: {}, shipments: [], tracking_numbers: [] },
  { id: 'r2', so_item_id: 'oi-8', po_id: PO, vendor: 'SanMar', status: 'waiting', sizes: { L: 1, unit_cost: 11.37 }, received: {}, billed: {}, shipments: [], tracking_numbers: [] },
  { id: 'r3', so_item_id: 'oi-9', po_id: PO, vendor: 'SanMar', status: 'waiting', sizes: { M: 2, unit_cost: 3.79 }, received: {}, billed: {}, shipments: [], tracking_numbers: [] },
];
// What the editor saves right after Delete PO: items intact, that PO's lines gone.
const afterDelete = (over = {}) => ({
  id: 'SO-2015', memo: 'Spirit Academy HS Volleyball', _decosHydrated: true,
  items: [
    { sku: 'DT104', color: 'Ash', sizes: { XS: 1, S: 2, M: 4, L: 5, XL: 2 }, po_lines: [] },
    { sku: 'DT2800', color: 'Navy', sizes: { L: 1 }, po_lines: [] },
    { sku: 'DM104L', color: 'Heathered Steel', sizes: { M: 2 }, po_lines: [] },
  ],
  ...over,
});

const save = async (payload) => {
  const { __mockState } = require('@supabase/supabase-js');
  __mockState.calls.length = 0;
  __mockState.responses = {
    sales_orders: [{ data: { updated_at: 'yesterday', deco_pos: null }, error: null }, { error: null }],
    so_items: [{ data: dbItems(), error: null }, { data: [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }], error: null }],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: poRows(), error: null },        // PO-restore read
      { data: [{ po_id: PO }], error: null }, // duplicate-PO guard read
      { data: [{ po_id: PO }], error: null }, // over-commit guard read
      { error: null },                        // insert
      { count: 3, error: null },              // insert verification
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_item_decorations: [{ data: [], error: null }],
  };
  const { _dbSaveSO } = require('../lib/dbEngine');
  const ok = await _dbSaveSO(payload);
  const reinserted = __mockState.calls
    .filter(c => c.table === 'so_item_po_lines' && c.method === 'insert')
    .flatMap(c => (c.args && c.args[0]) || [])
    .filter(r => r.po_id === PO);
  return { ok, reinserted };
};

test('tombstoned PO stays deleted even when the tab never recorded it as hydrated', async () => {
  // The reported failure: no _hydratedPoIds (poll merge kept the lines but took the DB row's empty
  // marker), so intent could not be inferred. The tombstone carries it instead.
  const { ok, reinserted } = await save(afterDelete({ _deletedPoIds: [PO] }));
  expect(ok).toBe(true);
  expect(reinserted).toHaveLength(0);
});

test('tombstoned PO stays deleted even when the PO-line load timed out (_posHydrated false)', async () => {
  const { ok, reinserted } = await save(afterDelete({ _deletedPoIds: [PO], _posHydrated: false }));
  expect(ok).toBe(true);
  expect(reinserted).toHaveLength(0);
});

test('a cleanly-loaded delete is still honored without a tombstone (pre-existing path)', async () => {
  const { ok, reinserted } = await save(afterDelete({ _posHydrated: true, _hydratedPoIds: [PO] }));
  expect(ok).toBe(true);
  expect(reinserted).toHaveLength(0);
});

test('a PO this session neither loaded nor deleted is STILL restored (guard intact)', async () => {
  // No tombstone, nothing hydrated: another tab added this PO and we must not wipe it.
  const { ok, reinserted } = await save(afterDelete());
  expect(ok).toBe(true);
  expect(reinserted).toHaveLength(3);
});

test('the tombstone is scoped to its own po_id — other POs are still protected', async () => {
  const { ok, reinserted } = await save(afterDelete({ _deletedPoIds: ['PO 99999 XXXX'] }));
  expect(ok).toBe(true);
  expect(reinserted).toHaveLength(3);
});
