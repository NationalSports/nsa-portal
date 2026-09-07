/**
 * Approval actions must re-resolve an open modal's job from the live order. SO-2199's modal was
 * opened while JOB-2199-01 still declared three designs; a by-SKU split then moved the backpack
 * design to JOB-2199-01-B. The modal rendered the two live parent designs, but its inline approval
 * gate read the stale three-design _art_ids and blocked on the backpack design it no longer showed.
 */
const { approvalArtContext } = require('../lib/artApproval');

const mock = name => [{ url: 'https://example.test/' + name + '.jpg', name: name + '.jpg' }];

const order = {
  art_files: [
    { id: 'af-shirt', name: '2-color CCAA', item_mockups: { 'K864|Royal': mock('shirt') } },
    { id: 'af-hat', name: '1-color CCAA', item_mockups: { 'C920|White': mock('hat') } },
    // Production files are intentionally not approval images; this child still needs a garment mock.
    { id: 'af-bag', name: '2-Color Large CCAA', item_mockups: {}, prod_files: mock('bag-sewout') },
  ],
  items: [
    { sku: 'K864', decorations: [{ kind: 'art', art_file_id: 'af-shirt' }] },
    { sku: 'C920', decorations: [{ kind: 'art', art_file_id: 'af-hat' }] },
    { sku: 'BG225', decorations: [{ kind: 'art', art_file_id: 'af-bag' }] },
  ],
};

const parent = {
  id: 'JOB-2199-01', art_file_id: 'af-shirt', _art_ids: ['af-shirt', 'af-hat'],
  items: [{ item_idx: 0, deco_idxs: [0] }, { item_idx: 1, deco_idxs: [0] }],
};
const child = {
  id: 'JOB-2199-01-B', art_file_id: 'af-shirt', _art_ids: ['af-bag'],
  items: [{ item_idx: 2, deco_idxs: [0] }],
};

test('SO-2199: stale parent modal does not validate the design moved to its split child', () => {
  const staleModalJob = {
    ...parent,
    _art_ids: ['af-shirt', 'af-bag', 'af-hat'],
    items: [...parent.items, ...child.items],
  };
  const ctx = approvalArtContext(staleModalJob, order, [parent, child]);
  expect(ctx.currentJob).toBe(parent);
  expect(ctx.artIds).toEqual(['af-shirt', 'af-hat']);
  expect(ctx.missingImages).toEqual([]);
});

test('the live split child still requires its own garment approval image', () => {
  const ctx = approvalArtContext(child, order, [parent, child]);
  expect(ctx.artIds).toEqual(['af-bag']);
  expect(ctx.missingImages.map(a => a.id)).toEqual(['af-bag']);
});
