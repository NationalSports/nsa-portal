/**
 * SO-2063 — customer-supplied garments must not share one mockup bucket.
 *
 * Every hand-typed line (customer-supplied blanks, one-off custom products) carries the SAME
 * placeholder SKU, because there is no catalog product behind it. Keyed on `sku|color`, all of
 * them collapsed onto ONE bucket per colour: Mission Viejo's red long sleeve and red short
 * sleeve both read `CUST-SUPPLIED|Red`, so the mockup uploaded for the long sleeve rendered on
 * the short sleeve too, the midlayer hoody showed the women's crew, and the approval gate
 * counted every one of them as mocked.
 *
 * The line NAME carries the real identity ("6014457-600 - Long Sleeve"), so that is what these
 * lines key on now.
 */
import {
  garmentMockKey, mockSkuOf, legacyMockKeyOf, itemMockFiles, isPlaceholderSku,
  slotMockFiles, mockSlotKeys, skusMissingMockups, rekeyGarmentMocks,
} from '../safeHelpers';

// The four SO-2063 lines from Erik's screenshots, as stored.
const LS_RED = { sku: 'CUST-SUPPLIED', color: 'Red', name: '6014457-600 - Long Sleeve' };
const SS_RED = { sku: 'CUST-SUPPLIED', color: 'Red', name: '6010870-600 - Short Sleeve' };
const CREW_BLACK = { sku: 'CUST-SUPPLIED', color: 'Black ', name: "6013664-008 - Women's Crew" };
const HOODY_BLACK = { sku: 'CUST-SUPPLIED', color: 'Black ', name: '6013946-001 - Midlayer hoody ' };
const CATALOG = { sku: 'JW6602', color: 'Black', name: 'Fleece Hood' };

describe('garmentMockKey — one bucket per garment line', () => {
  test('two customer-supplied garments of the same colour get different keys', () => {
    expect(garmentMockKey(LS_RED)).not.toBe(garmentMockKey(SS_RED));
    expect(garmentMockKey(CREW_BLACK)).not.toBe(garmentMockKey(HOODY_BLACK));
  });

  test('a catalog garment keys exactly as it always did', () => {
    expect(garmentMockKey(CATALOG)).toBe('JW6602|Black');
    expect(legacyMockKeyOf(CATALOG)).toBeNull();
  });

  test('CUSTOM and a blank SKU are placeholders too; a real SKU is not', () => {
    expect(isPlaceholderSku('CUST-SUPPLIED')).toBe(true);
    expect(isPlaceholderSku('custom')).toBe(true);
    expect(isPlaceholderSku('')).toBe(true);
    expect(isPlaceholderSku('JW6602')).toBe(false);
    // SO-1099's two custom lines had no colour at all — the name still separates them.
    expect(garmentMockKey({ sku: 'CUSTOM', color: '', name: 'Hoody' }))
      .not.toBe(garmentMockKey({ sku: 'CUSTOM', color: '', name: 'Dress' }));
  });

  test('a placeholder line with no name falls back to the old key rather than colliding with ""', () => {
    expect(mockSkuOf({ sku: 'CUST-SUPPLIED', color: 'Red', name: '' })).toBe('CUST-SUPPLIED');
  });

  test("a '|' in the name cannot forge a sub-key", () => {
    expect(garmentMockKey({ sku: 'CUSTOM', color: 'Red', name: 'A|numbers' })).toBe('A/numbers|Red');
  });
});

describe('slotMockFiles — the SO-2063 red long sleeve / short sleeve pair', () => {
  const slotFor = (art, line) => {
    const slots = mockSlotKeys(garmentMockKey(line), [{ kind: 'art' }]).map((sd) => ({ ...sd, artFile: art }));
    return slotMockFiles(slots[0], slots, line);
  };
  const urls = (r) => r.map((f) => (typeof f === 'string' ? f : f.url));

  test('the long sleeve mockup no longer renders on the short sleeve', () => {
    const art = {
      id: 'af-laces',
      item_mockups: { [garmentMockKey(LS_RED)]: [{ url: 'ls-red.png' }] },
    };
    expect(urls(slotFor(art, LS_RED))).toEqual(['ls-red.png']);
    expect(slotFor(art, SS_RED)).toEqual([]);
  });

  test('each garment shows its own mockup once both are uploaded', () => {
    const art = {
      id: 'af-laces',
      item_mockups: {
        [garmentMockKey(LS_RED)]: [{ url: 'ls-red.png' }],
        [garmentMockKey(SS_RED)]: [{ url: 'ss-red.png' }],
      },
    };
    expect(urls(slotFor(art, LS_RED))).toEqual(['ls-red.png']);
    expect(urls(slotFor(art, SS_RED))).toEqual(['ss-red.png']);
  });

  test('a pre-fix order still renders from the shared bucket (no data goes dark)', () => {
    const art = { id: 'af-old', item_mockups: { 'CUST-SUPPLIED|Red': [{ url: 'legacy.png' }] } };
    expect(urls(slotFor(art, LS_RED))).toEqual(['legacy.png']);
  });

  test('a re-upload to the garment’s own key wins over the shared bucket', () => {
    const art = {
      id: 'af-old',
      item_mockups: {
        'CUST-SUPPLIED|Red': [{ url: 'legacy.png' }],
        [garmentMockKey(SS_RED)]: [{ url: 'ss-red.png' }],
      },
    };
    expect(urls(slotFor(art, SS_RED))).toEqual(['ss-red.png']);
    // The garment that never got re-uploaded keeps reading the old bucket.
    expect(urls(slotFor(art, LS_RED))).toEqual(['legacy.png']);
  });

  test('an explicitly emptied own bucket does not resurrect the shared mockup', () => {
    const art = {
      id: 'af-old',
      item_mockups: {
        'CUST-SUPPLIED|Red': [{ url: 'legacy.png' }],
        [garmentMockKey(SS_RED)]: [],
      },
    };
    expect(slotFor(art, SS_RED)).toEqual([]);
  });

  test('an explicitly emptied own bucket also blocks the oldest bare-SKU fallback', () => {
    const art = {
      id: 'af-oldest',
      item_mockups: {
        'CUST-SUPPLIED': [{ url: 'bare-legacy.png' }],
        [garmentMockKey(SS_RED)]: [],
      },
    };
    expect(slotFor(art, SS_RED)).toEqual([]);
  });

  test('the oldest bare-SKU bucket still renders when no garment bucket was ever written', () => {
    const art = { id: 'af-oldest', item_mockups: { 'CUST-SUPPLIED': [{ url: 'bare-legacy.png' }] } };
    expect(urls(slotFor(art, SS_RED))).toEqual(['bare-legacy.png']);
  });

  test('itemMockFiles reads slot sub-keys through the same fallback', () => {
    const m = { 'CUST-SUPPLIED|Red|numbers': [{ url: 'back.png' }] };
    expect(itemMockFiles(m, LS_RED, '|numbers')).toHaveLength(1);
    expect(itemMockFiles(m, LS_RED)).toEqual([]);
  });
});

describe('skusMissingMockups — an unmocked custom garment can no longer pass the gate', () => {
  const so = {
    items: [
      { ...LS_RED, decorations: [{ kind: 'art', art_file_id: 'af-laces' }] },
      { ...SS_RED, decorations: [{ kind: 'art', art_file_id: 'af-laces' }] },
    ],
    art_files: [{ id: 'af-laces', item_mockups: { [garmentMockKey(LS_RED)]: [{ url: 'ls-red.png' }] } }],
  };
  const job = {
    art_file_id: 'af-laces',
    _art_ids: ['af-laces'],
    items: [
      { item_idx: 0, sku: 'CUST-SUPPLIED', color: 'Red', name: LS_RED.name, deco_idxs: [0] },
      { item_idx: 1, sku: 'CUST-SUPPLIED', color: 'Red', name: SS_RED.name, deco_idxs: [0] },
    ],
  };

  test('the short sleeve is reported missing, by name, and the long sleeve is not', () => {
    // Naming it 'CUST-SUPPLIED' would tell the rep nothing — every custom line reads that.
    expect(skusMissingMockups(job, so)).toEqual(['6010870-600 - Short Sleeve']);
  });

  test('both mocked → nothing missing', () => {
    const so2 = {
      ...so,
      art_files: [{
        id: 'af-laces',
        item_mockups: {
          [garmentMockKey(LS_RED)]: [{ url: 'ls-red.png' }],
          [garmentMockKey(SS_RED)]: [{ url: 'ss-red.png' }],
        },
      }],
    };
    expect(skusMissingMockups(job, so2)).toEqual([]);
  });

  test('a named custom line with a blank SKU is still blocked when unmocked', () => {
    const blank = { sku: '', color: 'Red', name: 'Uncatalogued Rally Towel', decorations: [{ kind: 'art', art_file_id: 'af-blank' }] };
    const blankSo = { items: [blank], art_files: [{ id: 'af-blank', item_mockups: {} }] };
    const blankJob = { art_file_id: 'af-blank', _art_ids: ['af-blank'], items: [{ item_idx: 0, sku: '', color: 'Red', name: blank.name, deco_idxs: [0] }] };
    expect(skusMissingMockups(blankJob, blankSo)).toEqual(['Uncatalogued Rally Towel']);
  });

  test('legacy reversible sub-slots still satisfy the gate before migration', () => {
    const reversible = {
      ...LS_RED,
      decorations: [{ kind: 'art', art_file_id: 'af-rev', reversible: true, color_way_id: 'cwA', color_way_id_b: 'cwB' }],
    };
    const legacyBase = legacyMockKeyOf(reversible);
    const revSo = {
      items: [reversible],
      art_files: [{
        id: 'af-rev',
        item_mockups: {
          [legacyBase]: [{ url: 'side-a.png' }],
          [legacyBase + '|cwB']: [{ url: 'side-b.png' }],
        },
      }],
    };
    const revJob = { art_file_id: 'af-rev', _art_ids: ['af-rev'], items: [{ item_idx: 0, ...LS_RED, deco_idxs: [0] }] };
    expect(skusMissingMockups(revJob, revSo)).toEqual([]);
  });
});

describe('rekeyGarmentMocks — renaming a custom line carries its mockup along', () => {
  test('the bucket moves to the new name', () => {
    const before = [{ id: 'af', item_mockups: { [garmentMockKey(LS_RED)]: [{ url: 'ls-red.png' }] } }];
    const renamed = { ...LS_RED, name: '6014457-600 - LS Tee' };
    const after = rekeyGarmentMocks(before, mockSkuOf(LS_RED), LS_RED.color, mockSkuOf(renamed), renamed.color, { moveBareSku: false });
    expect(after[0].item_mockups[garmentMockKey(renamed)]).toEqual([{ url: 'ls-red.png' }]);
    expect(after[0].item_mockups[garmentMockKey(LS_RED)]).toBeUndefined();
  });
});
