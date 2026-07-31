/* eslint-disable */
/**
 * NSA Portal — mock removal is scoped to one garment on the job's own art files (SO-1023 class)
 *
 * The SO-page "×" on a mockup card lived in a single garment's card inside a single job's panel,
 * but removeMockupUrl stripped the image BY URL from every art file and every item_mockups key on
 * the whole order. Because confirming a reused mock copies the SAME url onto several garments,
 * removing one garment's mock silently wiped the identical image off sibling garments/jobs that
 * reused it — reverting their "Check Mock". On SO-1023 the Friars / 2 Col / Attack Everything jobs
 * share the JX4452 blank; clearing a mock under one emptied another's per-garment mocks.
 *
 * removeMockFromArtFiles scopes the strip to { sku, color, artFileIds } — this garment's mock keys
 * on the art files the acting job owns — so a removal can't reach a sibling job's art file.
 *
 * SAFE: pure function from safeHelpers.js only. No DB, no UI, no network.
 */

const { removeMockFromArtFiles } = require('../safeHelpers');

const mk = (url) => ({ url, name: url.split('/').pop() });

describe('removeMockFromArtFiles — scoped mock removal', () => {
  // The SO-1023 shape: two art files (two jobs) sharing the JX4452|Black,White garment. The Friars
  // art also carries a KV2196 mock; the reused image `shared.png` was confirmed onto both jobs' JX4452.
  const scenario = () => [
    { id: 'friars', item_mockups: {
      'JN0400|Black': [mk('http://x/jn0400.png')],
      'KV2196|Black': [mk('http://x/shared.png')],
      'JX4452|Black,White': [mk('http://x/shared.png')],
    } },
    { id: 'attack', item_mockups: {
      'JX4455|Heather Grey': [mk('http://x/grey.png')],
      'JX4452|Black,White': [mk('http://x/shared.png')],
    } },
  ];

  test('removing the Attack job\'s JX4452 mock leaves the Friars art file untouched', () => {
    const out = removeMockFromArtFiles(scenario(), 'http://x/shared.png',
      { sku: 'JX4452', color: 'Black,White', artFileIds: ['attack'] });
    const friars = out.find(a => a.id === 'friars');
    const attack = out.find(a => a.id === 'attack');
    // Attack's own JX4452 mock is cleared...
    expect(attack.item_mockups['JX4452|Black,White']).toEqual([]);
    // ...but the Friars job's mocks (different art file) are FULLY intact — the regression this fixes.
    expect(friars.item_mockups['JX4452|Black,White']).toHaveLength(1);
    expect(friars.item_mockups['KV2196|Black']).toHaveLength(1);
    expect(friars.item_mockups['JN0400|Black']).toHaveLength(1);
  });

  test('removal is scoped to the target garment — a sibling garment on the SAME art file keeps its mock', () => {
    const out = removeMockFromArtFiles(scenario(), 'http://x/shared.png',
      { sku: 'JX4452', color: 'Black,White', artFileIds: ['friars'] });
    const friars = out.find(a => a.id === 'friars');
    expect(friars.item_mockups['JX4452|Black,White']).toEqual([]); // target cleared
    expect(friars.item_mockups['KV2196|Black']).toHaveLength(1);    // sibling garment, same url, untouched
  });

  test('color-way / slot sub-keys of the target garment are cleared; bare-sku legacy bucket too', () => {
    const arts = [{ id: 'af1', item_mockups: {
      'JX4452|Black,White': [mk('http://x/u.png')],
      'JX4452|Black,White|cw123': [mk('http://x/u.png')], // color-way sub-slot
      'JX4452': [mk('http://x/u.png')],                    // legacy bare sku
      'OTHER|Black': [mk('http://x/u.png')],               // different garment — must survive
    } }];
    const out = removeMockFromArtFiles(arts, 'http://x/u.png',
      { sku: 'JX4452', color: 'Black,White', artFileIds: ['af1'] });
    const im = out[0].item_mockups;
    expect(im['JX4452|Black,White']).toEqual([]);
    expect(im['JX4452|Black,White|cw123']).toEqual([]);
    expect(im['JX4452']).toEqual([]);
    expect(im['OTHER|Black']).toHaveLength(1); // untouched
  });

  test('mockup_files (design-level bucket) is stripped only within the scoped art files', () => {
    const arts = [
      { id: 'attack', item_mockups: {}, mockup_files: [mk('http://x/shared.png')] },
      { id: 'friars', item_mockups: {}, mockup_files: [mk('http://x/shared.png')] },
    ];
    const out = removeMockFromArtFiles(arts, 'http://x/shared.png',
      { sku: 'JX4452', color: 'Black,White', artFileIds: ['attack'] });
    expect(out.find(a => a.id === 'attack').mockup_files).toEqual([]);
    expect(out.find(a => a.id === 'friars').mockup_files).toHaveLength(1); // other art file untouched
  });

  test('unchanged art files keep referential identity (no needless rewrites)', () => {
    const input = scenario();
    const out = removeMockFromArtFiles(input, 'http://x/shared.png',
      { sku: 'JX4452', color: 'Black,White', artFileIds: ['attack'] });
    expect(out.find(a => a.id === 'friars')).toBe(input.find(a => a.id === 'friars')); // same ref
  });

  test('no url is a no-op; missing scope falls back to legacy order-wide strip', () => {
    expect(removeMockFromArtFiles(scenario(), '')).toEqual(scenario());
    // No scope → every art file, every key (defensive legacy behavior).
    const out = removeMockFromArtFiles(scenario(), 'http://x/shared.png');
    expect(out.find(a => a.id === 'friars').item_mockups['JX4452|Black,White']).toEqual([]);
    expect(out.find(a => a.id === 'attack').item_mockups['JX4452|Black,White']).toEqual([]);
  });
});
