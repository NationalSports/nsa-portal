/**
 * A split parent's frozen per-size share must track units removed from the line (SO-1480).
 *
 * JOB-1480-01 was split (JOB-1480-01-B carved off the JM5228 polo), which stamped a per-item
 * `sizes` override on the parent. The rep later dropped the 5th 3XL from the KD2999 line AND
 * from its PO, but the override was copied forward verbatim on every sync — so the Jobs tab
 * kept reading 54/55 (3XL 4/5) against what was now a 54-piece order, and the design kept
 * billing at the 50-pc tier.
 */
import { splitSliceOwnedSizes, clampSplitOverrideSizes, SLICE_PRUNE_STATUSES } from '../lib/syncJobsMatch';

describe('splitSliceOwnedSizes', () => {
  const jobs = [
    { id: 'JOB-1-01', items: [{ item_idx: 0, sku: 'KD2999', sizes: { M: 4, '3XL': 5 } }] },
    { id: 'JOB-1-01-B', split_from: 'JOB-1-01', items: [{ item_idx: 0, sku: 'KD2999', sizes: { M: 2 } }] },
    { id: 'JOB-1-01-B-B', split_from: 'JOB-1-01-B', items: [{ item_idx: 0, sku: 'KD2999', sizes: { M: 1, '3XL': 2 } }] },
  ];

  test('sums per-size shares across the whole descendant chain, not just direct children', () => {
    expect(splitSliceOwnedSizes(jobs, 'JOB-1-01')).toEqual(new Map([['0-KD2999', { M: 3, '3XL': 2 }]]));
  });

  test('a slice owning the row with no per-size map reports null — nothing to subtract', () => {
    const noSizes = [jobs[0], { id: 'JOB-1-01-B', split_from: 'JOB-1-01', items: [{ item_idx: 0, sku: 'KD2999' }] }];
    expect(splitSliceOwnedSizes(noSizes, 'JOB-1-01').get('0-KD2999')).toBeNull();
  });

  test('excluded slices still link the family walk', () => {
    const excl = [
      jobs[0],
      { id: 'JOB-1-01-B', split_from: 'JOB-1-01', _merged: true, items: [{ item_idx: 0, sku: 'KD2999', sizes: { M: 2 } }] },
      jobs[2],
    ];
    // The merged slice's own 2 M are excluded; its child's share still counts.
    expect(splitSliceOwnedSizes(excl, 'JOB-1-01', (sj) => sj._merged)).toEqual(new Map([['0-KD2999', { M: 1, '3XL': 2 }]]));
  });

  test('no parent id / no slices → empty', () => {
    expect(splitSliceOwnedSizes(jobs, null).size).toBe(0);
    expect(splitSliceOwnedSizes([jobs[0]], 'JOB-1-01').size).toBe(0);
  });
});

describe('clampSplitOverrideSizes', () => {
  // The real SO-1480 row: the slice took a different garment, so nothing is slice-owned here.
  const ex = { S: 6, M: 4, L: 12, XL: 9, '2XL': 13, '3XL': 5, '4XL': 1 };
  const ful = { S: 6, M: 4, L: 12, XL: 9, '2XL': 13, '3XL': 4, '4XL': 1 };
  const live = { S: 6, M: 4, L: 12, XL: 9, '2XL': 13, '3XL': 4, '4XL': 1 };

  test('SO-1480: the removed 3XL comes off the job, taking it to 49', () => {
    const out = clampSplitOverrideSizes(ex, ful, live, {});
    expect(out['3XL']).toBe(4);
    expect(Object.values(out).reduce((a, v) => a + v, 0)).toBe(49);
  });

  test('subtracts what the slices own before clamping', () => {
    // Line has 10 M, the slice took 4 → the parent's share is 6 even though it froze 8.
    expect(clampSplitOverrideSizes({ M: 8 }, {}, { M: 10 }, { M: 4 })).toEqual({ M: 6 });
  });

  test('never inflates — added units are the auto-builder / auto-split call, not this one', () => {
    expect(clampSplitOverrideSizes({ M: 4 }, {}, { M: 12 }, {})).toEqual({ M: 4 });
  });

  test('a size already pulled or received holds at its received count', () => {
    // 5 M received, then the rep removes 2 from the line: the 5 in hand stay on the sheet.
    expect(clampSplitOverrideSizes({ M: 6 }, { M: 5 }, { M: 4 }, {})).toEqual({ M: 5 });
  });

  test('a size removed outright drops to 0 when none were received', () => {
    expect(clampSplitOverrideSizes({ M: 4, L: 2 }, {}, { M: 4 }, {})).toEqual({ M: 4, L: 0 });
  });

  test('a deleted line (null live sizes) keeps the frozen snapshot', () => {
    expect(clampSplitOverrideSizes(ex, ful, null, {})).toEqual(ex);
  });

  test('a whole-row slice owner (null) leaves the override untouched', () => {
    expect(clampSplitOverrideSizes({ M: 8 }, {}, { M: 10 }, null)).toEqual({ M: 8 });
  });

  test('a slice owning more than the line still floors at 0, never negative', () => {
    expect(clampSplitOverrideSizes({ M: 4 }, {}, { M: 2 }, { M: 6 })).toEqual({ M: 0 });
  });
});

describe('the clamp is a fixed point', () => {
  // syncJobs is a fixed point over its own output — the auto-sync effect re-runs it on every
  // change and re-fires whenever per-item units move. A clamp that oscillated would loop
  // forever, so re-feeding a clamped map must be a no-op.
  test.each([
    ['SO-1480', { '3XL': 5, M: 4 }, { '3XL': 4, M: 4 }, { '3XL': 4, M: 4 }, {}],
    ['sibling share', { M: 8 }, {}, { M: 10 }, { M: 4 }],
    ['received exceeds the line', { M: 6 }, { M: 5 }, { M: 4 }, {}],
    ['slices claim more than the line', { M: 4 }, {}, { M: 2 }, { M: 6 }],
    ['size removed outright', { M: 4, L: 2 }, {}, { M: 4 }, {}],
  ])('%s', (_label, ex, ful, live, own) => {
    const once = clampSplitOverrideSizes(ex, ful, live, own);
    const twice = clampSplitOverrideSizes(once, ful, live, own);
    expect(twice).toEqual(once);
    expect(clampSplitOverrideSizes(twice, ful, live, own)).toEqual(once);
  });
});

describe('re-shape gate', () => {
  test('only pre-floor jobs re-clamp; an in-process or finished run keeps its committed count', () => {
    ['', 'draft', 'hold', 'ready'].forEach((st) => expect(SLICE_PRUNE_STATUSES.has(st)).toBe(true));
    ['staging', 'in_process', 'complete', 'shipped'].forEach((st) => expect(SLICE_PRUNE_STATUSES.has(st)).toBe(false));
  });
});
