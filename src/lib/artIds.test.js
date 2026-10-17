import { formatArtCode, loadArtCodes } from './artIds';

const sb = (tables, fail) => ({ from: t => ({ select: () => ({ in: async () => fail ? { error: { message: 'relation does not exist' } } : { data: tables[t], error: null } }) }) });

test('formats master and versioned Art IDs', () => {
  expect(formatArtCode(42)).toBe('ART-000042');
  expect(formatArtCode(1234, 2, 1)).toBe('ART-001234-V02-R01');
  expect(formatArtCode(undefined)).toBe('');
});
test('looks up codes per art folder entry; same art id in another folder is a different logo', async () => {
  const codes = await loadArtCodes(sb({
    art_ids: [{ art_number: 7, customer_id: 'c1', art_id: 'caf1' }, { art_number: 9, customer_id: 'c2', art_id: 'caf1' }],
    art_id_versions: [{ art_number: 7, variant_no: 1, revision_no: 2, revision_key: 'v-uuid' }],
  }), ['c1', 'c2']);
  expect(codes.master('c1', 'caf1')).toBe('ART-000007');
  expect(codes.master('c2', 'caf1')).toBe('ART-000009');
  expect(codes.version('c1', 'caf1', 'v-uuid')).toBe('ART-000007-V01-R02');
  expect(codes.version('c2', 'caf1', 'v-uuid')).toBe('');
  expect(codes.master('c1', 'missing')).toBe('');
});
test('missing registry (migration not applied) shows no IDs instead of failing the screen', async () => {
  const codes = await loadArtCodes(sb({}, true), ['c1']);
  expect(codes.master('c1', 'caf1')).toBe('');
});
