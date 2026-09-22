/**
 * Merge Jobs must merge exactly the jobs the rep ticked (SO-1661).
 *
 * JOB-1661-01 had been split by SKU twice, leaving -B and -B2 alongside it. The rep ticked
 * JOB-1661-01 and JOB-1661-01-B; the old "auto-absorb every split child of the selection" step
 * pulled -B2 in too, because -B2's split_from pointed at the TARGET — which survives the merge
 * and orphans nothing. Toast read "Merged 3 jobs".
 */
import { planJobMerge } from '../lib/splitJobItems';

const J = (id, extra = {}) => ({ id, items: [], ...extra });

describe('planJobMerge', () => {
  // JOB-1661-01 (target) + its two by-SKU slices.
  const so1661 = [
    J('JOB-1661-01'),
    J('JOB-1661-01-B', { split_from: 'JOB-1661-01' }),
    J('JOB-1661-01-B2', { split_from: 'JOB-1661-01' }),
  ];

  test('a 2-job merge touches 2 jobs — the target\'s other slice is left alone', () => {
    const p = planJobMerge(so1661, [0, 1]);
    expect(p.target.id).toBe('JOB-1661-01');
    expect(p.mergeIdxs).toEqual([1]);
    expect([...p.removeIdxs]).toEqual([1]);
    expect(p.mergeIdxs.length + 1).toBe(2); // what the toast counts
  });

  test("slices of the target keep their parent — it survives under its own id", () => {
    const p = planJobMerge(so1661, [0, 1]);
    expect(p.reparentIds.has('JOB-1661-01')).toBe(false);
    // -B2 still points at a job that exists, so nothing to rewrite.
    expect([...p.reparentIds]).toEqual(['JOB-1661-01-B']);
  });

  test('a surviving slice keeps the merged job priced as its own press run', () => {
    expect(planJobMerge(so1661, [0, 1]).keepSeparate).toBe(true);
    // Merge all three and nothing is left pointing at the target.
    expect(planJobMerge(so1661, [0, 1, 2]).keepSeparate).toBe(false);
  });

  test('a slice of a merged-AWAY job is re-parented, not swallowed', () => {
    const jobs = [
      J('JOB-A'),
      J('JOB-B'),
      J('JOB-B-S', { split_from: 'JOB-B' }), // backorder carved off B
    ];
    const p = planJobMerge(jobs, [0, 1]);
    expect(p.mergeIdxs).toEqual([1]);          // only B's items join A
    expect(p.removeIdxs.has(2)).toBe(false);   // B-S survives
    expect(p.reparentIds.has('JOB-B')).toBe(true); // …pointing at A from now on
    expect(p.keepSeparate).toBe(true);
  });

  test('the lowest-indexed selection is the target whatever order it was ticked in', () => {
    const jobs = [J('JOB-A'), J('JOB-B'), J('JOB-C')];
    const p = planJobMerge(jobs, [2, 0]);
    expect(p.target.id).toBe('JOB-A');
    expect(p.targetIdx).toBe(0);
    expect(p.mergeIdxs).toEqual([2]);
  });

  test('duplicate, missing and empty selections never merge a job twice', () => {
    const jobs = [J('JOB-A'), J('JOB-B')];
    expect(planJobMerge(jobs, [0, 1, 1]).mergeIdxs).toEqual([1]);
    expect(planJobMerge(jobs, [0, 7]).mergeIdxs).toEqual([]);
    expect(planJobMerge(jobs, []).target).toBe(null);
    expect(planJobMerge(null, [0]).target).toBe(null);
  });
});
