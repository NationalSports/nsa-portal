/* REGRESSION — warehouse receiving must survive a stale tab's save (SO-1663 / batch "NSA 4563",
 * SO-1837 / "PO 48200 CIVVB", 2026-08-19).
 *
 * so_items are deleted and reinserted on every SO save, so each save re-supplies PO lines from the
 * client payload. The PO-preservation guard restored lines the client NEVER SAW, but trusted the
 * client's own copy of any po_id it held — so a long-lived tab whose copy predated a warehouse
 * check-in re-inserted the line with received:{} and the fulfillment silently vanished (the
 * warehouse then had to re-scan the box hours later). The engine now merges the DB row's
 * warehouse-owned fields (received/billed/shipments/tracking/bill docs) forward into the client's
 * line whenever the save would roll received units back, unless this session deliberately edited
 * or deleted a receipt for that po_id (the _receiptEditedPoIds tombstone, same pattern as
 * _deletedPoIds).
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
    rpc: (name,args) => require('../testHelpers/atomicSaveRpc')(state,name,args),
  };
  return { createClient: () => client, __mockState: state };
});

const ORIG_ENV = { ...process.env };
beforeEach(() => {
  process.env.REACT_APP_SUPABASE_URL = 'https://rcv-rollback-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
});
afterEach(() => { process.env = { ...ORIG_ENV }; jest.resetModules(); });

const PO = 'PO 26350 SANBA';
const RECEIVED = { L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2 };
const SHIPMENT = { date: '8/19/2026', L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2 };
const BILL = { doc: '101799241', cost: 354.2, date: '08/17/2026', sizes: { L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2 }, tracking: '1ZE9W0611307658054' };

const dbItems = () => [{ id: 'oi-1', item_index: 0, sku: 'AT101', color: 'Dark Green/ White', product_id: null }];
// The DB row as the warehouse check-in left it: fully received, with its receipt + bill history.
const poRows = () => [
  { id: 'r1', so_item_id: 'oi-1', po_id: PO, vendor: 'S&S Activewear', status: 'received',
    sizes: { L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2, unit_cost: 15.4, _bill_details: [BILL], _bill_cost: 354.2 },
    received: { ...RECEIVED }, billed: {}, cancelled: {}, shipments: [SHIPMENT], tracking_numbers: [] },
];
// The stale tab's copy of the same line: loaded before the check-in, so received is empty.
const staleClientLine = (over = {}) => ({
  po_id: PO, vendor: 'S&S Activewear', status: 'waiting', created_at: '7/27/2026',
  received: {}, shipments: [], L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2, unit_cost: 15.4, ...over,
});
const payload = (line, over = {}) => ({
  id: 'SO-1663', memo: 'Santa Barbara HS Football', _decosHydrated: true,
  items: [{ sku: 'AT101', color: 'Dark Green/ White', sizes: { L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2 }, po_lines: [line] }],
  ...over,
});

const save = async (p) => {
  const { __mockState } = require('@supabase/supabase-js');
  __mockState.calls.length = 0;
  __mockState.responses = {
    sales_orders: [{ data: { updated_at: 'yesterday', deco_pos: null }, error: null }, { error: null }],
    so_items: [{ data: dbItems(), error: null }, { data: [{ id: 'n1', item_index: 0 }], error: null }],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: poRows(), error: null },        // PO-restore read
      { data: [{ po_id: PO }], error: null }, // duplicate-PO guard read
      { data: [{ po_id: PO }], error: null }, // over-commit guard read
      { error: null },                        // insert
      { count: 1, error: null },              // insert verification
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_item_decorations: [{ data: [], error: null }],
  };
  const { _dbSaveSO } = require('../lib/dbEngine');
  const ok = await _dbSaveSO(p);
  const inserted = __mockState.calls
    .filter(c => c.table === 'so_item_po_lines' && c.method === 'insert')
    .flatMap(c => (c.args && c.args[0]) || [])
    .filter(r => r.po_id === PO);
  return { ok, inserted };
};

test('a stale save that would wipe received units gets the DB receiving merged back in', async () => {
  const { ok, inserted } = await save(payload(staleClientLine()));
  expect(ok).toBe(true);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].received).toEqual(RECEIVED);
  expect(inserted[0].status).toBe('received');
  expect(inserted[0].shipments).toEqual([SHIPMENT]);
  expect(inserted[0].sizes._bill_details).toEqual([BILL]);
  expect(inserted[0].sizes._bill_cost).toBe(354.2);
});

test('a deliberate receipt edit/delete (tombstoned po_id) is honored — no merge', async () => {
  const { ok, inserted } = await save(payload(staleClientLine(), { _receiptEditedPoIds: [PO] }));
  expect(ok).toBe(true);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].received).toEqual({});
  expect(inserted[0].status).toBe('waiting');
});

test('the tombstone is scoped to its own po_id — other POs still merge', async () => {
  const { ok, inserted } = await save(payload(staleClientLine(), { _receiptEditedPoIds: ['PO 99999 XXXX'] }));
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual(RECEIVED);
});

test('a fresh additive receive is untouched, and mixed stale state merges per-size max', async () => {
  // Client received M:4 on its (stale) copy while the DB row carries the warehouse's XL:8 —
  // neither side's units may be lost.
  const line = staleClientLine({ received: { M: 4 }, status: 'partial', shipments: [{ date: '8/20/2026', M: 4 }] });
  const { ok, inserted } = await save(payload(line));
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual({ L: 3, M: 4, XL: 8, '2XL': 6, '3XL': 2 });
  // Both receipt entries survive: the client's own plus the DB's it never saw.
  expect(inserted[0].shipments).toEqual(expect.arrayContaining([SHIPMENT, { date: '8/20/2026', M: 4 }]));
  expect(inserted[0].status).toBe('received');
});

test('a client copy that already carries the receiving saves unchanged (no rollback, no merge)', async () => {
  const line = staleClientLine({ received: { ...RECEIVED }, status: 'received', shipments: [SHIPMENT] });
  const { ok, inserted } = await save(payload(line));
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual(RECEIVED);
  expect(inserted[0].shipments).toEqual([SHIPMENT]);
});

// ── Edge cases ──

const saveWith = async (p, rows) => {
  const { __mockState } = require('@supabase/supabase-js');
  __mockState.calls.length = 0;
  __mockState.responses = {
    sales_orders: [{ data: { updated_at: 'yesterday', deco_pos: null }, error: null }, { error: null }],
    so_items: [{ data: dbItems(), error: null }, { data: [{ id: 'n1', item_index: 0 }], error: null }],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: rows, error: null },
      { data: [{ po_id: PO }], error: null },
      { data: [{ po_id: PO }], error: null },
      { error: null },
      { count: rows.length, error: null },
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_item_decorations: [{ data: [], error: null }],
  };
  const { _dbSaveSO } = require('../lib/dbEngine');
  const ok = await _dbSaveSO(p);
  const inserted = __mockState.calls
    .filter(c => c.table === 'so_item_po_lines' && c.method === 'insert')
    .flatMap(c => (c.args && c.args[0]) || [])
    .filter(r => r.po_id === PO);
  return { ok, inserted };
};

test('drop-ship: a billed-only wipe is restored (received stays empty, no tombstone applies)', async () => {
  // Drop-ship fulfillment lives entirely in billed — the SO-1663 wipe shape on a drop-ship line
  // never touches received, so the guard must trigger on the billed rollback alone.
  const dbRow = { id: 'r1', so_item_id: 'oi-1', po_id: PO, vendor: 'S&S Activewear', status: 'shipped',
    sizes: { L: 3, M: 4, unit_cost: 15.4, drop_ship: true, _bill_details: [BILL], _bill_cost: 354.2 },
    received: {}, billed: { L: 3, M: 4 }, cancelled: {}, shipments: [], tracking_numbers: ['1Z999'] };
  const line = { po_id: PO, vendor: 'S&S Activewear', status: 'waiting', created_at: '7/27/2026',
    drop_ship: true, received: {}, shipments: [], L: 3, M: 4, unit_cost: 15.4 };
  const { ok, inserted } = await saveWith(payload(line), [dbRow]);
  expect(ok).toBe(true);
  expect(inserted[0].billed).toEqual({ L: 3, M: 4 });
  expect(inserted[0].sizes._bill_details).toEqual([BILL]);
  expect(inserted[0].sizes._bill_cost).toBe(354.2);
  expect(inserted[0].tracking_numbers).toEqual(['1Z999']);
  expect(inserted[0].received).toEqual({});
  // Billing-driven status is derived at render for drop-ship — the merge must not rewrite it.
  expect(inserted[0].status).toBe('waiting');
});

test('a tombstoned receipt delete still gets rolled-back BILLING restored (billed is never user-reduced)', async () => {
  const { ok, inserted } = await saveWith(
    payload(staleClientLine(), { _receiptEditedPoIds: [PO] }),
    [{ ...poRows()[0], billed: { XL: 7 } }]
  );
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual({});      // deliberate un-receive honored
  expect(inserted[0].status).toBe('waiting');
  expect(inserted[0].billed).toEqual({ XL: 7 }); // stale billing rollback still repaired
  expect(inserted[0].sizes._bill_details).toEqual([BILL]);
});

test('batch/API-order lines (api_order_id present) merge before the api-order skip branch', async () => {
  const dbRow = poRows()[0];
  dbRow.sizes.api_order_id = 'ADI-778812';
  const { ok, inserted } = await saveWith(payload(staleClientLine({ api_order_id: 'ADI-778812' })), [dbRow]);
  expect(ok).toBe(true);
  expect(inserted).toHaveLength(1);
  expect(inserted[0].received).toEqual(RECEIVED);
  expect(inserted[0].status).toBe('received');
});

test('SO-1837 shape: the stale copy also rolled back ORDERED sizes — receiving still restores in full', async () => {
  // The 8/19 CIVVB wipe reverted the client line's ordered XL 4→2 and dropped 2XL entirely; the DB
  // row had received XL:4 and 2XL:1. Received merges in full (over-received per the client's stale
  // ordered qtys is visible and correct); ordered sizes stay the rep-owned client values.
  const line = staleClientLine({ XL: 2 });
  delete line['2XL'];
  const { ok, inserted } = await saveWith(payload(line), poRows());
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual(RECEIVED);
  expect(inserted[0].status).toBe('received');
  expect(inserted[0].sizes.XL).toBe(2);          // ordered sizes untouched by the merge
  expect(inserted[0].sizes['2XL']).toBeUndefined();
});

test('cancel-aware status: merged receipts + cancelled remainder derive status received, not partial', async () => {
  const dbRow = { id: 'r1', so_item_id: 'oi-1', po_id: PO, vendor: 'S&S Activewear', status: 'received',
    sizes: { L: 5, unit_cost: 15.4 }, received: { L: 3 }, billed: {}, cancelled: { L: 2 }, shipments: [], tracking_numbers: [] };
  const line = { po_id: PO, vendor: 'S&S Activewear', status: 'waiting', created_at: '7/27/2026',
    received: {}, cancelled: { L: 2 }, shipments: [], L: 5, unit_cost: 15.4 };
  const { ok, inserted } = await saveWith(payload(line), [dbRow]);
  expect(ok).toBe(true);
  expect(inserted[0].received).toEqual({ L: 3 });
  expect(inserted[0].status).toBe('received'); // 5 ordered − 3 received − 2 cancelled = 0 open
});

test('multi-item PO (one row per item): every item\'s rolled-back line merges independently', async () => {
  const { __mockState } = require('@supabase/supabase-js');
  __mockState.calls.length = 0;
  __mockState.responses = {
    sales_orders: [{ data: { updated_at: 'yesterday', deco_pos: null }, error: null }, { error: null }],
    so_items: [
      { data: [
        { id: 'oi-1', item_index: 0, sku: 'AT101', color: 'Dark Green/ White', product_id: null },
        { id: 'oi-2', item_index: 1, sku: 'AT102', color: 'Navy', product_id: null },
      ], error: null },
      { data: [{ id: 'n1', item_index: 0 }, { id: 'n2', item_index: 1 }], error: null },
    ],
    so_art_files: [{ data: [], error: null }],
    so_item_po_lines: [
      { data: [
        { id: 'r1', so_item_id: 'oi-1', po_id: PO, vendor: 'S&S Activewear', status: 'received', sizes: { L: 3, unit_cost: 15.4 }, received: { L: 3 }, billed: {}, cancelled: {}, shipments: [], tracking_numbers: [] },
        { id: 'r2', so_item_id: 'oi-2', po_id: PO, vendor: 'S&S Activewear', status: 'received', sizes: { M: 2, unit_cost: 12.1 }, received: { M: 2 }, billed: {}, cancelled: {}, shipments: [], tracking_numbers: [] },
      ], error: null },
      { data: [{ po_id: PO }, { po_id: PO }], error: null },
      { data: [{ po_id: PO }, { po_id: PO }], error: null },
      { error: null },
      { count: 2, error: null },
    ],
    so_item_pick_lines: [{ data: [], error: null }, { data: [], error: null }],
    so_item_decorations: [{ data: [], error: null }, { data: [], error: null }],
  };
  const { _dbSaveSO } = require('../lib/dbEngine');
  const ok = await _dbSaveSO({
    id: 'SO-1663', memo: 'Santa Barbara HS Football', _decosHydrated: true,
    items: [
      { sku: 'AT101', color: 'Dark Green/ White', sizes: { L: 3 }, po_lines: [{ po_id: PO, vendor: 'S&S Activewear', status: 'waiting', created_at: '7/27/2026', received: {}, shipments: [], L: 3, unit_cost: 15.4 }] },
      { sku: 'AT102', color: 'Navy', sizes: { M: 2 }, po_lines: [{ po_id: PO, vendor: 'S&S Activewear', status: 'waiting', created_at: '7/27/2026', received: {}, shipments: [], M: 2, unit_cost: 12.1 }] },
    ],
  });
  expect(ok).toBe(true);
  const inserted = __mockState.calls
    .filter(c => c.table === 'so_item_po_lines' && c.method === 'insert')
    .flatMap(c => (c.args && c.args[0]) || [])
    .filter(r => r.po_id === PO);
  expect(inserted).toHaveLength(2);
  const bySku = Object.fromEntries(inserted.map(r => [r.sizes.L ? 'AT101' : 'AT102', r]));
  expect(bySku.AT101.received).toEqual({ L: 3 });
  expect(bySku.AT101.status).toBe('received');
  expect(bySku.AT102.received).toEqual({ M: 2 });
  expect(bySku.AT102.status).toBe('received');
});
