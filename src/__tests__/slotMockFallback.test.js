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
