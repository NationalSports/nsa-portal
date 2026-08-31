/* eslint-disable */
/**
 * NSA Portal — a job's art-file set is scoped to the decorations it owns (SO-1023 class)
 *
 * On an art-split line one blank is decorated by several designs, each owned by a DIFFERENT job
 * (Friars / 2 Col / Attack Everything all print on the shared JX4452). The set of art files a job
 * "owns" for its garments drives the SO-page mock panels — including the mockup-remove "×", which
 * passes that set as removeMockFromArtFiles' artFileIds scope. If the set is built by scanning
 * EVERY decoration on the job's garments, it swallows the sibling designs' art files, so removing
 * one design's mock strips the shared sku|color key off the siblings too — reverting their
 * "Check Mock" with no visible action (the exact SO-1023 report: doing Attack un-applied 2 Col).
 *
 * jobArtFileIds scopes the deco scan to jobItemDecoIdxs, so a job's set contains only its own
 * design's art file(s). Legacy items with no deco_idxs still fall back to every decoration.
 *
 * SAFE: pure function from safeHelpers.js only. No DB, no UI, no network.
 */

const { jobArtFileIds, attachJobArtToUnresolvedDecos } = require('../safeHelpers');

// The SO-1023 shape: JX4452 (item_idx 11) carries three art decorations, one per sibling design.
const soItems = () => {
  const items = [];
  items[11] = {
    sku: 'JX4452', color: 'Black,White',
    decorations: [
      { kind: 'art', art_file_id: 'af-friars', position: 'Front Center' }, // deco 0
      { kind: 'art', art_file_id: 'af-2col',   position: 'Front Center' }, // deco 1
      { kind: 'art', art_file_id: 'af-attack', position: 'Front Center' }, // deco 2
    ],
  };
  return items;
};

const attackJob = { _art_ids: ['af-attack'], art_file_id: 'af-attack', items: [{ item_idx: 11, deco_idxs: [2] }] };
const twoColJob = { _art_ids: ['af-2col'],   art_file_id: 'af-2col',   items: [{ item_idx: 11, deco_idxs: [1] }] };

describe('jobArtFileIds — scoped to the decorations a job owns', () => {
  test("the Attack job's art set is ONLY its own design — no sibling designs on the shared blank", () => {
    const ids = jobArtFileIds(attackJob, soItems());
    expect([...ids].sort()).toEqual(['af-attack']);
    // The regression this guards: siblings must NOT be pulled in (they'd be wiped by the × scope).
    expect(ids.has('af-2col')).toBe(false);
    expect(ids.has('af-friars')).toBe(false);
  });

  test("the 2 Col job's art set is ONLY its own design", () => {
    const ids = jobArtFileIds(twoColJob, soItems());
    expect([...ids].sort()).toEqual(['af-2col']);
    expect(ids.has('af-attack')).toBe(false);
    expect(ids.has('af-friars')).toBe(false);
  });

  test('legacy item without deco_idxs falls back to every art decoration on the line', () => {
    const legacy = { _art_ids: ['af-2col'], items: [{ item_idx: 11 }] }; // no deco_idxs
    const ids = jobArtFileIds(legacy, soItems());
    expect([...ids].sort()).toEqual(['af-2col', 'af-attack', 'af-friars']);
  });

  test('seeds from the declared art even when the garment has no live decorations', () => {
    const ids = jobArtFileIds({ _art_ids: ['af-x'], items: [{ item_idx: 99, deco_idxs: [0] }] }, soItems());
    expect([...ids]).toEqual(['af-x']);
  });

  test('falls back to art_file_id when _art_ids is empty; ignores __tbd placeholder decos', () => {
    const items = [];
    items[0] = { sku: 'A', decorations: [{ kind: 'art', art_file_id: '__tbd' }, { kind: 'art', art_file_id: 'af-real' }] };
    const ids = jobArtFileIds({ art_file_id: 'af-primary', items: [{ item_idx: 0, deco_idxs: [0, 1] }] }, items);
    expect(ids.has('af-primary')).toBe(true); // seeded from art_file_id
    expect(ids.has('af-real')).toBe(true);    // real owned deco
    expect(ids.has('__tbd')).toBe(false);     // placeholder never counts as art
  });

  test('non-art decorations (numbers/names) on an owned index are not art files', () => {
    const items = [];
    items[0] = { sku: 'A', decorations: [{ kind: 'numbers' }, { kind: 'art', art_file_id: 'af-a' }] };
    const ids = jobArtFileIds({ _art_ids: [], art_file_id: 'af-a', items: [{ item_idx: 0, deco_idxs: [0, 1] }] }, items);
    expect([...ids].sort()).toEqual(['af-a']);
  });

  test('a names-only job does not borrow a sibling logo art file from the same garment', () => {
    const items = [{ decorations: [
      { kind: 'art', art_file_id: 'af-logo' },
      { kind: 'names', position: 'Back Center' },
    ] }];
    const namesJob = { items: [{ item_idx: 0, deco_idxs: [1] }] };
    expect([...jobArtFileIds(namesJob, items)]).toEqual([]);
  });
});

describe('attachJobArtToUnresolvedDecos — promote Art TBD uploads', () => {
  test('links only the unresolved art decoration owned by the job', () => {
    const items = [{ decorations: [
      { kind: 'art', art_file_id: '__tbd', art_tbd_type: 'screen_print', tbd_colors: 1 },
      { kind: 'art', art_file_id: 'af-sibling' },
      { kind: 'names', art_file_id: null },
    ] }];
    const job = { items: [{ item_idx: 0, deco_idxs: [0] }] };
    const updated = attachJobArtToUnresolvedDecos(items, job, 'af-vamos');
    expect(updated[0].decorations[0]).toMatchObject({ art_file_id: 'af-vamos', art_tbd_type: null, tbd_colors: null });
    expect(updated[0].decorations[1].art_file_id).toBe('af-sibling');
    expect(updated[0].decorations[2].art_file_id).toBeNull();
    expect(items[0].decorations[0].art_file_id).toBe('__tbd'); // input is not mutated
  });

  test('refuses to attach the reserved sentinel as a real art id', () => {
    const items = [{ decorations: [{ kind: 'art', art_file_id: null, art_tbd_type: 'dtf' }] }];
    expect(attachJobArtToUnresolvedDecos(items, { items: [{ item_idx: 0 }] }, '__tbd')).toBe(items);
  });
});
