/* Fast receipt persistence — _dbSaveReceiptLines (NSA 4568 follow-up, 2026-08-25).
 *
 * PR #2002 gated check-in labels on the FULL SO save (~30 sequential round trips), which
 * stretched each package check-in to minutes on the warehouse iPad. _dbSaveReceiptLines is the
 * targeted write the label gate now waits on instead: delta-add received units onto the exact
 * so_item_po_lines rows just checked in, verified row-by-row, falling back to the full save's
 * result whenever it can't confirm. These tests drive the real function through the same
 * hand-rolled Supabase mock the other dbEngine suites use.
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
      eq: (...a) => { (builder._eqArgs = builder._eqArgs || []).push(a); return builder; },
      in: (...a) => { (builder._inArgs = builder._inArgs || []).push(a); return builder; },
      maybeSingle: () => builder,
      single: () => builder,
      then: (resolve, reject) => {
        state.calls.push({ table, method, args: builder._args, eqArgs: builder._eqArgs, inArgs: builder._inArgs });
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
beforeEach(() => {
  process.env.REACT_APP_SUPABASE_URL = 'https://fast-receipt-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
});
afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

const load = () => {
  const engine = require('../lib/dbEngine');
  const state = require('@supabase/supabase-js').__mockState;
  state.responses = {}; state.calls = [];
  return { engine, state };
};

const ITEMS = [{ id: 'oi-1', item_index: 0 }, { id: 'oi-2', item_index: 1 }];
// sizes jsonb as _poLineToRow stores it: ordered size qtys + non-size metadata riding along.
const ROW = (over = {}) => ({
  id: 'pl-1', so_item_id: 'oi-1', po_id: 'PO 100 SANBA',
  received: {}, shipments: [], cancelled: {}, status: 'waiting',
  sizes: { M: 5, L: 5, po_type: 'garment', unit_cost: 12.5 },
  ...over,
});
const UPD = (over = {}) => ({ itemIdx: 0, poId: 'PO 100 SANBA', rcv: { M: 5, L: 5 }, shipment: { date: '8/25/2026', M: 5, L: 5 }, ...over });

const updateCalls = (state) => state.calls.filter(c => c.table === 'so_item_po_lines' && c.method === 'update');

test('full check-in confirms in ~4 round trips: delta-adds received, appends the shipment, derives status ignoring non-size metadata', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW()], error: null },              // read
    { data: [{ id: 'pl-1' }], error: null },     // update (verified via .select)
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD()]);
  expect(ok).toBe(true);
  const upd = updateCalls(state);
  expect(upd).toHaveLength(1);
  const payload = upd[0].args[0];
  expect(payload.received).toEqual({ M: 5, L: 5 });
  expect(payload.shipments).toEqual([{ date: '8/25/2026', M: 5, L: 5 }]);
  // unit_cost (12.5, numeric, inside sizes) must NOT count as an open size — all sizes received ⇒ 'received'.
  expect(payload.status).toBe('received');
  // The SO stamp is bumped for other tabs' polls.
  expect(state.calls.some(c => c.table === 'sales_orders' && c.method === 'update')).toBe(true);
});

test('delta-add: units already received by another session survive (no absolute overwrite)', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW({ received: { M: 2 }, shipments: [{ date: '8/20/2026', M: 2 }] })], error: null },
    { data: [{ id: 'pl-1' }], error: null },
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD({ rcv: { M: 3 }, shipment: { date: '8/25/2026', M: 3 } })]);
  expect(ok).toBe(true);
  const payload = updateCalls(state)[0].args[0];
  expect(payload.received).toEqual({ M: 5 });
  expect(payload.shipments).toHaveLength(2);
  expect(payload.status).toBe('partial'); // L:5 still open
});

test('two updates hitting the same (item, po) pair merge into one write — no delta lost', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW()], error: null },
    { data: [{ id: 'pl-1' }], error: null },
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [
    UPD({ rcv: { M: 2 }, shipment: { date: '8/25/2026', M: 2 } }),
    UPD({ rcv: { M: 3 }, shipment: { date: '8/25/2026', M: 3 } }),
  ]);
  expect(ok).toBe(true);
  const upd = updateCalls(state);
  expect(upd).toHaveLength(1);
  expect(upd[0].args[0].received).toEqual({ M: 5 });
  expect(upd[0].args[0].shipments).toHaveLength(2);
});

test('returns false without writing when the PO line is not in the DB (falls back to the full save)', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [{ data: [], error: null }];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD()]);
  expect(ok).toBe(false);
  expect(updateCalls(state)).toHaveLength(0);
});

test('returns false when the item row is missing (never-saved order)', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: [], error: null }];
  const ok = await engine._dbSaveReceiptLines('SO-9999', [UPD()]);
  expect(ok).toBe(false);
  expect(updateCalls(state)).toHaveLength(0);
});

test('an update that matches 0 rows is a failure, not a silent success', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW()], error: null },
    { data: [], error: null }, // update .select() returns no rows — write didn't land
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD()]);
  expect(ok).toBe(false);
});

test('an update error is a failure', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW()], error: null },
    { data: null, error: { message: 'permission denied for table so_item_po_lines' } },
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD()]);
  expect(ok).toBe(false);
});

test('cancel-aware status: cancelled sizes do not hold the line open', async () => {
  const { engine, state } = load();
  state.responses.so_items = [{ data: ITEMS, error: null }];
  state.responses.so_item_po_lines = [
    { data: [ROW({ cancelled: { L: 5 } })], error: null },
    { data: [{ id: 'pl-1' }], error: null },
  ];
  const ok = await engine._dbSaveReceiptLines('SO-1462', [UPD({ rcv: { M: 5 }, shipment: { date: '8/25/2026', M: 5 } })]);
  expect(ok).toBe(true);
  expect(updateCalls(state)[0].args[0].status).toBe('received');
});
