// Per-order live refresh (2026-10-14): a changed order is re-read on its own instead of every order.
// The refreshed order must be IDENTICAL to what the full load builds for it — same item dedup,
// decoration order, pick/PO lines, carry-over job filtering and hydration flags — because both feed
// the same state and the same save baseline.
const tables = {
  sales_orders: [
    {id: 'SO-1', customer_id: 'C-1', _version: 7, created_at: '2026-10-01T00:00:00Z', status: 'waiting_receive', deco_pos: []},
    {id: 'SO-2', customer_id: 'C-2', _version: 3, created_at: '2026-10-02T00:00:00Z', status: 'need_order'},
  ],
  so_items: [
    {id: 11, so_id: 'SO-1', item_index: 0, sku: 'TEE', color: 'Red', sizes: {M: 2}, line_id: 'L1'},
    {id: 12, so_id: 'SO-1', item_index: 1, sku: 'HOOD', color: 'Black', sizes: null, line_id: 'L2'},
    {id: 13, so_id: 'SO-1', item_index: 1, sku: 'HOOD', color: 'Black', sizes: {L: 1}, line_id: 'L2'}, // phantom duplicate index
    {id: 21, so_id: 'SO-2', item_index: 0, sku: 'CAP', color: 'Navy', sizes: {OSFA: 5}, line_id: 'L3'},
  ],
  so_item_decorations: [
    {id: 101, so_item_id: 11, deco_index: 1, kind: 'art', art_file_id: 'A2'},
    {id: 102, so_item_id: 11, deco_index: 0, kind: 'art', art_file_id: 'A1'},
    {id: 103, so_item_id: 13, deco_index: 0, kind: 'art', art_file_id: null, art_tbd_type: 'screen'},
    {id: 201, so_item_id: 21, deco_index: 0, kind: 'art', art_file_id: 'B1'},
  ],
  so_item_pick_lines: [{id: 301, so_item_id: 11, pick_id: 'IF-1', status: 'pulled', sizes: {M: 2}}],
  so_item_po_lines: [{id: 401, so_item_id: 13, po_id: 'PO-9', status: 'waiting', sizes: {L: 1, _billed: {L: 1}}}],
  so_jobs: [
    {id: 'JOB-1', so_id: 'SO-1', created_at: '2026-10-03T00:00:00Z', _version: 4, art_file_id: 'A1'},
    {id: 'JOB-OLD', so_id: 'SO-1', created_at: '2026-01-01T00:00:00Z', _version: 1, art_file_id: 'A9'}, // carry-over
    {id: 'JOB-2', so_id: 'SO-2', created_at: '2026-10-03T00:00:00Z', _version: 1},
  ],
  so_art_files: [
    {id: 'A1', so_id: 'SO-1', name: 'Logo', _version: 5},
    {id: 'A9', so_id: 'SO-1', name: 'Old logo', _version: 1},
    {id: 'B1', so_id: 'SO-2', name: 'Cap logo', _version: 2},
  ],
  so_firm_dates: [{id: 501, so_id: 'SO-1', item_desc: 'Tees', date: '2026-10-20', approved: true}],
};
let failTable = null;
const builder = table => {
  const filters = [];
  let ordered = [];
  let rng = null;
  const run = () => {
    if (table === failTable) return Promise.resolve({data: null, error: {message: 'boom'}, status: 500, count: null});
    let rows = (tables[table] || []).filter(r => filters.every(f => f(r)));
    ordered.slice().reverse().forEach(col => { rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0)); });
    const count = rows.length;
    if (rng) rows = rows.slice(rng[0], rng[1] + 1);
    return Promise.resolve({data: rows, error: null, status: 200, count});
  };
  const b = {
    then: (res, rej) => run().then(res, rej),
    select: () => b, not: () => b, or: () => b, limit: () => b,
    order: col => { ordered.push(col); return b; },
    range: (a, z) => { rng = [a, z]; return b; },
    in: (col, vals) => { filters.push(r => vals.map(String).includes(String(r[col]))); return b; }, // PostgREST compares as text in the URL
    eq: (col, val) => { filters.push(r => r[col] === val); return b; },
    maybeSingle: () => run(), single: () => run(),
  };
  return b;
};
jest.mock('@supabase/supabase-js', () => ({createClient: () => ({
  from: table => builder(table),
  rpc: () => Promise.resolve({data: null, error: null}),
  channel: () => ({on() { return this; }, subscribe() { return this; }}),
  removeChannel: () => {},
  auth: {getSession: async () => ({data: {session: null}}), refreshSession: async () => ({data: {session: null}, error: null}), onAuthStateChange: () => ({data: {subscription: {unsubscribe() {}}}})},
})}));
beforeAll(() => {
  process.env.REACT_APP_SUPABASE_URL = 'https://example.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'anon';
});
afterEach(() => { failTable = null; });
const engine = () => require('../lib/dbEngine');

test('a refreshed order is identical to the full load\'s copy of it', async () => {
  const {_dbLoad, _dbLoadSalesOrdersByIds} = engine();
  const full = await _dbLoad({histInvoices: false});
  const fullSo1 = full.sales_orders.find(s => s.id === 'SO-1');
  const res = await _dbLoadSalesOrdersByIds(['SO-1'], []);
  expect(res.missing).toEqual([]);
  expect(res.sales_orders).toHaveLength(1);
  expect(res.sales_orders[0]).toEqual(fullSo1);
  // sanity: the shared assembly really ran (dedup, decoration order, carry-over filter, flags)
  expect(fullSo1.items).toHaveLength(2);
  expect(fullSo1.items[0].decorations.map(d => d.art_file_id)).toEqual(['A1', 'A2']);
  expect(fullSo1.jobs.map(j => j.id)).toEqual(['JOB-1']);
  expect(fullSo1._itemsHydrated).toBe(true);
  expect(fullSo1._recoveryHydrated).toBe(true);
});

test('a pick-line event resolves to its order', async () => {
  const {_dbLoadSalesOrdersByIds} = engine();
  // ids come out of the live-update queue as text ('soitem:21')
  const res = await _dbLoadSalesOrdersByIds([], ['21']);
  expect(res.sales_orders.map(s => s.id)).toEqual(['SO-2']);
  expect(res.missing).toEqual([]);
});

test('a requested order with no row is reported missing (deletion goes to the full reload)', async () => {
  const {_dbLoadSalesOrdersByIds} = engine();
  const res = await _dbLoadSalesOrdersByIds(['SO-1', 'SO-GONE'], []);
  expect(res.missing).toEqual(['SO-GONE']);
  expect(res.sales_orders.map(s => s.id)).toEqual(['SO-1']);
});

test('any failed read returns null so the caller falls back to the full reload', async () => {
  const {_dbLoadSalesOrdersByIds} = engine();
  failTable = 'so_item_po_lines';
  await expect(_dbLoadSalesOrdersByIds(['SO-1'], [])).resolves.toBeNull();
});

test('many pick-line events from one order count as one order, not many', async () => {
  const {_dbLoadSalesOrdersByIds} = engine();
  const res = await _dbLoadSalesOrdersByIds(['SO-1'], ['11', '12', '13'], {maxOrders: 1});
  expect(res.tooMany).toBeUndefined();
  expect(res.sales_orders.map(s => s.id)).toEqual(['SO-1']);
  const two = await _dbLoadSalesOrdersByIds(['SO-1'], ['21'], {maxOrders: 1});
  expect(two.tooMany).toBe(true);
});
