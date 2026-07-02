import { planStoreBakes, resolveDecoForColor } from '../lib/mockBake';

const ART = {
  id: 'art1', _srcCustId: 'cust9',
  web_logos: [
    { url: 'white.png', color_way: 'Black', color_way_id: 'cw_dark' },
    { url: 'dark.png', color_way: '', is_default: true },
  ],
};

describe('resolveDecoForColor', () => {
  test('id-keyed cw_by_color pick wins and carries the color way', () => {
    const d = { cw_by_color: { black: { url: 'picked.png', color_way_id: 'cw_dark' } }, art_url: 'placed.png' };
    expect(resolveDecoForColor(d, 'Black', ART)).toEqual({ url: 'picked.png', colorWayId: 'cw_dark' });
  });

  test('legacy bare-url pick still resolves (no CW identity)', () => {
    const d = { cw_by_color: { black: 'legacy.png' }, art_url: 'placed.png' };
    expect(resolveDecoForColor(d, 'Black', ART)).toEqual({ url: 'legacy.png', colorWayId: null });
  });

  test('auto-match by shared color word, then default entry, then art_url', () => {
    const d = { art_url: 'placed.png' };
    expect(resolveDecoForColor(d, 'Heather Black', ART)).toEqual({ url: 'white.png', colorWayId: 'cw_dark' });
    expect(resolveDecoForColor(d, 'Royal', ART)).toEqual({ url: 'dark.png', colorWayId: null });
    expect(resolveDecoForColor(d, 'Royal', null)).toEqual({ url: 'placed.png', colorWayId: null });
  });
});

describe('planStoreBakes', () => {
  const catalog = [
    { id: 'wp1', kind: 'single', sku: 'TEE', image_url: 'tee_black.jpg', decorations: [
      { kind: 'art', art_id: 'art1', art_url: 'placed.png', placement: 'left_chest', side: 'front', x: 30, y: 25, w: 20 },
      { kind: 'perso_number', side: 'back', x: 50, y: 50, w: 30 },
    ] },
    { id: 'wp2', kind: 'single', sku: 'HOODIE', image_url: 'hoodie.jpg', decorations: [] },
    { id: 'wp3', kind: 'bundle', sku: 'KIT', decorations: [{ kind: 'art', art_id: 'art1', art_url: 'x.png' }] },
  ];
  const stockByWp = { wp1: { color: 'Black', image_back_url: 'tee_black_back.jpg' }, wp2: { color: 'Navy' } };

  test('one front task per decorated single; no-deco items, bundles, and perso-only sides skipped', () => {
    const tasks = planStoreBakes({ catalog, stockByWp, libraryArt: [ART], storeArt: [], defaultCustId: 'custX' });
    expect(tasks).toHaveLength(1);
    const t = tasks[0];
    expect(t).toMatchObject({ key: 'TEE|Black', sku: 'TEE', color: 'Black', side: 'front', garmentUrl: 'tee_black.jpg' });
    expect(t.decos).toEqual([{ url: 'white.png', x: 30, y: 25, w: 20 }]); // per-color web logo, saved placement
    expect(t.writes).toEqual([{ artId: 'art1', custId: 'cust9', colorWayId: 'cw_dark' }]);
  });

  test('back side bakes only when a real art deco sits on the back', () => {
    const cat = [{ id: 'wp1', kind: 'single', sku: 'TEE', image_url: 'f.jpg', decorations: [
      { kind: 'art', art_id: 'art1', art_url: 'placed.png', side: 'back', x: 50, y: 40, w: 40 },
    ] }];
    const tasks = planStoreBakes({ catalog: cat, stockByWp, libraryArt: [ART], storeArt: [], defaultCustId: 'custX' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].side).toBe('back');
    expect(tasks[0].garmentUrl).toBe('tee_black_back.jpg');
  });

  test('placement preset supplies x/y/w when the deco has none; vector-only art is skipped', () => {
    const cat = [{ id: 'wp1', kind: 'single', sku: 'TEE', image_url: 'f.jpg', decorations: [
      { kind: 'art', art_id: 'art1', art_url: 'placed.png', placement: 'left_chest' },
      { kind: 'art', art_id: 'artVec', art_url: 'source.ai' },
    ] }];
    const tasks = planStoreBakes({ catalog: cat, stockByWp, libraryArt: [ART], storeArt: [], defaultCustId: 'custX' });
    expect(tasks).toHaveLength(1);
    const d = tasks[0].decos[0];
    expect(d.x).toBeGreaterThan(0); expect(d.y).toBeGreaterThan(0); expect(d.w).toBeGreaterThan(0);
    expect(tasks[0].decos).toHaveLength(1);
  });

  test('art without a library record bakes nothing to write → task dropped', () => {
    const cat = [{ id: 'wp1', kind: 'single', sku: 'TEE', image_url: 'f.jpg', decorations: [
      { kind: 'art', art_id: 'ghost', art_url: 'ghost.png' },
    ] }];
    expect(planStoreBakes({ catalog: cat, stockByWp, libraryArt: [ART], storeArt: [], defaultCustId: 'custX' })).toHaveLength(0);
  });

  test('store_art snapshot is a valid home when the art is not in libraryArt', () => {
    const cat = [{ id: 'wp1', kind: 'single', sku: 'TEE', image_url: 'f.jpg', decorations: [
      { kind: 'art', art_id: 'art1', art_url: 'placed.png' },
    ] }];
    const tasks = planStoreBakes({ catalog: cat, stockByWp, libraryArt: [], storeArt: [{ ...ART, _srcCustId: undefined }], defaultCustId: 'custX' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].writes[0].custId).toBe('custX'); // falls back to the store's customer
  });
});
