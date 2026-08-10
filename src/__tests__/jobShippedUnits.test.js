/**
 * jobShippedUnits / shippedSizesByLine — how many of a job's units have shipped?
 *
 * Crediting a job with its line's whole sku|color shipped total over-credits art-split
 * slices: sibling designs partition one SO line, so design A's shipped box used to flip
 * design B to prod_status 'shipped' while B's actual garments sat unshipped — B then
 * vanished from the warehouse's ready-to-ship queues and the order looked invoiceable.
 * Slices count only their own per-size share; whole-line jobs keep the full-line count.
 */
const { jobShippedUnits, jobShippedSizes, shippedSizesByLine } = require('../safeHelpers');

const ship = (items) => ({ id: 'SHP', items });
const job = (id, items, total) => ({ id, items, total_units: total });

describe('shippedSizesByLine', () => {
  test('aggregates per size across boxes and shipments', () => {
    const m = shippedSizesByLine([
      ship([{ sku: 'PA100', color: 'Navy', sizes: { S: 4, M: 6 } }]),
      ship([{ sku: 'PA100', color: 'Navy', sizes: { M: 2, L: 8 } }, { sku: 'PA100', color: 'White', sizes: { S: 3 } }]),
    ]);
    expect(m['PA100|Navy']).toEqual({ S: 4, M: 8, L: 8 });
    expect(m['PA100|White']).toEqual({ S: 3 });
  });

  test('tolerates missing/garbage shipments and items', () => {
    expect(shippedSizesByLine(null)).toEqual({});
    expect(shippedSizesByLine([null, {}, ship([null, { sku: 'X' }])])).toEqual({ 'X|': {} });
  });
});

describe('jobShippedUnits', () => {
  const shippedSM = shippedSizesByLine([ship([{ sku: 'PA100', color: 'Navy', sizes: { S: 10, M: 7 } }])]);

  test('whole-line job counts the full line (pre-split behavior)', () => {
    const a = job('JOB-1', [{ item_idx: 0, sku: 'PA100', color: 'Navy' }], 17);
    expect(jobShippedUnits(a, [a], shippedSM)).toBe(17);
  });

  test("split slices count only their own sizes — sibling's box doesn't cover this design", () => {
    // Design A owns S/M (17 units), design B owns L/XL (12). A's box ships all of S/M.
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 10, M: 7 } }], 17);
    const b = job('JOB-B', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { L: 8, XL: 4 } }], 12);
    const all = [a, b];
    expect(jobShippedUnits(a, all, shippedSM)).toBe(17); // fully shipped
    // The bug this fixes: 17 shipped >= B's 12 total used to flip B to 'shipped'.
    expect(jobShippedUnits(b, all, shippedSM)).toBe(0); // B's garments never shipped
  });

  test('slice share is capped at its own size quantities', () => {
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 6 } }], 6);
    expect(jobShippedUnits(a, [a], shippedSM)).toBe(6); // 10 S shipped, share is 6
  });

  test('same-size quantity split apportions in job order (earlier job claims first)', () => {
    // Family splits 10 M as 6 (A) / 4 (B); only 6 M have shipped so far.
    const shipped = shippedSizesByLine([ship([{ sku: 'PA100', color: 'Navy', sizes: { M: 6 } }])]);
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { M: 6 } }], 6);
    const b = job('JOB-B', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { M: 4 } }], 4);
    const all = [a, b];
    expect(jobShippedUnits(a, all, shipped)).toBe(6);
    expect(jobShippedUnits(b, all, shipped)).toBe(0); // A claimed the 6 shipped M first
    const shippedAll = shippedSizesByLine([ship([{ sku: 'PA100', color: 'Navy', sizes: { M: 10 } }])]);
    expect(jobShippedUnits(b, all, shippedAll)).toBe(4); // rest of the line shipped → B covered
  });

  test('whole-line numbers job over a split line still counts the full line', () => {
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 10, M: 7 } }], 17);
    const nums = job('JOB-N', [{ item_idx: 0, sku: 'PA100', color: 'Navy' }], 29);
    expect(jobShippedUnits(nums, [a, nums], shippedSM)).toBe(17);
  });

  test('multi-line job sums whole lines and slices independently', () => {
    const shipped = shippedSizesByLine([ship([
      { sku: 'PA100', color: 'Navy', sizes: { S: 5 } },
      { sku: 'TS200', color: 'White', sizes: { M: 3 } },
    ])]);
    const a = job('JOB-A', [
      { item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 5 } },
      { item_idx: 1, sku: 'TS200', color: 'White' },
    ], 8);
    expect(jobShippedUnits(a, [a], shipped)).toBe(8);
  });

  test('tolerates missing/garbage jobs, items, and maps', () => {
    expect(jobShippedUnits(null, null, null)).toBe(0);
    expect(jobShippedUnits({}, [], {})).toBe(0);
    expect(jobShippedUnits(job('J', [null, { sku: 'X' }], 5), [job('J', [], 5)], { 'X|': { M: 2 } })).toBe(2);
  });
});

// Per-size resolution — what the warehouse's per-job Ready-to-Ship rows subtract. Same
// apportioning as jobShippedUnits (which is its sum), keyed by the job's items[] index.
describe('jobShippedSizes', () => {
  const shippedSM = shippedSizesByLine([ship([{ sku: 'PA100', color: 'Navy', sizes: { S: 10, M: 7 } }])]);

  test('whole-line job item takes the whole line per size', () => {
    const a = job('JOB-1', [{ item_idx: 0, sku: 'PA100', color: 'Navy' }], 17);
    expect(jobShippedSizes(a, [a], shippedSM)).toEqual({ 0: { S: 10, M: 7 } });
  });

  test("split slice takes only its own sizes — sibling design's box stays out of its row", () => {
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 10, M: 7 } }], 17);
    const b = job('JOB-B', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { L: 8, XL: 4 } }], 12);
    expect(jobShippedSizes(a, [a, b], shippedSM)).toEqual({ 0: { S: 10, M: 7 } });
    expect(jobShippedSizes(b, [a, b], shippedSM)).toEqual({ 0: { L: 0, XL: 0 } });
  });

  test('same-size quantity split apportions in job order', () => {
    const shipped = shippedSizesByLine([ship([{ sku: 'PA100', color: 'Navy', sizes: { M: 6 } }])]);
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { M: 6 } }], 6);
    const b = job('JOB-B', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { M: 4 } }], 4);
    expect(jobShippedSizes(a, [a, b], shipped)).toEqual({ 0: { M: 6 } });
    expect(jobShippedSizes(b, [a, b], shipped)).toEqual({ 0: { M: 0 } });
  });

  test('rows are keyed by items[] index, including a multi-line job', () => {
    const shipped = shippedSizesByLine([ship([
      { sku: 'PA100', color: 'Navy', sizes: { S: 5 } },
      { sku: 'TS200', color: 'White', sizes: { M: 3 } },
    ])]);
    const a = job('JOB-A', [
      { item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 5 } },
      { item_idx: 1, sku: 'TS200', color: 'White' },
    ], 8);
    expect(jobShippedSizes(a, [a], shipped)).toEqual({ 0: { S: 5 }, 1: { M: 3 } });
  });

  test('nothing shipped for a line leaves that row out entirely', () => {
    const a = job('JOB-A', [{ item_idx: 0, sku: 'ZZ999', color: 'Red' }], 4);
    expect(jobShippedSizes(a, [a], shippedSM)).toEqual({});
  });

  test('jobShippedUnits is exactly the sum of this map', () => {
    const a = job('JOB-A', [{ item_idx: 0, sku: 'PA100', color: 'Navy', split_group: 'sg1', sizes: { S: 6 } }], 6);
    const sizes = jobShippedSizes(a, [a], shippedSM);
    const sum = Object.values(sizes).reduce((t, row) => t + Object.values(row).reduce((s, v) => s + v, 0), 0);
    expect(jobShippedUnits(a, [a], shippedSM)).toBe(sum);
  });
});
