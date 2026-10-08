import { productionDecoKey, groupByDecoration } from '../lib/productionGroups';

const art = { id: 'A1', name: 'Crest', color_ways: [
  { id: 'cwW', garment_color: 'Navy', inks: ['White'] },
  { id: 'cwN', garment_color: 'White', inks: ['Navy'] },
] };
const line = (color, decos, sku = 'TEE') => ({ sku, color, sizes: { M: 1 }, decorations: decos });
const crest = extra => ({ kind: 'art', art_file_id: 'A1', position: 'Front', ...extra });
const key = (it, gi = { item_idx: 0 }) => productionDecoKey(gi, it, [art]);

test('same design + explicit color way on different SKUs share a key', () => {
  expect(key(line('Navy', [crest({ color_way_id: 'cwW' })], 'TEE'))).toBe(key(line('Navy', [crest({ color_way_id: 'cwW' })], 'HOOD')));
});

test('different ink color ways never share a key', () => {
  expect(key(line('Navy', [crest({ color_way_id: 'cwW' })]))).not.toBe(key(line('Navy', [crest({ color_way_id: 'cwN' })])));
});

test('a color way resolved from the garment color groups with the explicit one it resolves to', () => {
  expect(key(line('Navy', [crest()]))).toBe(key(line('Navy', [crest({ color_way_id: 'cwW' })])));
  expect(key(line('White', [crest()]))).not.toBe(key(line('Navy', [crest()])));
});

test('unresolvable color ways split by garment color instead of guessing', () => {
  expect(key(line('Red', [crest()]))).not.toBe(key(line('Gold', [crest()])));
  expect(key(line('Red', [crest()], 'TEE'))).toBe(key(line('Red', [crest()], 'HOOD')));
});

test('same inks on different garment colors (one color way for all) share a key', () => {
  const single = { id: 'A1', color_ways: [{ id: 'all', garment_color: '', inks: ['Black'] }] };
  const k = it => productionDecoKey({ item_idx: 0 }, it, [single]);
  expect(k(line('White', [crest()]))).toBe(k(line('Grey', [crest()])));
});

test('placement, underbase and numbers setup are part of the key', () => {
  const base = key(line('Navy', [crest({ color_way_id: 'cwW' })]));
  expect(key(line('Navy', [crest({ color_way_id: 'cwW', position: 'Left Chest' })]))).not.toBe(base);
  expect(key(line('Navy', [crest({ color_way_id: 'cwW', underbase: true })]))).not.toBe(base);
  const withNums = key(line('Navy', [crest({ color_way_id: 'cwW' }), { kind: 'numbers', position: 'Back', num_size: '8"', print_color: 'White' }]));
  expect(withNums).not.toBe(base);
  expect(key(line('Navy', [crest({ color_way_id: 'cwW' }), { kind: 'numbers', position: 'Back', num_size: '10"', print_color: 'White' }]))).not.toBe(withNums);
});

test('only decorations this job runs count (deco_idxs scoping)', () => {
  const it = line('Navy', [crest({ color_way_id: 'cwW' }), { kind: 'numbers', position: 'Back' }]);
  expect(key(it, { item_idx: 0, deco_idxs: [0] })).toBe(key(line('Navy', [crest({ color_way_id: 'cwW' })])));
});

test('groupByDecoration keeps first-seen group order and job order inside groups', () => {
  const rows = [{ id: 1, k: 'a' }, { id: 2, k: 'b' }, { id: 3, k: 'a' }];
  expect(groupByDecoration(rows, r => r.k).map(g => [g.key, g.items.map(r => r.id)])).toEqual([['a', [1, 3]], ['b', [2]]]);
});
