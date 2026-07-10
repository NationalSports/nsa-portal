/* eslint-disable */
/**
 * NSA Portal — mocks follow the garment (audit 2026-07-10, SO-1480 class)
 *
 * Per-garment mockups and mock links are keyed `sku|color`. A stock-driven SKU swap
 * (JM5228 → KD5416) or a color change used to orphan the mock under the departed key,
 * so the approval gate reported the garment unmocked while the mock sat unreachable.
 *
 *  - rekeyGarmentMocks: in-place sku/color edits MOVE the keys (item_mockups incl.
 *    slot-suffixed and legacy bare-sku buckets, mock_links keys AND targets).
 *  - linkSwappedGarmentMock: copy-style swaps LINK the new garment to the source's
 *    mock via mock_links — same-color only, never inheriting a wrong-colorway mock.
 *
 * SAFE: pure functions from safeHelpers.js only. No DB, no UI, no network.
 */

const { rekeyGarmentMocks, linkSwappedGarmentMock, skusMissingMockups } = require('../safeHelpers');

const mk = (url) => ({ url, name: url.split('/').pop() });

describe('rekeyGarmentMocks — in-place sku/color edit moves the garment keys', () => {
  test('SO-1480: exact sku|color bucket moves to the new key and the gate is satisfied', () => {
    const arts = [{ id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/royal.png')], 'KD2999|Black/White': [mk('http://x/black.png')] } }];
    const out = rekeyGarmentMocks(arts, 'JM5228', 'Royal/White', 'KD5416', 'Royal/White');
    expect(out[0].item_mockups['KD5416|Royal/White']).toHaveLength(1);
    expect(out[0].item_mockups['JM5228|Royal/White']).toBeUndefined();
    expect(out[0].item_mockups['KD2999|Black/White']).toHaveLength(1); // untouched
    // The approval gate now sees the garment as mocked.
    const so = { items: [{ sku: 'KD5416', color: 'Royal/White', decorations: [{ kind: 'art', art_file_id: 'af1' }] }], art_files: out };
    const job = { _art_ids: ['af1'], art_file_id: 'af1', items: [{ item_idx: 0, sku: 'KD5416', color: 'Royal/White' }] };
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('slot-suffixed keys (reversible/numbers slots) move with the base key', () => {
    const arts = [{ id: 'af1', item_mockups: { 'JSY|Navy': [mk('http://x/a.png')], 'JSY|Navy|numbers': [mk('http://x/n.png')], 'JSY|Navy|cw2': [mk('http://x/b.png')] } }];
    const out = rekeyGarmentMocks(arts, 'JSY', 'Navy', 'JSY2', 'Navy');
    expect(Object.keys(out[0].item_mockups).sort()).toEqual(['JSY2|Navy', 'JSY2|Navy|cw2', 'JSY2|Navy|numbers']);
  });

  test('legacy bare-sku bucket re-keys to the new bare sku', () => {
    const arts = [{ id: 'af1', item_mockups: { JM5228: [mk('http://x/legacy.png')] } }];
    const out = rekeyGarmentMocks(arts, 'JM5228', 'Royal/White', 'KD5416', 'Royal/White');
    expect(out[0].item_mockups.KD5416).toHaveLength(1);
    expect(out[0].item_mockups.JM5228).toBeUndefined();
  });

  test('colliding target bucket merges, deduped by url', () => {
    const arts = [{ id: 'af1', item_mockups: {
      'OLD|Red': [mk('http://x/1.png'), mk('http://x/2.png')],
      'NEW|Red': [mk('http://x/2.png'), mk('http://x/3.png')],
    } }];
    const out = rekeyGarmentMocks(arts, 'OLD', 'Red', 'NEW', 'Red');
    const urls = out[0].item_mockups['NEW|Red'].map((f) => f.url).sort();
    expect(urls).toEqual(['http://x/1.png', 'http://x/2.png', 'http://x/3.png']);
  });

  test('mock_links re-key on both sides (member keys and link targets)', () => {
    const arts = [{ id: 'af1', item_mockups: { 'SRC|Black': [mk('http://x/s.png')] }, mock_links: { 'DEP|Black': 'SRC|Black' } }];
    const out = rekeyGarmentMocks(arts, 'SRC', 'Black', 'SRC2', 'Black');
    expect(out[0].mock_links).toEqual({ 'DEP|Black': 'SRC2|Black' });
    const out2 = rekeyGarmentMocks(arts, 'DEP', 'Black', 'DEP2', 'Black');
    expect(out2[0].mock_links).toEqual({ 'DEP2|Black': 'SRC|Black' });
  });

  test('entry-level sku tags follow the rename', () => {
    const arts = [{ id: 'af1', item_mockups: { 'OLD|Red': [{ url: 'http://x/1.png', sku: 'OLD', art_file_id: 'af1' }] } }];
    const out = rekeyGarmentMocks(arts, 'OLD', 'Red', 'NEW', 'Red');
    expect(out[0].item_mockups['NEW|Red'][0].sku).toBe('NEW');
  });

  test('no-op returns the same reference (callers can skip a save)', () => {
    const arts = [{ id: 'af1', item_mockups: { 'OTHER|Blue': [mk('http://x/o.png')] } }];
    expect(rekeyGarmentMocks(arts, 'JM5228', 'Royal/White', 'KD5416', 'Royal/White')).toBe(arts);
    expect(rekeyGarmentMocks(arts, 'A', 'Red', 'A', 'Red')).toBe(arts); // identical key
  });
});

describe('linkSwappedGarmentMock — copy-style swap links the new garment to the source mock', () => {
  const srcItem = { sku: 'JM5228', color: 'Royal/White', decorations: [{ kind: 'art', art_file_id: 'af1' }] };

  test('same-color swap creates the link when the source has a mock', () => {
    const arts = [{ id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/royal.png')] } }];
    const out = linkSwappedGarmentMock(arts, srcItem, 'KD5416', 'Royal/White');
    expect(out[0].mock_links).toEqual({ 'KD5416|Royal/White': 'JM5228|Royal/White' });
    // …and the gate honors the link.
    const so = { items: [
      { sku: 'JM5228', color: 'Royal/White', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
      { sku: 'KD5416', color: 'Royal/White', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
    ], art_files: out };
    const job = { _art_ids: ['af1'], art_file_id: 'af1', items: [{ item_idx: 0 }, { item_idx: 1 }] };
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('a DIFFERENT color never inherits the mock (wrong-colorway guard)', () => {
    const arts = [{ id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/royal.png')] } }];
    expect(linkSwappedGarmentMock(arts, srcItem, 'KD5416', 'Black/White')).toBe(arts);
  });

  test('links flatten to the root source (source itself already linked)', () => {
    const arts = [{ id: 'af1', item_mockups: { 'ROOT|Red': [mk('http://x/r.png')], 'MID|Red': [mk('http://x/m.png')] }, mock_links: { 'MID|Red': 'ROOT|Red' } }];
    const out = linkSwappedGarmentMock(arts, { sku: 'MID', color: 'Red', decorations: [{ kind: 'art', art_file_id: 'af1' }] }, 'NEW', 'Red');
    expect(out[0].mock_links['NEW|Red']).toBe('ROOT|Red');
  });

  test('no link when the source has no mock, the target has its own, or a link already exists', () => {
    const noMock = [{ id: 'af1', item_mockups: {} }];
    expect(linkSwappedGarmentMock(noMock, srcItem, 'KD5416', 'Royal/White')).toBe(noMock);
    const ownMock = [{ id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/a.png')], 'KD5416|Royal/White': [mk('http://x/b.png')] } }];
    expect(linkSwappedGarmentMock(ownMock, srcItem, 'KD5416', 'Royal/White')).toBe(ownMock);
    const linked = [{ id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/a.png')] }, mock_links: { 'KD5416|Royal/White': 'OTHER|Royal/White' } }];
    expect(linkSwappedGarmentMock(linked, srcItem, 'KD5416', 'Royal/White')).toBe(linked);
  });

  test('only art files the source item decorates with are touched', () => {
    const arts = [
      { id: 'af1', item_mockups: { 'JM5228|Royal/White': [mk('http://x/a.png')] } },
      { id: 'af2', item_mockups: { 'JM5228|Royal/White': [mk('http://x/other-design.png')] } },
    ];
    const out = linkSwappedGarmentMock(arts, srcItem, 'KD5416', 'Royal/White');
    expect(out[0].mock_links).toEqual({ 'KD5416|Royal/White': 'JM5228|Royal/White' });
    expect(out[1].mock_links).toBeUndefined();
  });
});
