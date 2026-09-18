/* Garment photos for the API-catalog vendors (src/lib/vendorColorwayImages.js).
 *
 * SanMar/S&S/Richardson/Momentec rows are excluded from the client `prod` catalog, and their
 * order lines are saved at STYLE level ('ST850' + 'True Navy') while the photo lives on the
 * per-color row ('ST850-TrueNavy'). These helpers bridge the two. The cases that matter:
 * the anchored sku filter (a bare prefix would match a DIFFERENT style), the flat-over-model
 * preference (a mockup wants the garment, not a model), and the deliberate absence of any
 * wrong-color fallback (the mock canvas becomes the coach's approval artifact).
 */
const {
  API_CATALOG_VENDOR_IDS, isApiCatalogVendor, colorKey,
  styleSkuOrFilter, buildStyleColorwayMap, lookupStyleColorway,
} = require('../lib/vendorColorwayImages');

// A real SanMar row, as the DB holds it today.
const ST850_NAVY = {
  id: 'smb-ST850-TrueNavy', sku: 'ST850-TrueNavy', color: 'True Navy',
  image_front_url: 'https://cdnp.sanmar.com/.../ST850TrueNavyFormFront2.jpg',
  image_flat_front_url: 'https://cdnp.sanmar.com/.../ST850TrueNavyFormFront2.jpg',
  image_back_url: 'https://cdnp.sanmar.com/.../ST850TrueNavyFormBack2.jpg',
  image_flat_back_url: 'https://cdnp.sanmar.com/.../ST850TrueNavyFormBack2.jpg',
};

describe('isApiCatalogVendor', () => {
  test('covers exactly the four vendors dbEngine excludes from the client catalog', () => {
    expect(API_CATALOG_VENDOR_IDS.sort()).toEqual(['v3', 'v4', 'v5', 'v8']);
    ['v3', 'v4', 'v5', 'v8'].forEach((v) => expect(isApiCatalogVendor(v)).toBe(true));
    // adidas (v1) and Under Armour (v2) ARE loaded locally — they must not take this path.
    ['v1', 'v2', '', null, undefined].forEach((v) => expect(isApiCatalogVendor(v)).toBe(false));
  });
});

describe('styleSkuOrFilter', () => {
  test('anchors the separator so a prefix cannot pull in a different style', () => {
    const f = styleSkuOrFilter('ST850');
    expect(f).toBe('sku.eq."ST850",sku.like."ST850-*",sku.like."ST850.*"');
    // The bug this prevents, verified against the live catalog: an unanchored 'DT630*'
    // returns 20 rows spanning DT630, DT6300, DT6302 and DT6303YG — three other garments —
    // where the anchored filter returns DT630's 5 colorways alone.
    expect(f).not.toContain('"ST850*"');
    expect(styleSkuOrFilter('DT630')).toBe('sku.eq."DT630",sku.like."DT630-*",sku.like."DT630.*"');
  });

  test('refuses a sku that would change the filter\'s meaning', () => {
    // Wildcards, quotes and commas are PostgREST syntax, not sku characters.
    ['ST850*', 'ST850%', 'ST8,50', 'ST"850', 'ST 850', '', '   ', null, undefined]
      .forEach((s) => expect(styleSkuOrFilter(s)).toBeNull());
  });

  test('allows the punctuation real skus actually use', () => {
    expect(styleSkuOrFilter('AT101-50')).toContain('sku.eq."AT101-50"');
    expect(styleSkuOrFilter('705A')).toContain('sku.eq."705A"');
    expect(styleSkuOrFilter('PC_90H')).toContain('sku.eq."PC_90H"');
  });
});

describe('buildStyleColorwayMap', () => {
  test('prefers the garment-only flat over model photography, front and back', () => {
    const row = {
      ...ST850_NAVY,
      image_front_url: 'MODEL_front.jpg',
      image_back_url: 'MODEL_back.jpg',
      image_flat_front_url: 'FLAT_front.jpg',
      image_flat_back_url: 'FLAT_back.jpg',
    };
    const hit = lookupStyleColorway(buildStyleColorwayMap([row]), {color: 'True Navy'});
    expect(hit.front).toBe('FLAT_front.jpg');
    expect(hit.back).toBe('FLAT_back.jpg');
  });

  test('falls back to model photography when the vendor published no flat', () => {
    // ~3k SanMar rows and every S&S row have no flat column; a model shot still beats a
    // blank canvas, so it must not be treated as "no image".
    const row = {sku: 'ST850-Ecru', color: 'Ecru', image_front_url: 'MODEL_front.jpg'};
    const hit = lookupStyleColorway(buildStyleColorwayMap([row]), {color: 'Ecru'});
    expect(hit.front).toBe('MODEL_front.jpg');
    expect(hit.back).toBeNull();
  });

  test('reads the in-memory mirror column names too', () => {
    const row = {sku: 'X-Red', color: 'Red', image_url: 'f.jpg', back_image_url: 'b.jpg'};
    const hit = lookupStyleColorway(buildStyleColorwayMap([row]), {color: 'Red'});
    expect(hit).toMatchObject({front: 'f.jpg', back: 'b.jpg'});
  });

  test('skips rows with no front image and rows with no color', () => {
    // The style-level parent row is real: Momentec's '705A' carries color null.
    const map = buildStyleColorwayMap([
      {sku: 'X-Blue', color: 'Blue', image_back_url: 'b.jpg'},   // back only
      {sku: '705A', color: null, image_front_url: 'f.jpg'},      // style-level parent row
      null,
    ]);
    expect(map).toEqual({});
  });

  test('the first row wins per color, as Array.find does everywhere else', () => {
    const map = buildStyleColorwayMap([
      {sku: 'AT101-50', color: 'Black/ White', image_front_url: 'first.jpg'},
      {sku: 'AT101-BLACK-WHITE', color: 'Black/ White', image_front_url: 'second.jpg'},
    ]);
    expect(lookupStyleColorway(map, {color: 'Black/ White'}).front).toBe('first.jpg');
  });

  test('carries the row id so an uploaded photo can be written back to it', () => {
    const hit = lookupStyleColorway(buildStyleColorwayMap([ST850_NAVY]), {color: 'True Navy'});
    expect(hit.id).toBe('smb-ST850-TrueNavy');
    expect(hit.sku).toBe('ST850-TrueNavy');
  });

  test('tolerates the ways a color is spelled on the line vs in the catalog', () => {
    const map = buildStyleColorwayMap([
      {sku: 'ST850-TrueNavy', color: 'True Navy', image_front_url: 'navy.jpg'},
      {sku: 'AT101-50', color: 'Black/ White', image_front_url: 'bw.jpg'},
    ]);
    ['True Navy', 'TrueNavy', 'true navy', '  TRUE  NAVY '].forEach((c) =>
      expect(lookupStyleColorway(map, {color: c}).front).toBe('navy.jpg'));
    ['Black/ White', 'Black/White', 'black / white'].forEach((c) =>
      expect(lookupStyleColorway(map, {color: c}).front).toBe('bw.jpg'));
    expect(colorKey('True Navy')).toBe(colorKey('TrueNavy'));
  });
});

describe('lookupStyleColorway', () => {
  const map = buildStyleColorwayMap([ST850_NAVY]);

  test('never substitutes another colorway of the same style', () => {
    // The mock canvas is exported as the coach's approval artifact: a navy photo standing in
    // for True Red would ship an approved mockup of the wrong garment color.
    expect(lookupStyleColorway(map, {color: 'True Red'})).toBeNull();
    expect(lookupStyleColorway(map, {color: ''})).toBeNull();
    expect(lookupStyleColorway(map, {})).toBeNull();
  });

  test('returns null rather than throwing on missing inputs', () => {
    expect(lookupStyleColorway(null, {color: 'True Navy'})).toBeNull();
    expect(lookupStyleColorway(map, null)).toBeNull();
  });
});

describe('abbreviated color names (SanMar feed vs catalog spelling)', () => {
  // Every pair below is a REAL line/catalog pair from the orders in this database, taken
  // from an audit of all 70 non-exact matches across 736 distinct garments (all 70 correct).
  const REAL_PAIRS = [
    ['DkLavender', 'Dark Lavender'], ['HtdChar', 'Heathered Charcoal'],
    ['HthrGray', 'Heather Gray'], ['VtgWhite', 'Vintage White'],
    ['GdnaW/Grvl', 'Gardenia White/ Gravel'], ['HtGrey/Blk', 'Heather Grey/ Black'],
    ['Wh/Bk/GsGy', 'White/ Black/ Gusty Grey'], ['FanDkGreen', 'Fan Dark Green'],
    ['GphHeather', 'Graphite Heather'], ['GryConHthr', 'Grey Concrete Heather'],
    ['Marshmllw', 'Marshmallow'], ['CooBlue', 'Cool Blue'],
    ['Navy Fr/Gry Fr', 'Navy Frost/ Grey Frost'], ['Deep Navy/DkCh', 'Deep Navy/ Dark Charcoal'],
    ['Athletic Ht', 'Athletic Heather'], ['Blk/White', 'Black/ White'],
    ['Royal Blue', 'Royal'], ['Navy', 'True Navy'], ['Black (Solid)', 'Solid Black'],
    ['Black/White (KB9093)', 'Black/ White'],
  ];

  test.each(REAL_PAIRS)('resolves line color %s to catalog color %s', (lineColor, catalogColor) => {
    const map = buildStyleColorwayMap([{sku: 'X-1', color: catalogColor, image_front_url: 'right.jpg'}]);
    expect(lookupStyleColorway(map, {color: lineColor})).toMatchObject({front: 'right.jpg'});
  });

  test('an exact match always beats a near one', () => {
    const map = buildStyleColorwayMap([
      {sku: 'X-1', color: 'Heathered Charcoal', image_front_url: 'heathered.jpg'},
      {sku: 'X-2', color: 'Charcoal', image_front_url: 'plain.jpg'},
    ]);
    expect(lookupStyleColorway(map, {color: 'Charcoal'}).front).toBe('plain.jpg');
    expect(lookupStyleColorway(map, {color: 'HtdChar'}).front).toBe('heathered.jpg');
  });

  test('refuses to guess when two colors are equally close', () => {
    // 'Red' reads as an abbreviation of BOTH — a coin flip here puts the wrong garment on an
    // approval mockup, so the tie must resolve to nothing.
    const map = buildStyleColorwayMap([
      {sku: 'X-1', color: 'Red Frost', image_front_url: 'frost.jpg'},
      {sku: 'X-2', color: 'Deep Red', image_front_url: 'deep.jpg'},
    ]);
    expect(lookupStyleColorway(map, {color: 'Red'})).toBeNull();
  });

  test('never matches a plainly different color', () => {
    const map = buildStyleColorwayMap([
      {sku: 'X-1', color: 'White', image_front_url: 'white.jpg'},
      {sku: 'X-2', color: 'Forest Green', image_front_url: 'green.jpg'},
    ]);
    ['Black', 'Navy', 'Maroon', 'Vegas Gold'].forEach((c) =>
      expect(lookupStyleColorway(map, {color: c})).toBeNull());
  });

  test('a known color with no photo yields null, not a near-spelled different color', () => {
    // The style genuinely stocks plain Red; the catalog just has no photo on that row. Falling
    // through to 'Red Frost' would mock a Red order in Red Frost.
    const map = buildStyleColorwayMap([
      {sku: 'X-1', color: 'Red', image_front_url: null},
      {sku: 'X-2', color: 'Red Frost', image_front_url: 'frost.jpg'},
    ]);
    expect(lookupStyleColorway(map, {color: 'Red'})).toBeNull();
    // ...but the color that DOES have a photo still resolves.
    expect(lookupStyleColorway(map, {color: 'Red Frost'}).front).toBe('frost.jpg');
  });

  test('a two-letter code cannot match a long color name', () => {
    const map = buildStyleColorwayMap([{sku: 'X-1', color: 'Burnt Orange Heather', image_front_url: 'o.jpg'}]);
    expect(lookupStyleColorway(map, {color: 'Bk'})).toBeNull();
  });
});
