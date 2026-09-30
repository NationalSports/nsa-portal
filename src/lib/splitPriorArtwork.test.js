import { splitPriorArtwork } from './splitPriorArtwork';

test('SKU split keeps the old mock on the original art and leaves the new garment without one', () => {
  const source = { id: 'af1', name: 'Bulldog', status: 'approved', mockup_files: [{ url: 'https://example.com/old.png' }], item_mockups: { 'BLACK|Black': [{ url: 'https://example.com/old.png' }] }, files: [{ url: 'https://example.com/art.ai' }], prod_files: [{ url: 'https://example.com/art.ai' }], mock_links: { 'WHITE|White': 'BLACK|Black' }, prod_files_attached: true };
  const order = { id: 'SO-1', art_files: [source], items: [
    { sku: 'BLACK', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
    { sku: 'WHITE', decorations: [{ kind: 'art', art_file_id: 'af1' }] },
  ] };
  const result = splitPriorArtwork(order, [{ item_idx: 1, deco_idxs: [0] }], [{ item_idx: 0, deco_idxs: [0] }], url => /\.png$/.test(url), 123);
  expect(result.copiedArt).toHaveLength(1);
  expect(result.copiedArt[0]).toMatchObject({ id: 'af123-split-0', reused_from_so: 'SO-1', mockup_files: [], item_mockups: {}, mock_links: {}, prod_files_attached: false });
  expect(result.copiedArt[0].prod_files).toEqual(source.prod_files);
  expect(result.updatedItems[0].decorations[0].art_file_id).toBe('af1');
  expect(result.updatedItems[1].decorations[0].art_file_id).toBe('af123-split-0');
  expect(source.item_mockups['BLACK|Black']).toHaveLength(1);
});
