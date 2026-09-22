/* _safeQuery's paged-fetch wave loop (src/lib/dbEngine.js).
 *
 * The pager fires pages in parallel WAVES once page 0 comes back full. It used to fire a fixed
 * wave of 5 regardless of how many rows existed, so a 1373-row table spent 6 requests to fill 2
 * and the last 4 came back empty — 30% of all portal requests measured on 2026-09-09.
 *
 * Each wave is now capped by the row count PostgREST reports on page 0. That count may only ever
 * SHRINK a wave: a short page is still the sole stop condition, so a stale/low estimate costs an
 * extra (smaller) wave but can NEVER truncate a load. These tests pin both halves of that, plus
 * the two boundaries that would otherwise hang or silently drop rows:
 *   - an exact page-size multiple (wave arithmetic reaches 0 — must clamp to 1, or the loop spins
 *     forever on an empty `starts` array),
 *   - a count PostgREST declines to compute (`Content-Range: 0-999/*` → parseInt('*') → NaN,
 *     which is `typeof 'number'` and so only the `> 0` guard rejects it).
 */

// Serves `rowCount` rows for one table with real PostgREST range semantics, reports a row count
// on whichever page asks for one, and records every .range() call.
jest.mock('@supabase/supabase-js', () => {
  const state = { table: null, rowCount: 0, reportedCount: undefined, ranges: [], served: 0, pageSize: 1000 };
  const makeBuilder = (table) => {
    let wantsCount = false;
    const builder = {
      select: (_cols, opts) => { wantsCount = !!(opts && opts.count); return builder; },
      not: () => builder, or: () => builder, order: () => builder, eq: () => builder, in: () => builder,
      range: (from, to) => {
        if (table !== state.table) return Promise.resolve({ data: [], error: null, status: 200 });
        state.ranges.push(from);
        const rows = [];
        for (let i = from; i <= Math.min(to, state.rowCount - 1); i++) rows.push({ id: i });
        state.served += rows.length;
        const res = { data: rows, error: null, status: 200 };
        // PostgREST only puts a count in Content-Range when the request asked for one.
        if (wantsCount) res.count = state.reportedCount;
        return Promise.resolve(res);
      },
    };
    return builder;
  };
  const client = {
    from: (t) => makeBuilder(t),
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
  return { createClient: () => client, __pagerState: state };
});

const ORIG_ENV = { ...process.env };

// Loads one table through the real _dbLoad → _safeQuery path and reports what the pager did.
const runPager = async ({ rowCount, reportedCount }) => {
  process.env.REACT_APP_SUPABASE_URL = 'https://pager-test.supabase.co';
  process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
  jest.resetModules();
  const { __pagerState } = require('@supabase/supabase-js');
  Object.assign(__pagerState, { table: 'sales_orders', rowCount, reportedCount, ranges: [], served: 0 });
  const { _dbLoad } = require('../lib/dbEngine');
  await _dbLoad({ only: new Set(['sales_orders']) });
  // `served` is the ground truth for "did the pager read every row" — independent of how
  // _dbLoad reshapes the result downstream.
  return { served: __pagerState.served, ranges: __pagerState.ranges };
};

afterEach(() => { process.env = { ...ORIG_ENV }; });

describe('_safeQuery paged fetch — wave sizing', () => {
  test('a 1373-row table stops at the 2 pages that hold rows (was 6)', async () => {
    const { ranges } = await runPager({ rowCount: 1373, reportedCount: 1373 });
    expect(ranges).toEqual([0, 1000]);
  });

  test('an exact page-size multiple terminates and loads every row', async () => {
    // 2000 rows: page 1 comes back FULL, so the short-page stop never fires until offset 2000.
    // Wave arithmetic hits 0 here — without the clamp to 1 the loop would spin on empty waves.
    const { served, ranges } = await runPager({ rowCount: 2000, reportedCount: 2000 });
    expect(served).toBe(2000);
    expect(ranges).toEqual([0, 1000, 2000]);
  });

  test('a stale LOW count never truncates — every row still loads', async () => {
    // Server really has 6403 rows but reports 2000 (autoanalyze lag / bulk insert).
    const { served } = await runPager({ rowCount: 6403, reportedCount: 2000 });
    expect(served).toBe(6403);
  });

  test('a stale HIGH count loads every row and never over-fetches past the data', async () => {
    const { served, ranges } = await runPager({ rowCount: 1373, reportedCount: 61836 });
    expect(served).toBe(1373);
    expect(Math.max(...ranges)).toBeLessThanOrEqual(5000); // old fixed-wave ceiling, not beyond
  });

  test('no count (Content-Range "*" → NaN) falls back to the old fixed wave, intact', async () => {
    const { served, ranges } = await runPager({ rowCount: 6403, reportedCount: NaN });
    expect(served).toBe(6403);
    // Byte-identical to the pre-change pager, waste included: the second wave fires 6000-10000
    // before the short page at 6000 is read, so 11 requests fetch 7 pages of rows. That is the
    // fallback working as intended — correctness first, and the count is what removes the waste.
    expect(ranges).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]);
    // Same table WITH a truthful count needs only the 7 pages that hold rows.
    const withCount = await runPager({ rowCount: 6403, reportedCount: 6403 });
    expect(withCount.served).toBe(6403);
    expect(withCount.ranges).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
  });

  test('an absent count behaves identically to the pre-change pager', async () => {
    const { served } = await runPager({ rowCount: 2500, reportedCount: undefined });
    expect(served).toBe(2500);
  });
});
