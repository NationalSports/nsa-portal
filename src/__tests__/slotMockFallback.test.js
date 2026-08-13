/**
 * Mockup slots must survive job consolidation.
 *
 * Slot keys are positional: the first art decoration on a garment owns the bare `sku|color` key,
 * later ones get a discriminated key. That position depends on how many decorations the JOB claims,
 * so folding several designs onto one job (consolidateFrozenJobDecos) demotes designs that used to
 * run alone — and their existing mock, stored under the bare key, would render as an empty upload
 * box. SO-1840's "CUI Basketball" and "Talon" are both stored under `JW6602|Black` for exactly that
 * reason: each owned its own job when it was uploaded.
 */
import { slotMockFiles, mockSlotKeys } from '../safeHelpers';

const CUI = { id: 'af-cui', name: 'CUI Basketball', item_mockups: { 'JW6602|Black': [{ url: 'cui.png' }] } };
const TALON = { id: 'af-talon', name: 'Talon', item_mockups: { 'JW6602|Black': [{ url: 'talon.png' }] } };
const files = (r) => r.map((f) => f.url);

describe('slotMockFiles — SO-1840, two designs consolidated onto one hoodie job', () => {
  // The merged job claims both art decorations, so mockSlotKeys demotes Talon to `|d1`.
  const slots = mockSlotKeys('JW6602|Black', [
    { kind: 'art' }, { kind: 'art' },
  ]).map((sd, i) => ({ ...sd, artFile: i === 0 ? CUI : TALON }));

  test('the demoted design still shows the mock it already had', () => {
    expect(slots[1].key).toBe('JW6602|Black|d1');
    expect(files(slotMockFiles(slots[1], slots, 'JW6602', 'Black'))).toEqual(['talon.png']);
  });

  test('each slot shows its OWN design, never the other one', () => {
    expect(files(slotMockFiles(slots[0], slots, 'JW6602', 'Black'))).toEqual(['cui.png']);
    expect(files(slotMockFiles(slots[1], slots, 'JW6602', 'Black'))).toEqual(['talon.png']);
  });

  test('a mock saved under the new discriminated key wins over the fallback', () => {
    const talon2 = { ...TALON, item_mockups: { ...TALON.item_mockups, 'JW6602|Black|d1': [{ url: 'talon-new.png' }] } };
    const s = [slots[0], { ...slots[1], artFile: talon2 }];
    expect(files(slotMockFiles(s[1], s, 'JW6602', 'Black'))).toEqual(['talon-new.png']);
  });
});

describe('slotMockFiles — the fallback must not leak between slots', () => {
  test('two slots sharing ONE art file stay strict (reversible Side A / Side B)', () => {
    const rev = { id: 'af-rev', item_mockups: { 'JJ0055|Green': [{ url: 'sideA.png' }] } };
    const slots = mockSlotKeys('JJ0055|Green', [{ kind: 'art', reversible: true, color_way_id: 'cwA', color_way_id_b: 'cwB' }])
      .map((sd) => ({ ...sd, artFile: rev }));
    expect(files(slotMockFiles(slots[0], slots, 'JJ0055', 'Green'))).toEqual(['sideA.png']);
    // Side B has no mock of its own and shares the art file — showing Side A there would be a lie.
    expect(slotMockFiles(slots[1], slots, 'JJ0055', 'Green')).toEqual([]);
  });

  test('a numbers slot never falls back to the garment’s front art mock', () => {
    const slots = mockSlotKeys('JJ0055|Green', [{ kind: 'art' }, { kind: 'numbers' }])
      .map((sd) => ({ ...sd, artFile: CUI }));
    const numbers = slots.find((s) => s.kind === 'numbers');
    expect(numbers.key).toBe('JJ0055|Green|numbers');
    expect(slotMockFiles(numbers, slots, 'JW6602', 'Black')).toEqual([]);
  });

  test('a names slot behaves the same', () => {
    const slots = mockSlotKeys('JJ0055|Green', [{ kind: 'art' }, { kind: 'names' }])
      .map((sd) => ({ ...sd, artFile: CUI }));
    const names = slots.find((s) => s.kind === 'names');
    expect(slotMockFiles(names, slots, 'JW6602', 'Black')).toEqual([]);
  });

  test('a numbers slot still shows a mock uploaded to its own key', () => {
    const art = { id: 'af-1', item_mockups: { 'JJ0055|Green|numbers': [{ url: 'back.png' }] } };
    const slots = mockSlotKeys('JJ0055|Green', [{ kind: 'art' }, { kind: 'numbers' }])
      .map((sd) => ({ ...sd, artFile: art }));
    expect(files(slotMockFiles(slots[1], slots, 'JJ0055', 'Green'))).toEqual(['back.png']);
  });

  test('legacy plain-SKU keys still resolve', () => {
    const legacy = { id: 'af-l', item_mockups: { JW6602: [{ url: 'legacy.png' }] } };
    const slots = [{ key: 'JW6602|Black', kind: 'art', primary: true, artFile: legacy }];
    expect(files(slotMockFiles(slots[0], slots, 'JW6602', 'Black'))).toEqual(['legacy.png']);
  });

  test('a slot with no art file is empty, not a crash', () => {
    expect(slotMockFiles({ key: 'k', kind: 'art', primary: false }, [], 'X', 'Y')).toEqual([]);
  });
});

// ── Re-uploaded copies ────────────────────────────────────────────────────────────────────────
import { nnMockCounts } from '../safeHelpers';
import { dedupeMockDupes } from '../utils';

describe('dedupeMockDupes — SO-1605’s backpack rendered three identical boxes', () => {
  // Real shape: the patch slot holds one proof, the names slot holds the SAME proof twice (a
  // re-upload lands under a fresh URL but keeps its filename). Three boxes, one picture.
  const PATCH_SLOT = [{ url: 'a1', name: 'Coronado FC · SO-1605 · heat press · Other-01.jpg' }];
  const NAMES_SLOT = [
    { url: 'b1', name: 'Coronado FC · SO-1605 · heat press · Other-01.jpg' },
    { url: 'b2', name: 'Coronado FC · SO-1605 · heat press · Other-01.jpg' },
  ];

  test('a slot collapses its own re-uploads', () => {
    expect(dedupeMockDupes(NAMES_SLOT).map((f) => f.url)).toEqual(['b1']);
  });

  test('per-slot deduping leaves the patch and the names proof as two boxes, not one or three', () => {
    const shown = [...dedupeMockDupes(PATCH_SLOT), ...dedupeMockDupes(NAMES_SLOT)];
    expect(shown.map((f) => f.url)).toEqual(['a1', 'b1']);
  });

  test('deduping ACROSS slots would wrongly drop the back proof', () => {
    // Filenames are generated from the position, and the backpack's patch and names are both
    // "Other" — so a global collapse loses a genuinely different proof. Guard against a future
    // refactor moving the dedupe up a level.
    expect(dedupeMockDupes([...PATCH_SLOT, ...NAMES_SLOT])).toHaveLength(1);
  });

  test('files with no resolvable name are left alone', () => {
    expect(dedupeMockDupes([{ url: 'x' }, { url: 'y' }])).toHaveLength(2);
  });
});

describe('nnMockCounts — which side has no proof on file', () => {
  const backpack = [{ id: 'af-bp', item_mockups: { '5159512|Black': [{ url: 'a' }], '5159512|Black|names': [{ url: 'b' }] } }];
  const jersey = [{ id: 'af-j', item_mockups: { 'JJ0055|Dark Green/White': [{ url: 'front' }] } }];

  test('SO-1605 backpack: the names proof is on file', () => {
    expect(nnMockCounts(backpack, '5159512', 'Black')).toEqual({ numbers: 0, names: 1 });
  });

  test('SO-1605 jersey: a front mock, no back proof at all', () => {
    expect(nnMockCounts(jersey, 'JJ0055', 'Dark Green/White')).toEqual({ numbers: 0, names: 0 });
  });

  test('the base art key is never miscounted as a back proof', () => {
    expect(nnMockCounts(backpack, '5159512', 'Black').numbers).toBe(0);
  });

  test('reversible and repeated slot variants count', () => {
    const rev = [{ id: 'a', item_mockups: { 'X|Y|numbers': [{ url: '1' }], 'X|Y|numbers_b': [{ url: '2' }], 'X|Y|names_1': [{ url: '3' }] } }];
    expect(nnMockCounts(rev, 'X', 'Y')).toEqual({ numbers: 2, names: 1 });
  });
});
