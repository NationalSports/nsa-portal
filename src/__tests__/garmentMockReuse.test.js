import { garmentMockCandidates, adoptArtProofAsGarmentMock, removeGarmentSlotMock, slotMockFiles, skusMissingMockups } from '../safeHelpers';

const proof = { url: 'https://example.com/mock.png', name: 'mock.png' };
const item = { sku: 'TEE', color: 'Blue', decorations: [{ kind: 'art', art_file_id: 'a' }] };
const slot = artFile => ({ artId: 'a', artFile, key: 'TEE|Blue', primary: true, kind: 'art' });
test('all images remain explicit reuse candidates after adopting one garment', () => {
  const other = { url: 'https://example.com/back.pdf' };
  const a = { id: 'a', prod_files: [proof, other, { url: 'machine.dst' }], mockup_files: [proof] };
  const adopted = adoptArtProofAsGarmentMock([a], 'a', 'TEE|Blue', other);
  expect(garmentMockCandidates(adopted[0])).toEqual([proof, other]);
  expect(adopted[0].item_mockups['TEE|Blue']).toEqual([other]);
});
test('removal preserves other garments, sides, designs and the original file', () => {
  const a = { id: 'a', deco_type: 'screen_print', prod_files: [proof], item_mockups: { 'TEE|Blue': [proof], 'TEE|Blue|numbers': [proof], 'TEE|Red': [proof] } };
  const b = { id: 'b', item_mockups: { 'TEE|Blue': [proof] } };
  const s = slot(a);
  const result = removeGarmentSlotMock([a, b], s, [s], item, proof.url);
  expect(result[0].item_mockups).toEqual({ 'TEE|Blue': [], 'TEE|Blue|numbers': [proof], 'TEE|Red': [proof] });
  expect(result[1]).toBe(b);
  expect(result[0].prod_files).toEqual([proof]);
  expect(result[0]._artDeletes.item_mockups).toEqual({ 'TEE|Blue': [proof.url] });
  const readopted = adoptArtProofAsGarmentMock(result, 'a', 'TEE|Blue', proof);
  expect(readopted[0]._artDeletes?.item_mockups?.['TEE|Blue']).toBeUndefined();
});
test('removing the last mock cannot revive the screen print production proof for approval', () => {
  const a = { id: 'a', deco_type: 'screen_print', prod_files: [proof], item_mockups: { 'TEE|Blue': [proof] } };
  const s = slot(a);
  const result = removeGarmentSlotMock([a], s, [s], item, proof.url);
  expect(skusMissingMockups({ art_file_id: 'a', items: [{ item_idx: 0 }] }, { items: [item], art_files: result })).toEqual(['TEE']);
});
test('removing a legacy fallback materializes only the selected slot', () => {
  const a = { id: 'a', item_mockups: { TEE: [proof] } };
  const s = { ...slot(a), key: 'TEE|Blue|d1', primary: false };
  const result = removeGarmentSlotMock([a], s, [s], item, proof.url);
  const next = { ...s, artFile: result[0] };
  expect(slotMockFiles(next, [next], item)).toEqual([]);
  expect(result[0].item_mockups.TEE).toEqual([proof]);
});
