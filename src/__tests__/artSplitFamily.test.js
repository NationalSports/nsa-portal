/**
 * Split families on the art board — one artwork, one card, one set of art actions.
 *
 * A split partitions ONE decoration's units across a parent and its slices, and every slice keeps
 * the parent's artwork. The art dashboard used to render each slice as its own card, so a single
 * design read as two jobs to draw and two approvals to chase (SO-1462: JOB-1462-01 and
 * JOB-1462-01-S sat side by side in Waiting for Art with the identical Sunbird FPU Stunt logo).
 *
 * Also covers the split-family receipt apportioning that made the two jobs' size breakdowns look
 * shuffled — see isOpenSplitSlice in businessLogic.
 */
const {
  jobArtKey, splitFamilyRoot, artFamilyKey, consolidateArtFamilies, artFamilyIds, artFamilyIdsIn,
} = require('../lib/artSplitFamily');
const { allocateJobFulfillment, isOpenSplitSlice } = require('../businessLogic');

const RANK = { waiting_for_art: 0, needs_approval: 1, approved: 2, art_complete: 3 };
const rank = (j) => (RANK[j.col] == null ? 9 : RANK[j.col]);

const job = (id, over = {}) => ({ id, soId: 'SO-1', art_file_id: 'af1', total_units: 10, col: 'waiting_for_art', ...over });

describe('jobArtKey', () => {
  test('single-design jobs key off art_file_id; multi-design jobs off the _art_ids set', () => {
    expect(jobArtKey({ art_file_id: 'af1' })).toBe('af1');
    expect(jobArtKey({ _art_ids: ['afB', 'afA'], art_file_id: 'afB' })).toBe('afA+afB');
  });
  test('order of _art_ids does not change the key', () => {
    expect(jobArtKey({ _art_ids: ['a', 'b'] })).toBe(jobArtKey({ _art_ids: ['b', 'a'] }));
  });
  test('TBD placeholder and no art collapse to a sentinel, not to each other by accident', () => {
    expect(jobArtKey({ art_file_id: '__tbd' })).toBe('__none__');
    expect(jobArtKey({})).toBe('__none__');
  });
});

describe('splitFamilyRoot', () => {
  const byId = (jobs) => new Map(jobs.map((j) => [j.soId + '|' + j.id, j]));

  test('walks split_from to the root', () => {
    const jobs = [job('A'), job('A-S', { split_from: 'A' }), job('A-S-S', { split_from: 'A-S' })];
    const m = byId(jobs);
    jobs.forEach((j) => expect(splitFamilyRoot(j, m)).toBe('A'));
  });

  test('siblings whose parent is off the board still share one root', () => {
    // The parent may be filtered off this board (assigned to another artist, hidden, completed).
    // Its slices must not fragment into separate cards because of it.
    const jobs = [job('A-S', { split_from: 'A' }), job('A-S2', { split_from: 'A' })];
    const m = byId(jobs);
    expect(splitFamilyRoot(jobs[0], m)).toBe('A');
    expect(splitFamilyRoot(jobs[1], m)).toBe('A');
  });

  test('a split_from cycle terminates instead of hanging', () => {
    const a = job('A', { split_from: 'B' }); const b = job('B', { split_from: 'A' });
    expect(() => splitFamilyRoot(a, byId([a, b]))).not.toThrow();
  });

  test('same job id on a different SO is a different family', () => {
    const a = job('JOB-01'); const b = job('JOB-01', { soId: 'SO-2' });
    expect(artFamilyKey(a, byId([a, b]))).not.toBe(artFamilyKey(b, byId([a, b])));
  });
});

describe('consolidateArtFamilies', () => {
  test('SO-1462: parent + backorder slice collapse to one card carrying both jobs', () => {
    const parent = job('JOB-1462-01', { total_units: 17 });
    const slice = job('JOB-1462-01-S', { split_from: 'JOB-1462-01', total_units: 8 });
    const out = consolidateArtFamilies([parent, slice], rank);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('JOB-1462-01');
    expect(out[0]._famIds).toEqual(['JOB-1462-01', 'JOB-1462-01-S']);
    expect(out[0]._famUnits).toBe(25);
  });

  test('the LEAST-advanced member represents the family', () => {
    // Mirrors mergeJobsArtState's worst-case rule: a family with a slice still needing art must
    // land in Waiting for Art, never read as approved off its sibling.
    const parent = job('A', { col: 'approved' });
    const slice = job('A-S', { split_from: 'A', col: 'waiting_for_art' });
    const [card] = consolidateArtFamilies([parent, slice], rank);
    expect(card.id).toBe('A-S');
    expect(card._famIds).toEqual(['A', 'A-S']);
  });

  test('on a tie the family root represents it — that is the job number the rep knows', () => {
    const slice = job('A-S', { split_from: 'A' });
    const parent = job('A');
    const [card] = consolidateArtFamilies([slice, parent], rank);
    expect(card.id).toBe('A');
  });

  test('a slice re-pointed at DIFFERENT artwork keeps its own card', () => {
    const parent = job('A', { art_file_id: 'af1' });
    const slice = job('A-S', { split_from: 'A', art_file_id: 'af2' });
    const out = consolidateArtFamilies([parent, slice], rank);
    expect(out).toHaveLength(2);
    expect(out.every((c) => !c._famIds)).toBe(true);
  });

  test('unrelated jobs sharing one artwork are NOT merged — only split families are', () => {
    const a = job('A', { art_file_id: 'af1' });
    const b = job('B', { art_file_id: 'af1' });
    expect(consolidateArtFamilies([a, b], rank)).toHaveLength(2);
  });

  test('ungrouped jobs pass through untouched (same object, no family marker)', () => {
    const a = job('A');
    const [out] = consolidateArtFamilies([a], rank);
    expect(out).toBe(a);
    expect(out._famIds).toBeUndefined();
  });

  test('tolerates null entries, a missing rank fn, and an empty list', () => {
    expect(consolidateArtFamilies(null)).toEqual([]);
    expect(consolidateArtFamilies([null, undefined])).toEqual([]);
    const jobs = [job('A'), job('A-S', { split_from: 'A' })];
    expect(consolidateArtFamilies(jobs)).toHaveLength(1);
  });

  test('three-deep family collapses to one card', () => {
    const out = consolidateArtFamilies(
      [job('A'), job('A-S', { split_from: 'A' }), job('A-S-S', { split_from: 'A-S' })], rank,
    );
    expect(out).toHaveLength(1);
    expect(out[0]._famIds).toHaveLength(3);
  });
});

describe('artFamilyIds — what an art action writes to', () => {
  test('a family card writes to every member', () => {
    expect(artFamilyIds({ id: 'A', _famIds: ['A', 'A-S'] })).toEqual(['A', 'A-S']);
  });
  test('a plain card writes to itself only', () => {
    expect(artFamilyIds({ id: 'A' })).toEqual(['A']);
  });
});

// The dashboard's inline Approve / Request-changes bar works off a raw buildJobs(so) list, which
// carries no _famIds marker — this is how it resolves the same family the art board would.
describe('artFamilyIdsIn — family lookup in a raw (unconsolidated) job list', () => {
  test('a split family resolves to every slice, from any member', () => {
    const jobs = [job('A'), job('A-S1', { split_from: 'A' }), job('A-S2', { split_from: 'A' }), job('B', { art_file_id: 'af9' })];
    expect(artFamilyIdsIn(jobs, 'A').sort()).toEqual(['A', 'A-S1', 'A-S2']);
    expect(artFamilyIdsIn(jobs, 'A-S2').sort()).toEqual(['A', 'A-S1', 'A-S2']);
  });
  test('an unsplit job resolves to itself', () => {
    expect(artFamilyIdsIn([job('A'), job('B', { art_file_id: 'af9' })], 'A')).toEqual(['A']);
  });
  test('a slice re-pointed at different artwork is NOT the same work', () => {
    const jobs = [job('A'), job('A-S1', { split_from: 'A', art_file_id: 'af-other' })];
    expect(artFamilyIdsIn(jobs, 'A')).toEqual(['A']);
    expect(artFamilyIdsIn(jobs, 'A-S1')).toEqual(['A-S1']);
  });
  test('jobs on other orders never join the family', () => {
    const jobs = [job('A'), { ...job('A'), soId: 'SO-2' }];
    expect(artFamilyIdsIn(jobs, 'A')).toEqual(['A']);
  });
  test('an unknown job id writes only to itself', () => {
    expect(artFamilyIdsIn([job('A')], 'ZZ')).toEqual(['ZZ']);
    expect(artFamilyIdsIn([job('A')], undefined)).toEqual([]);
  });
});

describe('isOpenSplitSlice — the backorder half of a split-by-received', () => {
  test('the split_open flag marks it', () => {
    expect(isOpenSplitSlice({ split_open: true, key: 'k' })).toBe(true);
  });
  test('the __split__S key marks it even when the flag never persisted', () => {
    expect(isOpenSplitSlice({ key: 'released_embroidery_JOB-1462-01__split__S' })).toBe(true);
    expect(isOpenSplitSlice({ key: 'x__split__S2' })).toBe(true);
    expect(isOpenSplitSlice({ key: 'x__split__S__split__S' })).toBe(true);
  });
  test('by-SKU and custom splits are NOT backorders', () => {
    expect(isOpenSplitSlice({ key: 'x__split__B' })).toBe(false);
    expect(isOpenSplitSlice({ key: 'x__split__C1' })).toBe(false);
  });
  test('plain jobs and junk input are not backorders', () => {
    expect(isOpenSplitSlice({ key: 'released_embroidery_JOB-1462-01' })).toBe(false);
    expect(isOpenSplitSlice(null)).toBe(false);
    expect(isOpenSplitSlice({})).toBe(false);
  });
});

describe('allocateJobFulfillment — SO-1462 split-by-received apportioning', () => {
  // The SO line: 25 ordered (XS2 S9 M10 L3 XL1), 17 received (XS2 S5 M7 L3).
  // The split kept the 17 received units on JOB-1462-01 and peeled the 8 open units onto -S.
  const items = [{
    sku: 'JM5312', sizes: { XS: 2, S: 9, M: 10, L: 3, XL: 1 },
    po_lines: [{ received: { XS: 2, S: 5, M: 7, L: 3 } }],
  }];
  const parent = {
    id: 'JOB-1462-01', key: 'released_embroidery_JOB-1462-01',
    items: [{ item_idx: 0, sizes: { XS: 2, S: 5, M: 7, L: 3 } }],
  };
  const backorder = {
    id: 'JOB-1462-01-S', key: 'released_embroidery_JOB-1462-01__split__S', split_from: 'JOB-1462-01',
    items: [{ item_idx: 0, sizes: { S: 4, M: 3, XL: 1 } }],
  };

  test('the parent keeps its received sizes even when split_open did not persist', () => {
    const [p, b] = allocateJobFulfillment([parent, backorder], items);
    expect(p.fulSizes[0]).toEqual({ XS: 2, S: 5, M: 7, L: 3 });
    expect(p.fulfilled).toBe(17);
    expect(p.total).toBe(17);
    // The backorder shows nothing in hand — its garments have not arrived.
    expect(b.fulSizes[0]).toEqual({});
    expect(b.fulfilled).toBe(0);
    expect(b.total).toBe(8);
  });

  test('same result when the flag DID persist', () => {
    const [p, b] = allocateJobFulfillment([parent, { ...backorder, split_open: true }], items);
    expect(p.fulfilled).toBe(17);
    expect(b.fulfilled).toBe(0);
  });

  test('receipts that arrive for the backorder land on it once the parent is full', () => {
    const later = [{ ...items[0], po_lines: [{ received: { XS: 2, S: 9, M: 10, L: 3 } }] }];
    const [p, b] = allocateJobFulfillment([parent, backorder], later);
    expect(p.fulfilled).toBe(17);
    expect(b.fulSizes[0]).toEqual({ S: 4, M: 3 });
    expect(b.fulfilled).toBe(7);
  });
});
