const { estimateDecorationShrinkConflicts } = require('../businessLogic');

const dbItems = [
  { id: 101, item_index: 0, sku: 'TEE' },
  { id: 102, item_index: 1, sku: 'HOOD' },
];

const counts = new Map([[101, 2], [102, 1]]);
const client = (first, second) => [
  { sku: 'TEE', decorations: Array.from({ length: first }, (_, i) => ({ i })) },
  { sku: 'HOOD', decorations: Array.from({ length: second }, (_, i) => ({ i })) },
];

describe('estimate decoration shrink guard', () => {
  test('blocks stale missing rows even if the caller believed decorations were hydrated', () => {
    expect(estimateDecorationShrinkConflicts(client(0, 0), dbItems, counts, {})).toEqual([
      expect.objectContaining({ item_index: 0, oldCount: 2, newCount: 0 }),
      expect.objectContaining({ item_index: 1, oldCount: 1, newCount: 0 }),
    ]);
  });

  test('allows only the exact before/after count stamped by Remove', () => {
    expect(estimateDecorationShrinkConflicts(client(1, 1), dbItems, counts, {
      0: { from: 2, to: 1 },
    })).toEqual([]);
  });

  test('does not let an intent authorize a different shrink or a different item', () => {
    expect(estimateDecorationShrinkConflicts(client(0, 0), dbItems, counts, {
      0: { from: 2, to: 1 },
    })).toEqual([
      expect.objectContaining({ item_index: 0, oldCount: 2, newCount: 0 }),
      expect.objectContaining({ item_index: 1, oldCount: 1, newCount: 0 }),
    ]);
  });

  test('allows unchanged/increased counts and leaves whole-item removal to the item guard', () => {
    expect(estimateDecorationShrinkConflicts(client(3, 1), dbItems, counts, {})).toEqual([]);
    expect(estimateDecorationShrinkConflicts([client(2, 1)[0]], dbItems, counts, {})).toEqual([]);
  });

  test('no_deco is not treated as deletion intent by the new client guard', () => {
    const items = client(0, 1);
    items[0].no_deco = true;
    expect(estimateDecorationShrinkConflicts(items, dbItems, counts, {})).toEqual([
      expect.objectContaining({ item_index: 0, oldCount: 2, newCount: 0 }),
    ]);
  });
});
