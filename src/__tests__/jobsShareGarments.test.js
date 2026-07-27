/**
 * jobsShareGarments — do two jobs decorate any of the same physical garments?
 *
 * Sharing an item_idx is not enough: an art split partitions one SO line's units
 * between designs (each job's item entry carries _artSplit + the family split_group),
 * so same-family slices are disjoint garment batches. They must NOT read as
 * "siblings on the same garments" — that coupling drove the Multi-job-item banner,
 * the ready-to-ship gate, and the "Still needs: X before shipping" warning to treat
 * independent split designs as one unit.
 */
const { jobsShareGarments } = require('../safeHelpers');

const job = (id, items) => ({ id, items });

describe('jobsShareGarments', () => {
  test('two jobs on the same line (multi-position decoration) share garments', () => {
    const a = job('JOB-1-01', [{ item_idx: 0 }]);
    const b = job('JOB-1-02', [{ item_idx: 0 }]);
    expect(jobsShareGarments(a, b)).toBe(true);
  });

  test('art-split slices of the same family are disjoint — not shared', () => {
    const a = job('JOB-1-01', [{ item_idx: 0, _artSplit: true, split_group: 'sg1' }]);
    const b = job('JOB-1-02', [{ item_idx: 0, _artSplit: true, split_group: 'sg1' }]);
    expect(jobsShareGarments(a, b)).toBe(false);
    expect(jobsShareGarments(b, a)).toBe(false);
  });

  test('slices from DIFFERENT split families can overlap — still shared', () => {
    const a = job('JOB-1-01', [{ item_idx: 0, _artSplit: true, split_group: 'sg1' }]);
    const b = job('JOB-1-02', [{ item_idx: 0, _artSplit: true, split_group: 'sg2' }]);
    expect(jobsShareGarments(a, b)).toBe(true);
  });

  test('a whole-line job (e.g. numbers) overlaps an art-split slice — shared', () => {
    const a = job('JOB-1-01', [{ item_idx: 0, _artSplit: true, split_group: 'sg1' }]);
    const b = job('JOB-1-02', [{ item_idx: 0 }]);
    expect(jobsShareGarments(a, b)).toBe(true);
    expect(jobsShareGarments(b, a)).toBe(true);
  });

  test('one shared non-split line is enough, even when other lines are disjoint slices', () => {
    const a = job('JOB-1-01', [
      { item_idx: 0, _artSplit: true, split_group: 'sg1' },
      { item_idx: 1 },
    ]);
    const b = job('JOB-1-02', [
      { item_idx: 0, _artSplit: true, split_group: 'sg1' },
      { item_idx: 1 },
    ]);
    expect(jobsShareGarments(a, b)).toBe(true);
  });

  test('no shared item_idx — not shared', () => {
    const a = job('JOB-1-01', [{ item_idx: 0 }]);
    const b = job('JOB-1-02', [{ item_idx: 1 }]);
    expect(jobsShareGarments(a, b)).toBe(false);
  });

  test('tolerates missing/garbage jobs and items', () => {
    expect(jobsShareGarments(null, null)).toBe(false);
    expect(jobsShareGarments({}, job('J', [{ item_idx: 0 }]))).toBe(false);
    expect(jobsShareGarments(job('J', [null, { item_idx: null }]), job('K', [{ item_idx: 0 }]))).toBe(false);
  });

  test('split slices missing split_group fall back to shared (no silent unlink)', () => {
    const a = job('JOB-1-01', [{ item_idx: 0, _artSplit: true }]);
    const b = job('JOB-1-02', [{ item_idx: 0, _artSplit: true }]);
    expect(jobsShareGarments(a, b)).toBe(true);
  });
});
