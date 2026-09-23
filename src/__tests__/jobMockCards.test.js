import { jobMockCardGroups } from '../lib/jobMockCards';
import { slotMockFiles, adoptArtProofAsGarmentMock, removeGarmentSlotMock } from '../safeHelpers';

const proof = { url: 'https://example.test/mock.png', name: 'Garment.png' };
const art = { id: 'a', name: 'Sunbirds', deco_type: 'embroidery', status: 'approved', prod_files: [proof] };
const item = { sku: 'TEE', color: 'Blue', decorations: [{ kind: 'art', art_file_id: 'a', position: 'Front' }] };
const job = { id: 'j', art_file_id: 'a', art_status: 'art_requested', items: [{ item_idx: 0, deco_idxs: [0] }] };
const order = { items: [item], art_files: [art] };

test('shows existing proof as an explicit choice even while art is requested', () => {
  const [group] = jobMockCardGroups(job, order);
  expect(group.slots[0].candidates).toEqual([proof]);
  expect(slotMockFiles(group.slots[0], group.allSlots, item)).toEqual([]);
  const updated = adoptArtProofAsGarmentMock(order.art_files, 'a', group.slots[0].key, proof);
  expect(updated[0].item_mockups['TEE|Blue']).toEqual([proof]);
  expect(updated[0].status).toBe('approved');
  expect(updated[0].prod_files).toEqual([proof]);
  expect(job.art_status).toBe('art_requested');
});

test('previous-order images are offered without saving them; unrelated designs stay out', () => {
  const [group] = jobMockCardGroups(job, order, {
    'sunbirds||embroidery': [{ from: 'OTHER|White', files: [proof, { url: 'prior.pdf' }] }],
    'other||embroidery': [{ files: [{ url: 'wrong.png' }] }],
  });
  expect(group.slots[0].candidates.map(f => f.url)).toEqual([proof.url, 'prior.pdf']);
  expect(order.art_files[0].item_mockups).toBeUndefined();
});

test('split job keeps the second design key and reads its legacy mock', () => {
  const second = { id: 'b', name: 'Back', item_mockups: { 'TEE|Blue': [proof] } };
  const line = { ...item, decorations: [...item.decorations, { kind: 'art', art_file_id: 'b' }] };
  const [group] = jobMockCardGroups({ ...job, art_file_id: 'b', items: [{ item_idx: 0, deco_idxs: [1] }] }, { items: [line], art_files: [art, second] });
  expect(group.slots).toHaveLength(1);
  expect(group.slots[0].key).toBe('TEE|Blue|d1');
  expect(slotMockFiles(group.slots[0], group.allSlots, line)).toEqual([proof]);
  const removed = removeGarmentSlotMock([art, second], group.slots[0], group.allSlots, line, proof.url);
  expect(removed[1].item_mockups['TEE|Blue|d1']).toEqual([]);
  expect(removed[0]).toBe(art);
});

test('reversible art and numbers retain separate slots', () => {
  const line = { ...item, decorations: [{ ...item.decorations[0], reversible: true, color_way_id_b: 'white' }, { kind: 'numbers', position: 'Back' }] };
  const [group] = jobMockCardGroups({ ...job, items: [{ item_idx: 0, deco_idxs: [0, 1] }] }, { ...order, items: [line] });
  expect(group.slots.map(s => s.key)).toEqual(['TEE|Blue', 'TEE|Blue|white', 'TEE|Blue|numbers']);
});

test('deduplicates repeated job garment entries and skips unresolved art', () => {
  expect(jobMockCardGroups({ ...job, items: [...job.items, ...job.items] }, order)).toHaveLength(1);
  expect(jobMockCardGroups(job, { ...order, art_files: [] })).toEqual([]);
});
