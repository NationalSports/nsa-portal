import { insertedItemIdsByIndex } from '../lib/itemInsertIdentity';

test('maps inserted item ids by stable item_index when database return order is shuffled', () => {
  const ids = insertedItemIdsByIndex([
    { id: 'db-third', item_index: 2 },
    { id: 'db-first', item_index: 0 },
    { id: 'db-second', item_index: 1 },
  ]);

  expect(ids.get(0)).toBe('db-first');
  expect(ids.get(1)).toBe('db-second');
  expect(ids.get(2)).toBe('db-third');
});

test('duplicate or missing indexes cannot masquerade as a complete mapping', () => {
  const ids = insertedItemIdsByIndex([
    { id: 'one', item_index: 0 },
    { id: 'duplicate', item_index: 0 },
  ]);

  expect(ids.size).toBe(1);
});
