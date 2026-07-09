import { guessDarkColor, autoColorChoice, resolveItemPlacement, garmentTypeOf, garmentHex, garmentIsDark, hydrateStoreArt } from '../lib/artGrid';

describe('hydrateStoreArt', () => {
  const liveCws = [{ id: 'cw_r', garment_color: 'Royal' }, { id: 'cw_l', garment_color: 'Light' }];
  const liveWls = [{ url: 'royal.png', color_way: 'Royal', color_way_id: 'cw_r' }, { url: 'light.png', color_way: 'Light', color_way_id: 'cw_l' }];
  test('a stale store snapshot picks up the live record\'s web logos and color ways (matched by id)', () => {
    const snapshot = { id: 'a1', name: 'Oak Grove Football', deco_type: 'screen_print', web_logo_url: 'orig.png', color_ways: [], _srcLabel: 'Uploaded' };
    const live = { id: 'a1', name: 'Oak Grove Football', deco_type: 'screen_print', web_logo_url: 'orig.png', color_ways: liveCws, web_logos: liveWls };
    const [out] = hydrateStoreArt([snapshot], [live]);
    expect(out.web_logos).toEqual(liveWls);
    expect(out.color_ways).toEqual(liveCws);
    // the hydrated record still feeds Autocolor its per-CW variants
    expect(autoColorChoice(out, 'White')).toMatchObject({ kind: 'variant', url: 'light.png', colorWayId: 'cw_l' });
    expect(autoColorChoice(out, 'True Royal')).toMatchObject({ kind: 'variant', url: 'royal.png', colorWayId: 'cw_r' });
  });
  test('falls back to name + deco method when the library copy has a different id', () => {
    const snapshot = { id: 'a_old', name: 'Crest', deco_type: 'screen_print', color_ways: [] };
    const live = { id: 'a_new', name: 'crest ', deco_type: 'screen_print', web_logos: liveWls, color_ways: liveCws };
    const [out] = hydrateStoreArt([snapshot], [live]);
    expect(out.web_logos).toEqual(liveWls);
  });
  // The real Oak Grove case: the store has a bare upload "Oak Grove Football" while the
  // artist built the color ways on "11in Oak Grove Football" — different id, different image,
  // name differs only by the print-size prefix.
  test('bridges a bare store upload to the artist\'s size-prefixed library art', () => {
    const snapshot = { id: 'logo_upload', name: 'Oak Grove Football', deco_type: 'screen_print', web_logo_url: 'raw.png', color_ways: [] };
    const live = { id: 'caf_art', name: '11in Oak Grove Football', deco_type: 'screen_print', web_logo_url: 'royal.png', color_ways: liveCws, web_logos: liveWls };
    const [out] = hydrateStoreArt([snapshot], [live]);
    // identity stays the store record's; only color-way data is overlaid
    expect(out.id).toBe('logo_upload');
    expect(out.web_logos).toEqual(liveWls);
    expect(out.color_ways).toEqual(liveCws);
    expect(autoColorChoice(out, 'White')).toMatchObject({ kind: 'variant', url: 'light.png', colorWayId: 'cw_l' });
    expect(autoColorChoice(out, 'True Royal')).toMatchObject({ kind: 'variant', url: 'royal.png', colorWayId: 'cw_r' });
  });
  test('never regresses a store record that has richer web logos than the live copy', () => {
    const snapshot = { id: 's1', name: 'Crest', deco_type: 'screen_print', web_logos: liveWls, color_ways: liveCws };
    const emptyLive = { id: 's1', name: 'Crest', deco_type: 'screen_print', web_logos: [], color_ways: [] };
    const [out] = hydrateStoreArt([snapshot], [emptyLive]);
    expect(out.web_logos).toEqual(liveWls);
    expect(out.color_ways).toEqual(liveCws);
  });
  test('no name match across different deco methods; no live copy leaves the snapshot as-is', () => {
    const snapshot = { id: 'a2', name: 'Crest', deco_type: 'screen_print', web_logo_url: 'orig.png' };
    const emb = { id: 'a_emb', name: 'Crest', deco_type: 'embroidery', web_logos: liveWls };
    expect(hydrateStoreArt([snapshot], [emb])[0]).toEqual(snapshot);
    expect(hydrateStoreArt([snapshot], [])[0]).toEqual(snapshot);
    expect(hydrateStoreArt(null, null)).toEqual([]);
  });
});

describe('garmentHex', () => {
  test('known colors map to their swatch', () => {
    expect(garmentHex('Black')).toBe('#111827');
    expect(garmentHex('White')).toBe('#ffffff');
    expect(garmentHex('Navy')).toBe('#1f2a44');
    expect(garmentHex('red')).toBe('#dc2626');
  });
  test('a word inside the name resolves (Heather Charcoal → charcoal)', () => {
    expect(garmentHex('Heather Charcoal')).toBe('#374151');
    expect(garmentHex('Forest Green')).toBe('#14532d');
  });
  test('unknown names fall back to a neutral by brightness', () => {
    expect(garmentHex('Zorptown')).toBe('#e5e7eb');   // unknown + not dark → light neutral
    expect(garmentHex('Dark Zone')).toBe('#1f2937');  // unknown but reads dark → dark neutral
    expect(garmentHex('')).toBe('#e5e7eb');
  });
});

describe('garmentIsDark', () => {
  test('luminance catches colors the word list misses (Red is dark, Grey is light)', () => {
    expect(garmentIsDark('Red')).toBe(true);
    expect(garmentIsDark('Orange')).toBe(true);
    expect(garmentIsDark('Grey')).toBe(false);
    expect(garmentIsDark('Gold')).toBe(false);
  });
  test('obvious cases', () => {
    ['Black', 'Navy', 'Maroon', 'Forest'].forEach((c) => expect(garmentIsDark(c)).toBe(true));
    ['White', 'Silver', 'Vegas Gold', 'Natural'].forEach((c) => expect(garmentIsDark(c)).toBe(false));
  });
  test('unknown names fall back to the word heuristic', () => {
    expect(garmentIsDark('Darkish')).toBe(true);
    expect(garmentIsDark('Zorptown')).toBe(false);
  });
});

describe('garmentTypeOf', () => {
  test('classifies common product names', () => {
    expect(garmentTypeOf('Adidas Fleece Hood ROYBLU/WHITE')).toBe('hoodie');
    expect(garmentTypeOf('M Team 1/4 Zip')).toBe('quarter_zip');
    expect(garmentTypeOf('Sport Polo')).toBe('polo');
    expect(garmentTypeOf('Unisex Pregame Tee')).toBe('tee');
    expect(garmentTypeOf('Long Sleeve Shooter Shirt')).toBe('long_sleeve');
    expect(garmentTypeOf('Crewneck Sweatshirt')).toBe('crew');
    expect(garmentTypeOf('Volleyball Jersey')).toBe('jersey');
    expect(garmentTypeOf('Woven Short')).toBe('shorts');
    expect(garmentTypeOf('Team Jogger Pant')).toBe('pants');
    expect(garmentTypeOf('Richardson 112 Trucker Hat')).toBe('hat');
    expect(garmentTypeOf('Team Backpack')).toBe('bag');
  });
  test('specific beats general: a hooded long sleeve is a hoodie', () => {
    expect(garmentTypeOf('Hooded Long Sleeve Tee')).toBe('hoodie');
  });
  test('unknown → other', () => {
    expect(garmentTypeOf('Gadget Widget')).toBe('other');
    expect(garmentTypeOf('')).toBe('other');
  });
});

describe('guessDarkColor', () => {
  test('dark colors (incl. Navy/Maroon/Forest) → true; light → false', () => {
    ['Black', 'Navy', 'Maroon', 'Forest Green', 'Heather Charcoal'].forEach((c) => expect(guessDarkColor(c)).toBe(true));
    ['White', 'Natural', 'Vegas Gold', 'Silver', 'Ash', ''].forEach((c) => expect(guessDarkColor(c)).toBe(false));
  });
});

describe('autoColorChoice', () => {
  const cws = [{ id: 'cw_d', garment_color: 'Black' }, { id: 'cw_l', garment_color: 'White' }];
  const twoVariant = {
    color_ways: cws,
    web_logos: [
      { url: 'lightlogo.png', color_way: 'Black', color_way_id: 'cw_d' }, // for dark garments
      { url: 'darklogo.png', color_way: 'White', color_way_id: 'cw_l' },  // for light garments
    ],
  };

  test('exact color-word match wins and carries the color way', () => {
    expect(autoColorChoice(twoVariant, 'Black')).toEqual({ kind: 'variant', url: 'lightlogo.png', colorWayId: 'cw_d', label: 'Black' });
    expect(autoColorChoice(twoVariant, 'White')).toEqual({ kind: 'variant', url: 'darklogo.png', colorWayId: 'cw_l', label: 'White' });
  });

  test('no name match → brightness picks the variant meant for that garment brightness (the Navy case)', () => {
    // Navy is dark and shares no word with "Black"/"White"; it must still get the
    // dark-garment (light-ink) variant, not fall back to a recolor.
    expect(autoColorChoice(twoVariant, 'Navy')).toMatchObject({ kind: 'variant', url: 'lightlogo.png', colorWayId: 'cw_d' });
    // Ash is light → the light-garment (dark-ink) variant.
    expect(autoColorChoice(twoVariant, 'Ash')).toMatchObject({ kind: 'variant', url: 'darklogo.png', colorWayId: 'cw_l' });
  });

  test('fewer than 2 real variants → recolor by brightness', () => {
    const one = { web_logos: [{ url: 'only.png', color_way: '', is_default: true }] };
    expect(autoColorChoice(one, 'Navy')).toEqual({ kind: 'recolor', choice: 'white' });
    expect(autoColorChoice(one, 'White')).toEqual({ kind: 'recolor', choice: 'original' });
    expect(autoColorChoice(null, 'Black')).toEqual({ kind: 'recolor', choice: 'white' });
  });

  test('legacy label-only variants still resolve (normalizeWebLogos stamps the id)', () => {
    const legacy = { color_ways: cws, web_logos: [{ url: 'a.png', color_way: 'Black' }, { url: 'b.png', color_way: 'White' }] };
    expect(autoColorChoice(legacy, 'Black')).toMatchObject({ kind: 'variant', url: 'a.png', colorWayId: 'cw_d' });
  });

  test('fixed-color methods (embroidery/DTF/sublimation) stay Orig even on dark garments', () => {
    // A single full-color embroidery logo must NOT be recolored to a flat white on a black
    // garment (that turns the mark into a white silhouette). Thread colors are fixed → Orig.
    const emb = { deco_type: 'embroidery', web_logos: [{ url: 'sf.png', color_way: '', is_default: true }] };
    expect(autoColorChoice(emb, 'Black')).toEqual({ kind: 'recolor', choice: 'original' });
    expect(autoColorChoice(emb, 'Navy')).toEqual({ kind: 'recolor', choice: 'original' });
    expect(autoColorChoice({ deco_type: 'dtf', web_logos: [{ url: 'a.png' }] }, 'Black')).toEqual({ kind: 'recolor', choice: 'original' });
    // Screen print is single-ink → still flips to white on a dark garment.
    expect(autoColorChoice({ deco_type: 'screen_print', web_logos: [{ url: 'a.png' }] }, 'Black')).toEqual({ kind: 'recolor', choice: 'white' });
  });

  test('preferOriginal (caller detected a multi-color mark) keeps Orig even for screen print', () => {
    const sp = { deco_type: 'screen_print', web_logos: [{ url: 'a.png' }] };
    expect(autoColorChoice(sp, 'Black', { preferOriginal: true })).toEqual({ kind: 'recolor', choice: 'original' });
    // undefined/false opt → unchanged single-ink behavior.
    expect(autoColorChoice(sp, 'Black', { preferOriginal: false })).toEqual({ kind: 'recolor', choice: 'white' });
    expect(autoColorChoice(sp, 'Black')).toEqual({ kind: 'recolor', choice: 'white' });
  });
});

describe('resolveItemPlacement', () => {
  const preset = { id: 'left_chest', x: 30, y: 28, w: 18 };

  test('no overrides → the preset', () => {
    expect(resolveItemPlacement(preset, {}, {}, 'TEE', 'wp1')).toEqual({ placement: 'left_chest', x: 30, y: 28, w: 18 });
  });

  test('per-style placement layers over the preset for the whole style', () => {
    const byStyle = { TEE: { x: 40, y: 35, w: 22 } };
    expect(resolveItemPlacement(preset, byStyle, {}, 'TEE', 'wp1')).toEqual({ placement: 'left_chest', x: 40, y: 35, w: 22 });
    // a different style is unaffected
    expect(resolveItemPlacement(preset, byStyle, {}, 'HOODIE', 'wp9')).toEqual({ placement: 'left_chest', x: 30, y: 28, w: 18 });
  });

  test('per-garment nudge overrides just that garment, on top of the style placement', () => {
    const byStyle = { TEE: { x: 40, y: 35, w: 22 } };
    const byItem = { wp1: { x: 55 } };
    expect(resolveItemPlacement(preset, byStyle, byItem, 'TEE', 'wp1')).toEqual({ placement: 'left_chest', x: 55, y: 35, w: 22 });
    // sibling color of the same style keeps the style placement
    expect(resolveItemPlacement(preset, byStyle, byItem, 'TEE', 'wp2')).toEqual({ placement: 'left_chest', x: 40, y: 35, w: 22 });
  });
});
