/* fetchOrderItemRows (src/Webstores.js).
 *
 * PostgREST caps every response at 1000 ROWS no matter how few ids are in the
 * .in() filter, so chunking order ids alone still silently truncated: a
 * 300-order chunk averaging >3.3 line items came back clipped and orders showed
 * "0 items" / missing lines — the exact bug the chunking was meant to fix. Each
 * chunk must therefore also be paged with .range() until a short page.
 */
const { fetchOrderItemRows } = require('../Webstores');

// Fake Supabase client: serves rows for the requested order ids, capping each
// response at `serverCap` rows (PostgREST behavior).
const mkDb = (rowsByOrder, serverCap = 1000) => {
  const calls = [];
  return {
    calls,
    from: () => ({
      select: () => ({
        in: (_col, ids) => ({
          order: () => ({
            range: async (from, to) => {
              const all = ids.flatMap((id) => rowsByOrder[id] || []);
              calls.push({ ids: ids.length, from, to });
              return { data: all.slice(from, Math.min(to + 1, from + serverCap)), error: null };
            },
          }),
        }),
      }),
    }),
  };
};

const mkRows = (orders, itemsPer) => {
  const byOrder = {};
  let n = 0;
  for (let o = 0; o < orders; o++) byOrder['o' + o] = Array.from({ length: itemsPer }, () => ({ id: 'it' + n++, order_id: 'o' + o }));
  return byOrder;
};

test('returns every row when a 300-order chunk exceeds the 1000-row cap', async () => {
  // 300 orders x 4 items = 1200 rows in the first chunk — the old single query
  // per chunk came back with 1000 and silently dropped 200.
  const byOrder = mkRows(350, 4);
  const db = mkDb(byOrder);
  const { rows, error } = await fetchOrderItemRows(db, Object.keys(byOrder));
  expect(error).toBeNull();
  expect(rows.length).toBe(350 * 4);
  expect(new Set(rows.map((r) => r.id)).size).toBe(350 * 4);
});

test('pages within a chunk until a short page', async () => {
  const byOrder = mkRows(10, 25); // 250 rows, one chunk
  const db = mkDb(byOrder, 100);
  const { rows } = await fetchOrderItemRows(db, Object.keys(byOrder), 100);
  expect(rows.length).toBe(250);
  // 3 pages: 100 + 100 + 50 (short page ends the loop).
  expect(db.calls.map((c) => c.from)).toEqual([0, 100, 200]);
});

test('dedupes ids and skips falsy ids', async () => {
  const byOrder = mkRows(3, 2);
  const db = mkDb(byOrder);
  const { rows } = await fetchOrderItemRows(db, ['o0', 'o0', null, 'o1', 'o2', undefined]);
  expect(rows.length).toBe(6);
});

test('surfaces errors with the rows gathered so far', async () => {
  const boom = { message: 'permission denied' };
  const db = { from: () => ({ select: () => ({ in: () => ({ order: () => ({ range: async () => ({ data: null, error: boom }) }) }) }) }) };
  const { rows, error } = await fetchOrderItemRows(db, ['o1']);
  expect(error).toBe(boom);
  expect(rows).toEqual([]);
});
