/**
 * Custom split — which units the new slice claims (JOB-2130-05).
 *
 * A rep custom-split the 4 M that were on backorder; the slice was handed 4 RECEIVED M and the
 * parent kept the open ones. Default is now backorder-first; "received" is an explicit choice.
 */
import { allocateCustomSplit, openSizes, freeSplitSuffix } from '../lib/splitJobItems';

describe('allocateCustomSplit', () => {
  // JOB-2130-05: 14 M on the job, 10 received, 4 still on order. Rep splits 4 M.
  const sizes = { S: 6, M: 14 };
  const ful = { M: 10 };

  test("default 'open' take: the slice gets the 4 backordered M, parent keeps its 10 received", () => {
    const r = allocateCustomSplit(sizes, ful, { M: 4 });
    expect(r.splitSizes).toEqual({ M: 4 });
    expect(r.splitFulSizes).toEqual({});
    expect(r.sFul).toBe(0);
    expect(r.remainSizes).toEqual({ S: 6, M: 10 });
    expect(r.remainFulSizes).toEqual({ M: 10 });
    expect(r.rFul).toBe(10);
    expect(r.sUnits + r.rUnits).toBe(20);
  });

  test("'received' take: the slice gets in-hand units so it can run now", () => {
    const r = allocateCustomSplit(sizes, ful, { M: 4 }, 'received');
    expect(r.splitSizes).toEqual({ M: 4 });
    expect(r.splitFulSizes).toEqual({ M: 4 });
    expect(r.remainFulSizes).toEqual({ M: 6 });
    expect(r.sFul + r.rFul).toBe(10);
  });

  test("'open' take carries receipts only when more units are requested than are open", () => {
    // 4 open, rep asks for 6 → 4 open + 2 received move; parent keeps the other 8 received.
    const r = allocateCustomSplit(sizes, ful, { M: 6 });
    expect(r.splitSizes).toEqual({ M: 6 });
    expect(r.splitFulSizes).toEqual({ M: 2 });
    expect(r.remainSizes).toEqual({ S: 6, M: 8 });
    expect(r.remainFulSizes).toEqual({ M: 8 });
  });

  test('receipts never exceed either half, and nothing is lost', () => {
    const cases = [
      [{ L: 10 }, { L: 10 }, { L: 3 }],   // fully received, split 3
      [{ L: 10 }, { L: 0 }, { L: 3 }],    // nothing received
      [{ L: 10 }, { L: 12 }, { L: 10 }],  // over-received pool (capped), split everything
      [{ L: 10 }, { L: 4 }, { L: 40 }],   // request beyond the line (capped)
    ];
    ['open', 'received'].forEach((take) => cases.forEach(([s, f, q]) => {
      const r = allocateCustomSplit(s, f, q, take);
      const tot = Object.values(s).reduce((a, v) => a + v, 0);
      expect(r.sUnits + r.rUnits).toBe(tot);
      expect(r.sFul).toBeLessThanOrEqual(r.sUnits);
      expect(r.rFul).toBeLessThanOrEqual(r.rUnits);
      expect(r.sFul + r.rFul).toBe(Math.min(f.L, s.L));
    }));
  });

  test('unrequested sizes stay whole on the parent with their receipts', () => {
    const r = allocateCustomSplit({ S: 5, M: 5 }, { S: 2, M: 5 }, { M: 5 });
    expect(r.splitSizes).toEqual({ M: 5 });
    expect(r.splitFulSizes).toEqual({ M: 5 }); // all 5 M were received — nothing open to take first
    expect(r.remainSizes).toEqual({ S: 5 });
    expect(r.remainFulSizes).toEqual({ S: 2 });
  });
});

describe('openSizes', () => {
  test('sizes minus receipts, dropping fully received sizes', () => {
    expect(openSizes({ S: 6, M: 14, L: 3 }, { S: 6, M: 10 })).toEqual({ M: 4, L: 3 });
  });
});

describe('freeSplitSuffix', () => {
  const jobs = [
    { id: 'JOB-1-05' }, { id: 'JOB-1-05-C2' }, { id: 'JOB-1-05-S' }, { id: 'JOB-1-05-B' },
  ];
  test('custom slices are numbered from C1 and skip ids still in use', () => {
    expect(freeSplitSuffix(jobs, 'JOB-1-05', 'C', true)).toBe('C1');
    expect(freeSplitSuffix([...jobs, { id: 'JOB-1-05-C1' }], 'JOB-1-05', 'C', true)).toBe('C3');
  });
  test('backorder / by-SKU slices start unnumbered, then B2 / S2', () => {
    expect(freeSplitSuffix(jobs, 'JOB-1-05', 'S')).toBe('S2');
    expect(freeSplitSuffix(jobs, 'JOB-1-05', 'B')).toBe('B2');
    expect(freeSplitSuffix([], 'JOB-1-05', 'B')).toBe('B');
  });
  test('a slice merged back frees its id without colliding with a surviving sibling', () => {
    // C1 merged back, C2 still live: a count-based "-C" + (n+1) would mint C2 again.
    const after = [{ id: 'JOB-1-05' }, { id: 'JOB-1-05-C2', split_from: 'JOB-1-05' }];
    expect(freeSplitSuffix(after, 'JOB-1-05', 'C', true)).toBe('C1');
  });
});
