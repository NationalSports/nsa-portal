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

// ── Live-order regressions ────────────────────────────────────────────────────────────────────
// Real rows from the orders Dylan reported, driven through the SAME resolver the editors use
// (liveItemDecoDescriptors) so the art-completion gate is exercised, not a stand-in for it.
import { liveItemDecoDescriptors } from '../lib/syncJobsMatch';
import { artStatusForFile } from '../constants';

const resolverFor = (order) => (ii) => {
  const it = order.items[ii];
  if (!it) return null;
  return liveItemDecoDescriptors(it.decos, {
    findArt: (id) => order.art_files.find((a) => a.id === id),
    artStatusOf: (artF, dt) => artStatusForFile(artF, dt),
    isOutsourced: (d) => d.fulfillment === 'outside' || !!d.deco_po_id,
  });
};

describe('liveItemDecoDescriptors — the art-completion gate', () => {
  const approvedWithFiles = { id: 'af1', name: 'PATCH', deco_type: 'heat_press', status: 'approved', prod_files_attached: true };
  const approvedNoFiles = { id: 'af1', name: 'PATCH', deco_type: 'dtf', status: 'approved', prod_files_attached: false };
  const proofing = { id: 'af1', name: 'PATCH', deco_type: 'heat_press', status: 'uploaded', mockup_files: [{ url: 'm' }] };
  const build = (art) => liveItemDecoDescriptors(
    [{ kind: 'art', art_file_id: 'af1', position: 'Left Chest' }, { kind: 'numbers', num_method: 'heat_transfer', position: 'Back' }],
    { findArt: () => art, artStatusOf: (a, dt) => artStatusForFile(a, dt), isOutsourced: () => false },
  );

  test('finished artwork consolidates', () => {
    expect(build(approvedWithFiles)[0]).toMatchObject({ kind: 'art', method: 'heat_press', consolidatable: true });
  });
  test('approved but awaiting production files does NOT', () => {
    expect(build(approvedNoFiles)[0].consolidatable).toBe(false);
  });
  test('artwork still being proofed does NOT', () => {
    expect(build(proofing)[0].consolidatable).toBe(false);
  });
  test('numbers always consolidate — no art workflow to strand', () => {
    expect(build(proofing)[1]).toMatchObject({ kind: 'numbers', label: 'Numbers — heat transfer', consolidatable: true });
  });
  test('Art TBD never consolidates', () => {
    const r = liveItemDecoDescriptors([{ kind: 'art', art_file_id: null, position: 'Front' }],
      { findArt: () => null, artStatusOf: (a, dt) => artStatusForFile(a, dt), isOutsourced: () => false });
    expect(r[0].consolidatable).toBe(false);
  });
  test('declared art that is not hydrated aborts the whole line', () => {
    const r = liveItemDecoDescriptors([{ kind: 'art', art_file_id: 'af-missing' }],
      { findArt: () => undefined, artStatusOf: () => 'art_complete', isOutsourced: () => false });
    expect(r).toBeNull();
  });
  test('outsourced decorations are not in-house work', () => {
    const r = liveItemDecoDescriptors([{ kind: 'art', art_file_id: 'af1', deco_po_id: 'DPO-1' }],
      { findArt: () => approvedWithFiles, artStatusOf: () => 'art_complete', isOutsourced: (d) => !!d.deco_po_id });
    expect(r).toEqual([]);
  });
  test('a split-art share keeps its own job even when the art is finished', () => {
    const r = liveItemDecoDescriptors([{ kind: 'art', art_file_id: 'af1', split_group: 'g1', split_sizes: { M: 4 } }],
      { findArt: () => approvedWithFiles, artStatusOf: () => 'art_complete', isOutsourced: () => false });
    expect(r[0].consolidatable).toBe(false);
  });
});

describe('SO-1605 (live rows) — 5 sheets become 3', () => {
  // items 0-5: jersey, art patch (deco 0) + back numbers (deco 1). item 6: backpack, patch + names.
  // items 7-8: shorts, patch only.
  const AF = [
    { id: 'af1784573480759', name: 'CORONADO FC - CHEST LEFT - PATCH', deco_type: 'heat_press', status: 'approved', prod_files_attached: true },
    { id: 'af1784736631116', name: 'CORONADO FC - BACKPACK - PATCH', deco_type: 'heat_press', status: 'approved', prod_files_attached: true },
    { id: 'af1784574267140', name: 'CORONADO FC - SHORT - PATCH', deco_type: 'heat_press', status: 'approved', prod_files_attached: true },
  ];
  const jersey = (sku) => ({ sku, decos: [
    { kind: 'art', art_file_id: 'af1784573480759', position: 'Left Chest' },
    { kind: 'numbers', num_method: 'heat_transfer', position: 'Back' }] });
  const order = { art_files: AF, items: [
    jersey('JJ0055'), jersey('JI9989'), jersey('JJ0058'), jersey('JI9992'), jersey('H44535'), jersey('H44532'),
    { sku: '5159512', decos: [
      { kind: 'art', art_file_id: 'af1784736631116', position: 'Other' },
      { kind: 'names', name_method: 'embroidery', position: 'Other' }] },
    { sku: 'JJ2420', decos: [{ kind: 'art', art_file_id: 'af1784574267140', position: 'Right Leg' }] },
    { sku: 'JH3411', decos: [{ kind: 'art', art_file_id: 'af1784574267140', position: 'Right Leg' }] },
  ] };
  const JROWS = ['JJ0055', 'JI9989', 'JJ0058', 'JI9992', 'H44535', 'H44532'];
  const frozen = [
    { id: 'JOB-1605-02', key: 'released_heat_press_JOB-1605-02', _released: true, deco_type: 'heat_press',
      art_status: 'art_complete', prod_status: 'ready', total_units: 18, art_file_id: 'af1784573480759',
      _art_ids: ['af1784573480759'], items: JROWS.map((sku, i) => ({ item_idx: i, sku, units: 3, deco_idxs: [0] })) },
    { id: 'JOB-1605-03', key: 'released_heat_transfer_JOB-1605-03', _released: true, deco_type: 'heat_transfer',
      art_status: 'art_complete', prod_status: 'ready', total_units: 18, _art_ids: [],
      items: JROWS.map((sku, i) => ({ item_idx: i, sku, units: 3, deco_idxs: [1] })) },
    { id: 'JOB-1605-04', key: 'released_embroidery_JOB-1605-04', _released: true, deco_type: 'embroidery',
      art_status: 'art_complete', prod_status: 'hold', total_units: 1, _art_ids: [],
      items: [{ item_idx: 6, sku: '5159512', units: 1, deco_idxs: [1] }] },
    { id: 'JOB-1605-05', key: 'released_heat_press_JOB-1605-05', _released: true, deco_type: 'heat_press',
      art_status: 'art_complete', prod_status: 'ready', total_units: 1, art_file_id: 'af1784736631116',
      _art_ids: ['af1784736631116'], items: [{ item_idx: 6, sku: '5159512', units: 1, deco_idxs: [0] }] },
  ];

  test('the two jersey jobs and the two backpack jobs each collapse to one', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    expect(r.jobs.map((j) => j.id)).toEqual(['JOB-1605-02', 'JOB-1605-04']);
    expect(r.absorbedIds.sort()).toEqual(['JOB-1605-03', 'JOB-1605-05']);
  });

  test('each garment is claimed once, so the board stops double-counting it', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    const claims = r.jobs.flatMap((j) => j.items.map((gi) => gi.item_idx + '::' + gi.deco_idxs.join(',')));
    expect(claims).toEqual([...JROWS.map((_, i) => i + '::0,1'), '6::0,1']);
    // The shorts (items 7-8) are untouched — they stay with the auto-builder.
    expect(r.jobs.flatMap((j) => j.items.map((gi) => gi.item_idx))).not.toContain(7);
  });

  test('the merged jersey job advertises the back numbers, not just the logo', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    expect(frozenJobNonArtLabels(r.jobs[0], resolverFor(order))).toEqual(['Numbers — heat transfer']);
    expect(frozenJobNonArtLabels(r.jobs[1], resolverFor(order))).toEqual(['Names — embroidery']);
  });
});

describe('SO-1774 (live rows) — a released numbers job reclaims its garments’ finished logo', () => {
  // The patch FILE is approved with production files attached, even though the auto job that owned
  // it still had a stale art_status of waiting_approval. The gate reads the file.
  const order = {
    art_files: [{ id: 'af-0', name: 'CORONADO FC - CHEST LEFT - PATCH', deco_type: 'heat_press', status: 'approved', prod_files_attached: true }],
    items: [0, 1, 2].map(() => ({ sku: 'JJ0055', decos: [
      { kind: 'art', art_file_id: 'af-0', position: 'Left Chest' },
      { kind: 'numbers', num_method: 'heat_transfer', position: 'Back' }] })),
  };
  const frozen = [{ id: 'JOB-1774-02', key: 'released_heat_transfer_JOB-1774-02', _released: true,
    deco_type: 'heat_transfer', art_status: 'art_complete', prod_status: 'hold', total_units: 10, _art_ids: [],
    items: [0, 1, 2].map((i) => ({ item_idx: i, sku: 'JJ0055', units: 3, deco_idxs: [1] })) }];

  test('the patch joins the numbers job instead of running as a second sheet', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0].items.map((gi) => gi.deco_idxs)).toEqual([[0, 1], [0, 1], [0, 1]]);
    expect(r.jobs[0]._art_ids).toEqual(['af-0']);
  });

  test('units are unchanged — expansion adds decorations, never garments', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    expect(r.jobs[0].total_units).toBe(10);
    expect(r.jobs[0].items).toHaveLength(3);
  });
});

describe('SO-1840 (live rows) — two screen designs on one hoodie run as one job', () => {
  const order = {
    art_files: [
      { id: 'af-cui', name: 'CUI Basketball', deco_type: 'screen_print', status: 'approved', prod_files_attached: true },
      { id: 'af-talon', name: 'Talon', deco_type: 'screen_print', status: 'approved', prod_files_attached: true }],
    items: [null, null, null, { sku: 'JW6602', decos: [
      { kind: 'art', art_file_id: 'af-cui', position: 'Front Center' },
      { kind: 'art', art_file_id: 'af-talon', position: 'Back' }] }],
  };
  const frozen = [
    { id: 'JOB-1840-03', key: 'released_screen_print_JOB-1840-03', _released: true, deco_type: 'screen_print',
      art_status: 'art_complete', prod_status: 'hold', total_units: 21, art_file_id: 'af-cui', _art_ids: ['af-cui'],
      items: [{ item_idx: 3, sku: 'JW6602', units: 21, deco_idxs: [0] }] },
    { id: 'JOB-1840-04', key: 'released_screen_print_JOB-1840-04', _released: true, deco_type: 'screen_print',
      art_status: 'art_complete', prod_status: 'hold', total_units: 21, art_file_id: 'af-talon', _art_ids: ['af-talon'],
      items: [{ item_idx: 3, sku: 'JW6602', units: 21, deco_idxs: [1] }] },
  ];

  test('21 hoodies count once, not 42', () => {
    const r = consolidateFrozenJobDecos(frozen, resolverFor(order));
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]._art_ids).toEqual(['af-cui', 'af-talon']);
    expect(r.jobs[0].items[0].deco_idxs).toEqual([0, 1]);
    expect(r.jobs[0].total_units).toBe(21);
  });
});
