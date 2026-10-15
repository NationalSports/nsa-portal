// SO-1518 (2026-10-14, flaky airplane wifi): a slow load's so_items request failed, then a second
// load started before the first finished. Every _dbLoad used to clear one module-wide "untrusted
// tables" set on start, wiping the first load's failure mark — so it assembled orders with
// items:[] flagged _itemsHydrated:true. Each load must judge hydration from its OWN results.
const pending = {};
let failItems = true;
const respond = table => {
  if (table === 'so_items' && failItems) return Promise.resolve({data: null, error: {message: 'JWT expired', code: 'PGRST301'}, status: 401, count: null});
  if (table === 'messages' && pending.hold) return pending.hold.then(() => ({data: [], error: null, status: 200, count: 0}));
  const data = table === 'sales_orders' ? [{id: 'SO-1', customer_id: 'C-1', _version: 3}] : [];
  return Promise.resolve({data, error: null, status: 200, count: data.length});
};
const builder = table => {
  const b = {then: (res, rej) => respond(table).then(res, rej)};
  ['select', 'order', 'range', 'not', 'or', 'in', 'eq', 'neq', 'is', 'gte', 'lte', 'limit', 'filter', 'match'].forEach(m => { b[m] = () => b; });
  b.maybeSingle = () => respond(table); b.single = () => respond(table);
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

test('a load that overlaps another keeps its own failed-table marks', async () => {
  const {_dbLoad} = require('../lib/dbEngine');
  let release; pending.hold = new Promise(r => { release = r; });
  const slow = _dbLoad({histInvoices: false});
  await new Promise(r => setTimeout(r, 50)); // so_items has already failed; slow load still waiting on messages
  failItems = false;
  await _dbLoad({only: new Set(['customers'])}); // overlapping reload starts (and used to clear the marks)
  release();
  const d = await slow;
  const so = d.sales_orders.find(s => s.id === 'SO-1');
  expect(so.items).toEqual([]);
  expect(so._itemsHydrated).toBe(false);
  expect(so._recoveryHydrated).toBe(false);
});
