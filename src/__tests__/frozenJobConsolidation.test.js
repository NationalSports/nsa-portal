/**
 * One garment, one production job.
 *
 * Releasing a decoration for art freezes its (item, deco) claim. The auto-builder skips frozen
 * claims, so every OTHER decoration on the same garment used to form a second job: two sheets on
 * the floor for the same physical garments, and double units in the board's total. SO-1605's 18
 * jerseys read as an 18-unit patch job plus an 18-unit numbers job = 36; SO-1774 / SO-1766 /
 * SO-1598 / SO-1777 / SO-1905 all carry the same fork.
 *
 * consolidateFrozenJobDecos folds those complementary frozen jobs back together (ABSORB) and lets
 * a frozen job claim the decorations still unowned on garments it already holds (EXPAND).
 */
import { consolidateFrozenJobDecos, frozenJobNonArtLabels } from '../lib/syncJobsMatch';

// SO-1605's six jersey lines: art patch at deco 0, back numbers at deco 1.
const JERSEYS = [
  { item_idx: 0, sku: 'JJ0055' }, { item_idx: 1, sku: 'JI9989' }, { item_idx: 2, sku: 'JJ0058' },
  { item_idx: 3, sku: 'JI9992' }, { item_idx: 4, sku: 'H44535' }, { item_idx: 5, sku: 'H44532' },
];
const rows = (decoIdx) => JERSEYS.map((g) => ({ ...g, units: 3, deco_idx: decoIdx, deco_idxs: [decoIdx] }));

const PATCH = {
  deco_idx: 0, kind: 'art', method: 'heat_press', position: 'Left Chest',
  art_file_id: 'af-patch', label: 'CORONADO FC - CHEST LEFT - PATCH', consolidatable: true,
};
const NUMBERS = {
  deco_idx: 1, kind: 'numbers', method: 'heat_transfer', position: 'Back',
  art_file_id: null, label: 'Numbers — heat transfer', consolidatable: true,
};
const jerseyDecos = () => [PATCH, NUMBERS];

const patchJob = (over = {}) => ({
  id: 'JOB-1605-02', key: 'released_heat_press_JOB-1605-02', _released: true,
  art_name: 'CORONADO FC - CHEST LEFT - PATCH', deco_type: 'heat_press', positions: 'Left Chest',
  art_status: 'art_complete', prod_status: 'ready', total_units: 18,
  art_file_id: 'af-patch', _art_ids: ['af-patch'], items: rows(0), ...over,
});
const numbersJob = (over = {}) => ({
  id: 'JOB-1605-03', key: 'released_heat_transfer_JOB-1605-03', _released: true,
  art_name: 'Numbers — heat transfer', deco_type: 'heat_transfer', positions: 'Back',
  art_status: 'art_complete', prod_status: 'ready', total_units: 18,
  art_file_id: null, _art_ids: [], items: rows(1), ...over,
});

describe('ABSORB — complementary frozen jobs on the same garments', () => {
  test('SO-1605: patch job + numbers job over the same 18 jerseys become one job', () => {
    const r = consolidateFrozenJobDecos([patchJob(), numbersJob()], jerseyDecos);
    expect(r.jobs).toHaveLength(1);
    expect(r.absorbedIds).toEqual(['JOB-1605-03']);
    const j = r.jobs[0];
    expect(j.id).toBe('JOB-1605-02');
    expect(j.items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [0, 1]));
    // The garments are counted once, not once per decoration.
    expect(j.items).toHaveLength(6);
  });

  test('the merged job declares BOTH methods so the stale-claim heal keeps the numbers claim', () => {
    const j = consolidateFrozenJobDecos([patchJob(), numbersJob()], jerseyDecos).jobs[0];
    expect(new Set(j.deco_types)).toEqual(new Set(['heat_press', 'heat_transfer']));
    expect(j.positions).toBe('Left Chest, Back');
    expect(j._merged).toBe(true);
  });

  test('art survives the merge and never advances — least-advanced status wins', () => {
    const r = consolidateFrozenJobDecos(
      [patchJob({ art_status: 'waiting_approval' }), numbersJob()], jerseyDecos,
    );
    expect(r.jobs[0].art_status).toBe('waiting_approval');
    expect(r.jobs[0]._art_ids).toEqual(['af-patch']);
  });

  test('a numbers-first target still picks up the art job’s design', () => {
    // SO-1605's backpack pair: the names job (JOB-…-04) sorts ahead of the patch job (…-05).
    const names = numbersJob({ id: 'JOB-1605-04', items: [{ item_idx: 6, sku: '5159512', deco_idxs: [1] }] });
    const patch = patchJob({ id: 'JOB-1605-05', items: [{ item_idx: 6, sku: '5159512', deco_idxs: [0] }] });
    const j = consolidateFrozenJobDecos([names, patch], () => jerseyDecos()).jobs[0];
    expect(j.id).toBe('JOB-1605-04');
    expect(j._art_ids).toEqual(['af-patch']);
    expect(j.art_file_id).toBe('af-patch');
  });

  test('a started job is never re-shaped', () => {
    const r = consolidateFrozenJobDecos([patchJob({ prod_status: 'in_process' }), numbersJob()], jerseyDecos);
    expect(r.jobs).toHaveLength(2);
    expect(r.absorbedIds).toEqual([]);
  });

  test('a decorated / packed job is never re-shaped', () => {
    const r = consolidateFrozenJobDecos(
      [patchJob({ decorated_at: '2026-08-01T00:00:00Z' }), numbersJob()], jerseyDecos,
    );
    expect(r.jobs).toHaveLength(2);
  });

  test('overlapping claims are size/art splits, not complements — left alone', () => {
    const r = consolidateFrozenJobDecos([patchJob(), numbersJob({ items: rows(0) })], jerseyDecos);
    expect(r.jobs).toHaveLength(2);
  });

  test('different garment sets never merge', () => {
    const other = numbersJob({ items: [{ item_idx: 9, sku: 'JN5459', deco_idxs: [1] }] });
    expect(consolidateFrozenJobDecos([patchJob(), other], jerseyDecos).jobs).toHaveLength(2);
  });

  test('split slices are excluded', () => {
    const r = consolidateFrozenJobDecos(
      [patchJob({ split_from: 'JOB-1605-01' }), numbersJob()], jerseyDecos,
    );
    expect(r.jobs).toHaveLength(2);
  });

  test('a job holding a split-art share is excluded', () => {
    const r = consolidateFrozenJobDecos(
      [patchJob({ items: rows(0).map((gi) => ({ ...gi, _artSplit: true })) }), numbersJob()], jerseyDecos,
    );
    expect(r.jobs).toHaveLength(2);
  });

  test('disagreeing coach state blocks the merge rather than guessing', () => {
    const approved = patchJob({ coach_approved_at: '2026-08-01T00:00:00Z' });
    expect(consolidateFrozenJobDecos([approved, numbersJob()], jerseyDecos).jobs).toHaveLength(2);
    // Both approved is fine.
    const bothApproved = consolidateFrozenJobDecos(
      [approved, numbersJob({ coach_approved_at: '2026-08-01T00:00:00Z' })], jerseyDecos,
    );
    expect(bothApproved.jobs).toHaveLength(1);
  });

  test('a rejection on either side blocks the merge', () => {
    const r = consolidateFrozenJobDecos([patchJob(), numbersJob({ coach_rejected: true })], jerseyDecos);
    expect(r.jobs).toHaveLength(2);
  });
});

describe('EXPAND — a frozen job claims the rest of its garments’ decorations', () => {
  test('SO-1774: a released numbers job picks up the unclaimed patch on the same jerseys', () => {
    const r = consolidateFrozenJobDecos([numbersJob()], jerseyDecos);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [0, 1]));
    expect(r.jobs[0]._art_ids).toEqual(['af-patch']);
    expect(new Set(r.jobs[0].deco_types)).toEqual(new Set(['heat_transfer', 'heat_press']));
  });

  test('art_status is not recomputed on expansion — a job can only under-report', () => {
    const j = consolidateFrozenJobDecos([numbersJob({ art_status: 'waiting_approval' })], jerseyDecos).jobs[0];
    expect(j.art_status).toBe('waiting_approval');
  });

  test('unfinished artwork keeps its own job (consolidatable:false) until it settles', () => {
    const decos = () => [{ ...PATCH, consolidatable: false }, NUMBERS];
    const r = consolidateFrozenJobDecos([numbersJob()], decos);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [1]));
    expect(r.changed).toBe(false);
  });

  test('a decoration another frozen job already claims is not stolen', () => {
    const r = consolidateFrozenJobDecos(
      [patchJob({ items: rows(0).slice(0, 1) }), numbersJob()], jerseyDecos,
    );
    // Different garment sets → no absorb; the patch job owns item 0's deco 0, so the numbers
    // job expands into the other five jerseys only.
    expect(r.jobs).toHaveLength(2);
    expect(r.jobs[1].items[0].deco_idxs).toEqual([1]);
    expect(r.jobs[1].items[1].deco_idxs).toEqual([0, 1]);
  });

  test('work already on the floor under another job is reserved', () => {
    const reserved = new Set(JERSEYS.map((g) => g.item_idx + '::0'));
    const r = consolidateFrozenJobDecos([numbersJob()], jerseyDecos, reserved);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [1]));
  });

  test('a garment line that is gone (or unhydrated) leaves the frozen snapshot alone', () => {
    const r = consolidateFrozenJobDecos([numbersJob()], () => null);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [1]));
    expect(r.changed).toBe(false);
  });

  test('a started frozen job does not expand', () => {
    const r = consolidateFrozenJobDecos([numbersJob({ prod_status: 'staging' })], jerseyDecos);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual(JERSEYS.map(() => [1]));
  });

  test('is a fixed point — a second pass changes nothing', () => {
    const first = consolidateFrozenJobDecos([patchJob(), numbersJob()], jerseyDecos);
    const second = consolidateFrozenJobDecos(first.jobs, jerseyDecos);
    expect(second.changed).toBe(false);
    expect(second.jobs).toEqual(first.jobs);
  });
});

describe('frozenJobNonArtLabels', () => {
  test('names the numbers/names a consolidated job runs, so the board is not just the logo', () => {
    const j = consolidateFrozenJobDecos([patchJob(), numbersJob()], jerseyDecos).jobs[0];
    expect(frozenJobNonArtLabels(j, jerseyDecos)).toEqual(['Numbers — heat transfer']);
  });

  test('art-only jobs contribute nothing', () => {
    expect(frozenJobNonArtLabels(patchJob(), jerseyDecos)).toEqual([]);
  });

  test('unclaimed decorations are not advertised', () => {
    // The patch job holds deco 0 only — the numbers on the same line belong to another job.
    expect(frozenJobNonArtLabels(patchJob(), jerseyDecos)).not.toContain('Numbers — heat transfer');
  });
});
