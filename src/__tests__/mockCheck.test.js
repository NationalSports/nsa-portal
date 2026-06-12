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

const { skusMissingMockups, garmentsNeedingMockCheck, resolveMockLink, mockLinkDependents } = require('../safeHelpers');

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

describe('skusMissingMockups — stale job snapshot after a line-item swap', () => {
  // Repro for the reported bug: a line item's product was swapped (A325 → A515) but
  // so.jobs was never rebuilt, so job.items[].sku still says A325 while the live SO
  // line — and its approved mock — are A515. The gate must follow the live line.
  test('a swapped item satisfied by a mock on its LIVE sku is not reported missing', () => {
    const art = { id: 'af1', item_mockups: { 'A515|Black': [{ url: 'http://x/a515.png' }] }, mockup_files: [] };
    const so = {
      items: [{ sku: 'A515', color: 'Black', decorations: [{ kind: 'art', art_file_id: 'af1' }] }],
      art_files: [art],
    };
    const job = { _art_ids: ['af1'], art_file_id: 'af1', items: [{ item_idx: 0, sku: 'A325', color: 'Black/White' }] };
    expect(skusMissingMockups(job, so)).toEqual([]);
  });

  test('a genuinely un-mocked swapped item is reported under its LIVE sku, not the stale one', () => {
    const art = { id: 'af2', item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/royal.png' }] }, mockup_files: [] };
    const so = {
      items: [{ sku: 'A515', color: 'Black', decorations: [{ kind: 'art', art_file_id: 'af2' }] }],
      art_files: [art],
    };
    const job = { _art_ids: ['af2'], art_file_id: 'af2', items: [{ item_idx: 0, sku: 'A325', color: 'Black/White' }] };
    expect(skusMissingMockups(job, so)).toEqual(['A515']);
  });

  test('a job item whose live SO line was deleted is skipped, not reported missing', () => {
    const art = { id: 'af3', item_mockups: { 'A2009|White': [{ url: 'http://x/w.png' }] }, mockup_files: [] };
    const so = { items: [], art_files: [art] }; // the line at item_idx 0 no longer exists
    const job = { _art_ids: ['af3'], art_file_id: 'af3', items: [{ item_idx: 0, sku: 'A325', color: 'Black' }] };
    expect(skusMissingMockups(job, so)).toEqual([]);
  });
});

describe('mock links — "use the same mockup as that garment"', () => {
  // Three polos on one embroidery design; garments can be linked to another's mock.
  const threePoloSO = (art) => ({
    items: [
      { sku: 'P1', color: 'Black', decorations: [{ kind: 'art', art_file_id: art.id }] },
      { sku: 'P2', color: 'Black', decorations: [{ kind: 'art', art_file_id: art.id }] },
      { sku: 'P3', color: 'Black', decorations: [{ kind: 'art', art_file_id: art.id }] },
    ],
    art_files: [art],
  });
  const threePoloJob = (art) => ({
    _art_ids: [art.id], art_file_id: art.id,
    items: [
      { item_idx: 0, sku: 'P1', color: 'Black' },
      { item_idx: 1, sku: 'P2', color: 'Black' },
      { item_idx: 2, sku: 'P3', color: 'Black' },
    ],
  });

  test('default (no links) keeps per-garment behavior — every un-mocked garment is missing', () => {
    const art = { id: 'af0', item_mockups: { 'P1|Black': [{ url: 'http://x/p1.png' }] }, mockup_files: [] };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art))).toEqual(['P2', 'P3']);
  });

  test("linked garments are satisfied by the source garment's mock", () => {
    const art = {
      id: 'af1',
      item_mockups: { 'P1|Black': [{ url: 'http://x/p1.png' }] },
      mock_links: { 'P2|Black': 'P1|Black', 'P3|Black': 'P1|Black' },
      mockup_files: [],
    };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art))).toEqual([]);
  });

  test('a link to a source with NO mock blocks the linked garment AND the source', () => {
    const art = { id: 'af2', item_mockups: {}, mock_links: { 'P2|Black': 'P1|Black' }, mockup_files: [] };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art)).sort()).toEqual(['P1', 'P2', 'P3']);
  });

  test('a partial link: linked garment satisfied, the unlinked one still needs its own mock', () => {
    const art = {
      id: 'af3',
      item_mockups: { 'P1|Black': [{ url: 'http://x/p1.png' }] },
      mock_links: { 'P2|Black': 'P1|Black' },
      mockup_files: [],
    };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art))).toEqual(['P3']);
  });

  test("a linked garment's own per-item mock is ignored — the source decides", () => {
    // P2 has its own mock but is linked to P1 which has none → P2 still missing.
    const art = {
      id: 'af4',
      item_mockups: { 'P2|Black': [{ url: 'http://x/p2.png' }] },
      mock_links: { 'P2|Black': 'P1|Black' },
      mockup_files: [],
    };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art)).sort()).toEqual(['P1', 'P2', 'P3']);
  });

  test('source lookup accepts the legacy bare-sku bucket', () => {
    const art = { id: 'af5', item_mockups: { P1: [{ url: 'http://x/p1.png' }] }, mock_links: { 'P2|Black': 'P1|Black' }, mockup_files: [] };
    expect(skusMissingMockups(threePoloJob(art), threePoloSO(art))).toEqual(['P3']);
  });

  test('garmentsNeedingMockCheck never flags a linked garment', () => {
    const art = {
      id: 'af6',
      item_mockups: { 'P1|Black': [{ url: 'http://x/p1.png' }] }, // would flag P2/P3 as reuse candidates
      mock_links: { 'P2|Black': 'P1|Black', 'P3|Black': 'P1|Black' },
    };
    expect(garmentsNeedingMockCheck(threePoloJob(art), threePoloSO(art))).toEqual([]);
  });

  test('resolveMockLink follows chains, guards cycles, and returns null when unlinked', () => {
    const art = { id: 'af7', mock_links: { 'P3|Black': 'P2|Black', 'P2|Black': 'P1|Black' } };
    expect(resolveMockLink([art], 'P3', 'Black')).toBe('P1|Black'); // chain flattened on read
    expect(resolveMockLink([art], 'P2', 'Black')).toBe('P1|Black');
    expect(resolveMockLink([art], 'P1', 'Black')).toBeNull();
    const cyc = { id: 'af8', mock_links: { 'A|X': 'B|X', 'B|X': 'A|X' } };
    expect(resolveMockLink([cyc], 'A', 'X')).toBe('B|X'); // terminates, last distinct hop
    expect(resolveMockLink([null, undefined, art], 'P2', 'Black')).toBe('P1|Black');
  });

  test('mockLinkDependents lists the garments pointing at a source', () => {
    const art = { id: 'af9', mock_links: { 'P2|Black': 'P1|Black', 'P3|Black': 'P1|Black' } };
    expect(mockLinkDependents([art], 'P1', 'Black').sort()).toEqual(['P2|Black', 'P3|Black']);
    expect(mockLinkDependents([art], 'P2', 'Black')).toEqual([]);
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
    expect(res[0]).toMatchObject({ sku: 'A2009', color: 'White' });
    expect(res[0].artFiles).toHaveLength(1);
    expect(res[0].artFiles[0].art_file_id).toBe('af1');
    expect(res[0].artFiles[0].groups).toHaveLength(1);
    expect(res[0].artFiles[0].groups[0]).toMatchObject({ from: 'TEE-1|Royal' });
    expect(res[0].artFiles[0].groups[0].files).toEqual([{ url: 'http://x/royal.png', name: 'royal' }]);
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

  test('groups prior mocks by source garment, most files first, so the rep can pick which one', () => {
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
    const groups = res[0].artFiles[0].groups;
    expect(groups).toHaveLength(2);
    expect(groups[0].from).toBe('TEE-1|Royal');
    expect(groups[0].files).toHaveLength(2);
    expect(groups[1].from).toBe('TEE-2|Navy');
    expect(groups[1].files).toHaveLength(1);
  });

  test('shows BOTH art files when a garment is decorated by two designs', () => {
    const front = { id: 'af-f', name: 'Front Crest', item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/f.png' }] } };
    const back = { id: 'af-b', name: 'Back Logo', item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/b.png' }] } };
    const so = {
      items: [{ sku: 'A2009', color: 'White', decorations: [{ kind: 'art', art_file_id: 'af-f' }, { kind: 'art', art_file_id: 'af-b' }] }],
      art_files: [front, back],
    };
    const job = { _art_ids: ['af-f', 'af-b'], art_file_id: 'af-f', items: [{ item_idx: 0, sku: 'A2009', color: 'White' }] };
    const res = garmentsNeedingMockCheck(job, so);
    expect(res).toHaveLength(1);
    expect(res[0].artFiles).toHaveLength(2);
    expect(res[0].artFiles.map(a => a.art_file_id).sort()).toEqual(['af-b', 'af-f']);
    expect(res[0].artFiles.map(a => a.art_name).sort()).toEqual(['Back Logo', 'Front Crest']);
  });

  test('flags only the un-mocked design when one of two art files already has its own mock', () => {
    const front = { id: 'af-f', name: 'Front', item_mockups: { 'A2009|White': [{ url: 'http://x/f-white.png' }] } };
    const back = { id: 'af-b', name: 'Back', item_mockups: { 'TEE-1|Royal': [{ url: 'http://x/b-royal.png' }] } };
    const so = {
      items: [{ sku: 'A2009', color: 'White', decorations: [{ kind: 'art', art_file_id: 'af-f' }, { kind: 'art', art_file_id: 'af-b' }] }],
      art_files: [front, back],
    };
    const job = { _art_ids: ['af-f', 'af-b'], art_file_id: 'af-f', items: [{ item_idx: 0, sku: 'A2009', color: 'White' }] };
    const res = garmentsNeedingMockCheck(job, so);
    expect(res).toHaveLength(1);
    expect(res[0].artFiles).toHaveLength(1);
    expect(res[0].artFiles[0].art_file_id).toBe('af-b');
  });

  test('surfaces prior mocks supplied for the SAME artwork (name||deco) when this copy is empty', () => {
    // This order's copy has no mocks; the approved per-garment mocks were fetched from a prior
    // order and passed in keyed by name||deco_type.
    const here = { id: 'af-here', name: 'Dolphin Football 1 Color', deco_type: 'screen_print', item_mockups: {} };
    const { job, so } = makeCase(here); // job item A2009|White referencing af-here
    const priorByArtKey = {
      'dolphin football 1 color||screen_print': [
        { from: 'KB0116|White (KB0116)', files: [{ url: 'http://x/white.png' }] },
        { from: 'JW6602|Black (JW6602)', files: [{ url: 'http://x/black.png' }] },
      ],
    };
    const res = garmentsNeedingMockCheck(job, so, priorByArtKey);
    expect(res).toHaveLength(1);
    expect(res[0].artFiles).toHaveLength(1);
    expect(res[0].artFiles[0].art_file_id).toBe('af-here'); // mocks get applied to THIS order's art file
    expect(res[0].artFiles[0].groups.map(g => g.from).sort())
      .toEqual(['JW6602|Black (JW6602)', 'KB0116|White (KB0116)']);
  });

  test('ignores prior mocks keyed under a different artwork (name||deco)', () => {
    const here = { id: 'af-here', name: 'Dolphin Football 1 Color', deco_type: 'screen_print', item_mockups: {} };
    const { job, so } = makeCase(here);
    const priorByArtKey = { 'totally different logo||screen_print': [{ from: 'KB0116|White', files: [{ url: 'http://x/w.png' }] }] };
    expect(garmentsNeedingMockCheck(job, so, priorByArtKey)).toEqual([]);
  });

  test('does NOT flag when there are no prior per-garment mocks for this artwork', () => {
    const here = { id: 'af-here', name: 'Dolphin Football 1 Color', deco_type: 'screen_print', item_mockups: {} };
    const { job, so } = makeCase(here);
    expect(garmentsNeedingMockCheck(job, so, {})).toEqual([]);
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
