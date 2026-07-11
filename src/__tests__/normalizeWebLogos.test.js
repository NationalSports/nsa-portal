// Decision 2 re-keying: web_logos[] entries get the stable color_way_id stamped from their
// label match so resolution survives CW renames; blank entries become the is_default entry.
const { normalizeWebLogos, pickCwAsset } = require('../businessLogic');

const CWS = [
  { id: 'cw_dark', garment_color: 'Black', inks: ['White'] },
  { id: 'cw_light', garment_color: 'White', inks: ['Black'] },
];

describe('normalizeWebLogos', () => {
  test('stamps color_way_id from the label match (case-insensitive)', () => {
    const out = normalizeWebLogos([{ url: 'w.png', color_way: 'black' }], CWS);
    expect(out).toEqual([{ url: 'w.png', color_way: 'black', color_way_id: 'cw_dark' }]);
  });

  test('blank-label entry becomes the is_default "all garments" entry', () => {
    const out = normalizeWebLogos([{ url: 'd.png', color_way: '' }], CWS);
    expect(out[0].is_default).toBe(true);
    expect(out[0].color_way_id).toBeUndefined();
  });

  test('already-stamped entries pass through untouched; stale ids re-stamp via label', () => {
    const good = { url: 'a.png', color_way: 'Black', color_way_id: 'cw_dark' };
    expect(normalizeWebLogos([good], CWS)[0]).toBe(good);
    const stale = { url: 'b.png', color_way: 'White', color_way_id: 'cw_deleted' };
    expect(normalizeWebLogos([stale], CWS)[0].color_way_id).toBe('cw_light');
  });

  test('unmatched labels keep their entry (no id), url-less entries drop', () => {
    const out = normalizeWebLogos([{ url: 'x.png', color_way: 'Royal' }, { color_way: 'Black' }], CWS);
    expect(out).toEqual([{ url: 'x.png', color_way: 'Royal' }]);
  });

  test('idempotent: normalizing twice equals normalizing once', () => {
    const once = normalizeWebLogos([{ url: 'w.png', color_way: 'Black' }, { url: 'd.png' }], CWS);
    expect(normalizeWebLogos(once, CWS)).toEqual(once);
  });
});

describe('pickCwAsset — legacy label-keyed entries resolve through the art color_ways', () => {
  test('label-only entry matches when the art carries the CW with that label', () => {
    const art = { color_ways: CWS, web_logos: [{ url: 'black.png', color_way: 'Black' }], web_logo_url: 'legacy.png' };
    expect(pickCwAsset(art, { kind: 'web_logo', colorWayId: 'cw_dark' })).toBe('black.png');
  });

  test('id match still wins over a same-label entry', () => {
    const art = { color_ways: CWS, web_logos: [{ url: 'bylabel.png', color_way: 'Black' }, { url: 'byid.png', color_way_id: 'cw_dark' }] };
    expect(pickCwAsset(art, { kind: 'web_logo', colorWayId: 'cw_dark' })).toBe('byid.png');
  });

  test('no color_ways on the art → label entries cannot resolve, legacy fallback holds', () => {
    const art = { web_logos: [{ url: 'black.png', color_way: 'Black' }], web_logo_url: 'legacy.png' };
    expect(pickCwAsset(art, { kind: 'web_logo', colorWayId: 'cw_dark' })).toBe('legacy.png');
  });
});
