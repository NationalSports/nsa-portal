/* eslint-disable */
/**
 * NSA Portal — Mock-check / reused-art tests
 *
 * SAFE: pure functions from safeHelpers.js only. No DB, no UI, no network.
 *
 * Covers the "previously-approved art reused on a different garment" flow:
 *  - skusMissingMockups must NOT let a mock approved on another garment (via the shared
 *    mockup_files bucket) satisfy a garment that has no per-item mock of its own.
 *  - garmentsNeedingMockCheck surfaces those garments + the prior mock to confirm/redo.
 */

const { skusMissingMockups, garmentsNeedingMockCheck } = require('../safeHelpers');

// Build a job + sales-order pair where one item references one art file.
const makeCase = (artFile, item = { sku: 'A2009', color: 'White' }) => {
  const so = {
    items: [{ ...item, decorations: [{ kind: 'art', art_file_id: artFile.id }] }],
    art_files: [artFile],
  };
  const job = {
    _art_ids: [artFile.id],
    art_file_id: artFile.id,
    items: [{ item_idx: 0, sku: item.sku, color: item.color }],
  };
  return { job, so };
};

describe('skusMissingMockups — garment-aware reuse', () => {
  test('a mock approved on a DIFFERENT garment does not satisfy this garment', () => {
    // Art carries a per-item mock for a Royal tee AND a shared mockup_files bucket.
    const art = {
      id: 'af1',
      item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/royal.png', name: 'royal' }] },
      mockup_files: [{ url: 'http://x/general.png', name: 'gen' }],
    };
    const { job, so } = makeCase(art); // job item is A2009|White
    expect(skusMissingMockups(job, so)).toEqual(['A2009']);
  });

  test('legacy single-design art (general bucket, no per-item mocks) still satisfies any garment', () => {
    const art = { id: 'af3', item_mockups: {}, mockup_files: [{ url: 'http://x/gen.png' }] };
    const { job, so } = makeCase(art);
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('a garment with its own per-item mock is not missing', () => {
    const art = { id: 'af4', item_mockups: { 'A2009|White': [{ url: 'http://x/white.png' }] }, mockup_files: [] };
    const { job, so } = makeCase(art);
    expect(skusMissingMockups(job, so)).toEqual([]);
  });
});

describe('garmentsNeedingMockCheck', () => {
  test('flags a garment whose art was approved on another garment, with the prior mock', () => {
    const art = {
      id: 'af1',
      item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/royal.png', name: 'royal' }] },
      mockup_files: [],
    };
    const { job, so } = makeCase(art);
    const res = garmentsNeedingMockCheck(job, so);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({
      sku: 'A2009',
      color: 'White',
      from: 'TEE-1|Royal',
      art_file_id: 'af1',
      otherCount: 0,
    });
    expect(res[0].mocks).toEqual([{ url: 'http://x/royal.png', name: 'royal' }]);
  });

  test('does NOT flag when the garment already has its own mock', () => {
    const art = {
      id: 'af2',
      item_mockups: {
        'A2009|White': [{ url: 'http://x/white.png' }],
        'TEE-1|Royal': [{ url: 'http://x/royal.png' }],
      },
    };
    const { job, so } = makeCase(art);
    expect(garmentsNeedingMockCheck(job, so)).toEqual([]);
  });

  test('does NOT flag legacy art with only a shared mockup_files bucket', () => {
    const art = { id: 'af3', item_mockups: {}, mockup_files: [{ url: 'http://x/gen.png' }] };
    const { job, so } = makeCase(art);
    expect(garmentsNeedingMockCheck(job, so)).toEqual([]);
  });

  test('picks the source garment with the most mock files and counts the rest', () => {
    const art = {
      id: 'af5',
      item_mockups: {
        'TEE-1|Royal': [{ url: 'http://x/royal-front.png' }, { url: 'http://x/royal-back.png' }],
        'TEE-2|Navy': [{ url: 'http://x/navy.png' }],
      },
    };
    const { job, so } = makeCase(art);
    const res = garmentsNeedingMockCheck(job, so);
    expect(res).toHaveLength(1);
    expect(res[0].from).toBe('TEE-1|Royal');
    expect(res[0].mocks).toHaveLength(2);
    expect(res[0].otherCount).toBe(1);
  });

  test('treats a color-way sub-key (sku|color|cwid) as this garment having its own mock', () => {
    const art = {
      id: 'af6',
      item_mockups: { 'A2009|White|cw_2': [{ url: 'http://x/white-cw2.png' }] },
    };
    const { job, so } = makeCase(art);
    expect(garmentsNeedingMockCheck(job, so)).toEqual([]);
  });
});
