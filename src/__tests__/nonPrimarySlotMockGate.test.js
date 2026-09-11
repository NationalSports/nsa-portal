// The approval gate must not care WHICH art slot a garment's mockup is filed under.
//
// Slot keys are positional: the first art decoration owns the bare `sku|color` key, later ones get
// `|<colorWayId>` / `|d1`. The gate used to read only the bare key, so a garment mocked on its
// SECOND design was reported as "no garment mockup yet" while that mockup was on screen — with no
// way for the rep to clear it. SO-1998 (Lake SC): IA9145 / IA9155's Left Chest decoration was
// repointed from the patch art to a new DTF art file, stranding the bare-key mock on the old file
// while the live mock sat under `IA9145||d1` on the front-center art.
//
// Shapes below are the real SO-1998 rows (so_art_files / so_items / so_item_decorations / so_jobs).
import { skusMissingMockups, artSlotMocks, mockLinkSourceFiles, mockSlotKeys, garmentMockKey } from '../safeHelpers';

const F = (n) => [{ url: 'https://res.cloudinary.com/x/' + n + '.jpg', name: n + '.jpg' }];

const buildSo = (frontCenterMocks) => {
  const art = [
    // The OLD left-chest art the decorations no longer point at — holds the stranded bare-key mocks.
    { id: 'af-patch', name: 'LAKE SC - LEFT CHEST - PATCH', deco_type: 'heat_press', status: 'approved',
      item_mockups: { 'IA9145|': F('stranded-45'), 'IA9155|': F('stranded-55') }, mock_links: {},
      mockup_files: [], files: [], prod_files: [{ url: 'p.ai', name: 'p.ai' }] },
    { id: 'af-front', name: 'LAKE SC - CENTER CHEST - COLUMBIA, BLACK', deco_type: 'heat_press', status: 'approved',
      item_mockups: frontCenterMocks, mock_links: {},
      mockup_files: [], files: [], prod_files: [{ url: 'f.ai', name: 'f.ai' }] },
    // The NEW left-chest art: no mockups at all, and it carries the IA9155 -> IA9145 mock link.
    { id: 'af-dtf', name: 'LAKE SC - LEFT CHEST - DTF', deco_type: 'heat_press', status: 'waiting_for_art',
      item_mockups: {}, mock_links: { 'IA9155|': 'IA9145|' },
      mockup_files: [], files: [], prod_files: [{ url: 'Lake SC left chest.ai', name: 'Lake SC left chest.ai' }] },
  ];
  const decos = [
    { kind: 'art', position: 'Left Chest', art_file_id: 'af-dtf' },
    { kind: 'art', position: 'Front Center', art_file_id: 'af-front' },
  ];
  const items = [];
  items[4] = { sku: 'IA9155', color: '', name: 'Adidas Tabela 23 Jersey Youth', decorations: decos };
  items[5] = { sku: 'IA9145', color: '', name: 'Adidas Tabela 23 Jersey', decorations: decos };
  return { so: { id: 'SO-1998', art_files: art, items }, decos };
};

const JOB = {
  id: 'JOB-1998-03', art_file_id: 'af-dtf', _art_ids: ['af-dtf', 'af-front'], art_status: 'waiting_approval',
  items: [{ sku: 'IA9155', item_idx: 4, deco_idxs: [0, 1] }, { sku: 'IA9145', item_idx: 5, deco_idxs: [0, 1] }],
};

// Guard the premise: the front-center design really is the garment's SECOND (discriminated) slot.
test('the front-center design keys its mock to a non-primary slot', () => {
  const { so, decos } = buildSo({});
  const keys = mockSlotKeys(garmentMockKey(so.items[5]), decos);
  expect(keys.map((s) => s.key)).toEqual(['IA9145|', 'IA9145||d1']);
  expect(keys[0].primary).toBe(true);
  expect(keys[1].primary).toBe(false);
});

describe('SO-1998: a mockup filed on the second design satisfies the gate', () => {
  const D1 = { 'IA9145||d1': F('lake-sc-45'), 'IA9155||d1': F('lake-sc-55') };

  test('artSlotMocks finds the mock the bare-key read misses', () => {
    const { so } = buildSo(D1);
    expect(artSlotMocks([so.art_files[2], so.art_files[1]], so.items[5])).toHaveLength(1);
  });

  test('the gate passes — this is the bug SO-1998 hit', () => {
    const { so } = buildSo(D1);
    expect(skusMissingMockups(JOB, so)).toEqual([]);
  });

  test('a mock link to that garment resolves to the non-primary slot', () => {
    const { so } = buildSo(D1);
    // Anchors are the job's art only — the stranded bare-key mock on af-patch is NOT reachable.
    expect(mockLinkSourceFiles([so.art_files[2], so.art_files[1]], 'IA9145|')).toHaveLength(1);
  });

  test('still blocks when the garment has no art-slot mock anywhere', () => {
    const { so } = buildSo({ 'KB4031-LKB|Black/Columbia|d1': F('other-garment') });
    expect(skusMissingMockups(JOB, so)).toEqual(['IA9155', 'IA9145']);
  });

  test('a numbers/names back proof never stands in for the garment mockup', () => {
    const { so } = buildSo({ 'IA9145||numbers': F('back-45'), 'IA9155||names_1': F('back-55') });
    expect(artSlotMocks(so.art_files, so.items[5])).toEqual([]);
    expect(skusMissingMockups(JOB, so)).toEqual(['IA9155', 'IA9145']);
  });

  test('an emptied slot bucket does not resurrect the mock', () => {
    const { so } = buildSo({ 'IA9145||d1': [], 'IA9155||d1': [] });
    expect(skusMissingMockups(JOB, so)).toEqual(['IA9155', 'IA9145']);
  });

  test('the IA9145-only split jobs (JOB-1998-03-S / -07 / -07-S) pass too', () => {
    const { so } = buildSo(D1);
    const splitJob = { id: 'JOB-1998-07', art_file_id: 'af-dtf', _art_ids: ['af-dtf', 'af-front'],
      art_status: 'waiting_approval',
      items: [{ sku: 'IA9145', item_idx: 5, deco_idxs: [0, 1, 2] }] };
    expect(skusMissingMockups(splitJob, so)).toEqual([]);
  });

  test('the primary-key mock still passes (unchanged behavior)', () => {
    const { so } = buildSo({ 'IA9145|': F('lake-sc-45'), 'IA9155|': F('lake-sc-55') });
    expect(skusMissingMockups(JOB, so)).toEqual([]);
  });
});

// A neighbouring garment's key must never be read as this one's: prefix matching is on `base + '|'`.
test('artSlotMocks does not leak across garments that share a SKU prefix', () => {
  const it = { sku: 'IA914', color: '' };
  const art = [{ id: 'a', item_mockups: { 'IA9145||d1': F('not-mine'), 'IA914|Black|d1': F('not-mine-either') } }];
  expect(artSlotMocks(art, it)).toEqual([]);
});
