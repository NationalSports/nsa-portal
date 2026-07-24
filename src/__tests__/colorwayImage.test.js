// Colorway image bridging for style-level (Momentec) order lines.
// Momentec lines are saved at style level (sku '705A', color as text) while the photo
// lives on the '{style}.{color}' colorway row. These helpers back-fill the item image.
const { buildColorwayImageMap, lookupColorwayImage } = require('../safeHelpers');

// Mirrors the real 705A "PRACTICE FOOTBALL JERSEY" colorway rows from products.
const ROWS = [
  { sku: '705A.B023', color: 'Vegas Gold', image_front_url: 'https://cdn/705A_B023_front.jpg', image_back_url: 'https://cdn/705A_B023_back.jpg' },
  { sku: '705A.F014', color: 'Royal (ba)', image_front_url: 'https://cdn/705A_F014_front.jpg', image_back_url: 'https://cdn/705A_F014_back.jpg' },
  { sku: '705A.B080', color: 'Black', image_front_url: 'https://cdn/705A_B080_front.jpg', image_back_url: null },
];

describe('buildColorwayImageMap / lookupColorwayImage', () => {
  const map = buildColorwayImageMap(ROWS);

  it('resolves a style-level item to its exact-color colorway image', () => {
    expect(lookupColorwayImage(map, { sku: '705A', color: 'Vegas Gold' })).toEqual({
      front: 'https://cdn/705A_B023_front.jpg', back: 'https://cdn/705A_B023_back.jpg',
    });
    expect(lookupColorwayImage(map, { sku: '705A', color: 'Royal (ba)' }).front)
      .toBe('https://cdn/705A_F014_front.jpg');
  });

  it('matches color case-insensitively and trims whitespace', () => {
    expect(lookupColorwayImage(map, { sku: '705a', color: '  VEGAS GOLD ' }).front)
      .toBe('https://cdn/705A_B023_front.jpg');
  });

  it('falls back to any imaged colorway of the style when the color has no exact match', () => {
    const r = lookupColorwayImage(map, { sku: '705A', color: 'Neon Chartreuse' });
    // Generic = first imaged colorway encountered (B023).
    expect(r.front).toBe('https://cdn/705A_B023_front.jpg');
  });

  it('does NOT bridge a colorway-level sku (it already matches its own product row)', () => {
    expect(lookupColorwayImage(map, { sku: '705A.B023', color: 'Vegas Gold' })).toBeNull();
  });

  it('returns null for a style with no rows in the map, and for empty/absent skus', () => {
    expect(lookupColorwayImage(map, { sku: '999X', color: 'Black' })).toBeNull();
    expect(lookupColorwayImage(map, { sku: '', color: 'Black' })).toBeNull();
    expect(lookupColorwayImage(map, {})).toBeNull();
    expect(lookupColorwayImage(null, { sku: '705A', color: 'Black' })).toBeNull();
  });

  it('carries a null back image through (front-only colorway)', () => {
    expect(lookupColorwayImage(map, { sku: '705A', color: 'Black' })).toEqual({
      front: 'https://cdn/705A_B080_front.jpg', back: null,
    });
  });

  it('skips rows with no front image and accepts in-memory mirror column names', () => {
    const m = buildColorwayImageMap([
      { sku: '810.X1', color: 'Red', image_front_url: null, image_back_url: null }, // skipped
      { sku: '810.X2', color: 'Blue', image_url: 'https://cdn/810_X2_front.jpg', back_image_url: 'https://cdn/810_X2_back.jpg' },
    ]);
    expect(lookupColorwayImage(m, { sku: '810', color: 'Red' }).front).toBe('https://cdn/810_X2_front.jpg'); // generic fallback
    expect(lookupColorwayImage(m, { sku: '810', color: 'Blue' })).toEqual({
      front: 'https://cdn/810_X2_front.jpg', back: 'https://cdn/810_X2_back.jpg',
    });
  });

  it('handles an empty/no-arg row set without throwing', () => {
    expect(buildColorwayImageMap()).toEqual({});
    expect(buildColorwayImageMap([])).toEqual({});
  });
});
