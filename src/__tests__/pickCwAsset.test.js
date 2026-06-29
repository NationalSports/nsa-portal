/* eslint-disable */
/**
 * B1 of the one-process art model: a SINGLE asset resolver keyed on the stable color_way_id.
 * One function resolves both the web logo (cutout placed on a garment color) and the mock
 * (approval proof), with one fallback chain so every surface agrees. Pure — no UI/network.
 */
const { pickCwAsset } = require('../businessLogic');

describe('pickCwAsset — web logo (per color way, color_way_id keyed)', () => {
  const art = {
    web_logos: [
      { url: 'cw1.png', color_way_id: 'cw_1', color_way: 'White on dark' },
      { url: 'cw2.png', color_way_id: 'cw_2', color_way: 'Dark on light' },
      { url: 'default.png', is_default: true },
    ],
    web_logo_url: 'legacy.png',
    preview_url: 'preview.png',
  };

  test('returns the web logo whose color_way_id matches', () => {
    expect(pickCwAsset(art, { kind: 'web_logo', colorWayId: 'cw_2' })).toBe('cw2.png');
  });
  test('falls back to the default (blank/is_default) entry when the CW has no own logo', () => {
    expect(pickCwAsset(art, { kind: 'web_logo', colorWayId: 'cw_99' })).toBe('default.png');
  });
  test('falls back to legacy web_logo_url, then preview_url, when there are no web_logos', () => {
    expect(pickCwAsset({ web_logo_url: 'legacy.png', preview_url: 'p.png' }, { kind: 'web_logo', colorWayId: 'cw_1' })).toBe('legacy.png');
    expect(pickCwAsset({ preview_url: 'p.png' }, { kind: 'web_logo' })).toBe('p.png');
  });
  test('does NOT key off the label string — a label-only (no id) entry is not matched by id', () => {
    const a = { web_logos: [{ url: 'x.png', color_way: 'White on dark' }], web_logo_url: 'legacy.png' };
    // a legacy entry with a label but no color_way_id is neither an id-match nor a blank default,
    // so it falls through to web_logo_url (until B2 backfills its color_way_id). Proves id-keying.
    expect(pickCwAsset(a, { kind: 'web_logo', colorWayId: 'cw_1' })).toBe('legacy.png');
  });
  test('empty when nothing resolves', () => {
    expect(pickCwAsset({}, { kind: 'web_logo', colorWayId: 'cw_1' })).toBe('');
    expect(pickCwAsset(null, { kind: 'web_logo' })).toBe('');
  });
});

describe('pickCwAsset — mock (per garment, CW-tagged never bleeds)', () => {
  const art = {
    item_mockups: {
      'TEE|Black': [{ url: 'tee_black_cw1.png', color_way_id: 'cw_1' }, { url: 'tee_black_plain.png' }],
      'TEE|Red': [{ url: 'tee_red_cw2.png', color_way_id: 'cw_2' }],
    },
    mockup_files: [{ url: 'general.png' }],
  };

  test('returns the per-garment mock tagged with the matching color_way_id', () => {
    expect(pickCwAsset(art, { kind: 'mock', sku: 'TEE', color: 'Black', colorWayId: 'cw_1' })).toBe('tee_black_cw1.png');
  });
  test('a CW-tagged mock does NOT bleed onto a non-matching color way — falls back to untagged', () => {
    // asking for cw_9 on the Black garment: the cw_1 tagged mock must be skipped, untagged used
    expect(pickCwAsset(art, { kind: 'mock', sku: 'TEE', color: 'Black', colorWayId: 'cw_9' })).toBe('tee_black_plain.png');
  });
  test('no untagged available for that CW → empty (never a different CW\'s mock)', () => {
    // Only a cw_2-tagged mock exists and NO untagged fallback; asking for cw_9 must NOT bleed cw_2
    const a = { item_mockups: { 'TEE|Red': [{ url: 'tee_red_cw2.png', color_way_id: 'cw_2' }] } };
    expect(pickCwAsset(a, { kind: 'mock', sku: 'TEE', color: 'Red', colorWayId: 'cw_9' })).toBe('');
  });
  test('no colorWayId → untagged per-garment mock', () => {
    expect(pickCwAsset(art, { kind: 'mock', sku: 'TEE', color: 'Black' })).toBe('tee_black_plain.png');
  });
  test('falls back to the general mockup_files bucket when the item has none', () => {
    expect(pickCwAsset(art, { kind: 'mock', sku: 'HOODIE', color: 'Navy' })).toBe('general.png');
  });
  test('legacy plain-sku item_mockups key still resolves', () => {
    const a = { item_mockups: { TEE: [{ url: 'legacy_sku.png' }] } };
    expect(pickCwAsset(a, { kind: 'mock', sku: 'TEE', color: 'Black' })).toBe('legacy_sku.png');
  });
  test('string-form mock entries are supported', () => {
    const a = { mockup_files: ['plain-string.png'] };
    expect(pickCwAsset(a, { kind: 'mock', sku: 'TEE' })).toBe('plain-string.png');
  });
});
