/* Regression tests for the doubled-PO-creation fix (SO-2121 "PO 58203 FPUA" / SO-2105 /
 * SO-1248, 2026-08-24):
 *   1. The duplicate-PO guard in _dbSaveSOInner now collapses multiple clean copies of the SAME
 *      po_id with an identical size signature on one item. The create-time race wrote such pairs,
 *      and the old guard only dropped NEW duplicates against a db-known po_id — two db-known
 *      copies of one po_id survived every subsequent save.
 *   2. _dbPersistNewPoLine is serialized through the per-SO save queue. Two back-to-back calls
 *      for different lines must BOTH write (the queue's latest-wins coalescing must not collapse
 *      them), which the fresh-saveFn-per-call wiring guarantees.
 *
 * Same hand-rolled Supabase query-builder mock as dbEngineHardening.test.js — the real save
 * functions run against canned per-table FIFO responses.
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
        state.calls.push({ table, method, args: builder._args, selectArgs: builder._selectArgs, eqArgs: builder._eqArgs, inArgs: builder._inArgs });
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
  process.env.REACT_APP_SUPABASE_URL = 'https://po-dup-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
};
const restoreEnv = () => { process.env = { ...ORIG_ENV }; };

describe('_dbSaveSOInner — identical clean copies of the same po_id collapse to one (self-heal)', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  const clientPoLine = () => ({
    po_id: 'PO 58203 FPUA', vendor: 'Adidas', status: 'waiting', created_at: '8/24/2026',
    received: {}, cancelled: {}, shipments: [], memo: '', unit_cost: 11.25, '2XL': 3,
  });
  const dbPoRow = (id) => ({
    id, so_item_id: 'oi-1', po_id: 'PO 58203 FPUA', vendor: 'Adidas', status: 'waiting',
    sizes: { '2XL': 3, unit_cost: 11.25 }, received: {}, billed: {}, cancelled: {},
    shipments: [], tracking_numbers: [],
  });

  test('a loaded duplicate pair is written back as a single PO line', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      sales_orders: [
        { data: { updated_at: 'yesterday', deco_pos: null }, error: null }, // existingSO select
        { error: null },                                                    // sales_orders upsert
      ],
      so_items: [
        { data: [{ id: 'oi-1', item_index: 0, sku: 'JX4468', color: 'Orange/White', product_id: null }], error: null }, // old-items read
        { data: [{ id: 'n1' }], error: null },                              // insert: 1 row back
      ],
      so_art_files: [{ data: [], error: null }],
      so_item_po_lines: [
        { data: [dbPoRow('po-row-1'), dbPoRow('po-row-2')], error: null },  // PO-restore read (both dup rows)
        { data: [{ po_id: 'PO 58203 FPUA' }, { po_id: 'PO 58203 FPUA' }], error: null }, // duplicate-PO guard read
        { data: [{ po_id: 'PO 58203 FPUA' }], error: null },                // over-commit guard read
        { error: null },                                                    // PO-line insert
        { count: 1, error: null },                                          // insert verification count
      ],
      so_item_pick_lines: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    };

    const { _dbSaveSO, _dbSaveFailedIds, _setRestoredLinesSync } = require('../lib/dbEngine');
    // The drop must also be pushed into live React state (kind 'po_drop'), or the open tab keeps
    // rendering — and re-saving — the phantom duplicate until a manual reload.
    const syncCalls = [];
    _setRestoredLinesSync((soId, restores) => syncCalls.push({ soId, restores }));
    const so = {
      id: 'SO-DUP-1',
      memo: 'dup po pair',
      _decosHydrated: true,
      items: [{
        sku: 'JX4468', color: 'Orange/White', sizes: { '2XL': 6 },
        pick_lines: [],
        // The creation-race artifact: the same line twice, both clean, same po_id + size signature.
        po_lines: [clientPoLine(), clientPoLine()],
      }],
    };
    const result = await _dbSaveSO(so);

    expect(result).toBe(true);
    expect(_dbSaveFailedIds.has('SO-DUP-1')).toBe(false);

    const poInserts = __mockState.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'insert');
    expect(poInserts.length).toBe(1);
    const rows = poInserts[0].args[0];
    expect(rows.length).toBe(1); // one copy survives, the exact duplicate is dropped
    expect(rows[0].po_id).toBe('PO 58203 FPUA');
    expect(rows[0].sizes['2XL']).toBe(3);

    // The dropped copy is announced to the live-state sync so the open tab stops showing it.
    const drops = syncCalls.flatMap(c => c.soId === 'SO-DUP-1' ? c.restores.filter(r => r.kind === 'po_drop') : []);
    expect(drops.length).toBe(1);
    expect(drops[0].line.po_id).toBe('PO 58203 FPUA');
    expect(drops[0].idx).toBe(0);
  });
});

describe('_dbPersistNewPoLine — queued per SO, and back-to-back calls both write', () => {
  beforeEach(() => { withSupabaseEnv(); jest.resetModules(); });
  afterEach(() => { restoreEnv(); jest.resetModules(); });

  test('two lines persisted in a row are both inserted (no queue coalescing)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      so_items: [
        { data: { id: 'oi-7' }, error: null },   // item lookup, call 1
        { data: { id: 'oi-11' }, error: null },  // item lookup, call 2
      ],
      so_item_po_lines: [
        { data: [], error: null }, // existence check, call 1 — nothing yet
        { error: null },           // insert, call 1
        { data: [], error: null }, // existence check, call 2
        { error: null },           // insert, call 2
      ],
    };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await Promise.all([
      _dbPersistNewPoLine('SO-DUP-2', 7, { po_id: 'PO 58203 FPUA', vendor: 'Adidas', status: 'waiting', received: {}, shipments: [], '2XL': 3 }),
      _dbPersistNewPoLine('SO-DUP-2', 11, { po_id: 'PO 58203 FPUA', vendor: 'Adidas', status: 'waiting', received: {}, shipments: [], S: 2, M: 3, L: 3, XL: 4 }),
    ]);

    const inserts = __mockState.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'insert');
    expect(inserts.length).toBe(2);
    expect(inserts[0].args[0].so_item_id).toBe('oi-7');
    expect(inserts[1].args[0].so_item_id).toBe('oi-11');
    expect(inserts.every(c => c.args[0].po_id === 'PO 58203 FPUA')).toBe(true);
  });

  test('an already-persisted line is a no-op (idempotence preserved through the queue)', async () => {
    const { __mockState } = require('@supabase/supabase-js');
    __mockState.calls.length = 0;
    __mockState.responses = {
      so_items: [{ data: { id: 'oi-7' }, error: null }],
      so_item_po_lines: [
        { data: [{ id: 'existing-row' }], error: null }, // existence check finds the row
      ],
    };

    const { _dbPersistNewPoLine } = require('../lib/dbEngine');
    await _dbPersistNewPoLine('SO-DUP-3', 7, { po_id: 'PO 58203 FPUA', vendor: 'Adidas', status: 'waiting', received: {}, shipments: [], '2XL': 3 });

    const inserts = __mockState.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'insert');
    expect(inserts.length).toBe(0);
  });
});
