import { cartLineQty, isFixedCartQty, setCartLineQty, groupProducts } from '../storefront/Storefront';

test('all-school listings combine logo designs but keep other sports and ordinary stores separate', () => {
  const rows = [{ webstore_product_id: 'blue-script', variant_group_id: 'script', school_style_group_id: 'hoodie', school_program_ids: ['football'] },
    { webstore_product_id: 'black-script', variant_group_id: 'script', school_style_group_id: 'hoodie', school_program_ids: ['football'] },
    { webstore_product_id: 'blue-arched', variant_group_id: 'arched', school_style_group_id: 'hoodie', school_program_ids: ['football'] },
    { webstore_product_id: 'baseball', variant_group_id: 'other', school_style_group_id: 'hoodie', school_program_ids: ['baseball'] }];
  expect(groupProducts(rows, true).map((group) => group.rows.length)).toEqual([3, 1]);
  expect(groupProducts(rows).map((group) => group.rows.length)).toEqual([2, 1, 1]);
});
test('selected first logo supplies the customer card and its first color', () => {
  const rows = [
    { webstore_product_id: 'blue-script', variant_group_id: 'script', school_style_group_id: 'hoodie', color: 'Blue' },
    { webstore_product_id: 'black-script', variant_group_id: 'script', school_style_group_id: 'hoodie', color: 'Black' },
    { webstore_product_id: 'gold-arch', variant_group_id: 'arch', school_style_group_id: 'hoodie', color: 'Gold' },
    { webstore_product_id: 'white-arch', variant_group_id: 'arch', school_style_group_id: 'hoodie', color: 'White' },
  ];
  const [chosen] = groupProducts(rows, true, { hoodie: 'arch' });
  expect(chosen.rep.webstore_product_id).toBe('gold-arch');
  expect(chosen.rows.map((row) => row.webstore_product_id)).toEqual(['gold-arch', 'white-arch', 'blue-script', 'black-script']);
  expect(groupProducts(rows, true, { hoodie: 'missing' })[0].rep.webstore_product_id).toBe('blue-script');
});

describe('storefront cart quantity controls', () => {
  const plain = { key: 'plain', kind: 'single', qty: 1 };

  test('increases quantities restored from localStorage as strings numerically', () => {
    const stored = { ...plain, qty: '1' };
    const updated = setCartLineQty([stored], stored.key, cartLineQty(stored) + 1);
    expect(updated[0].qty).toBe(2);
  });

  test('decreasing one to zero removes the line', () => {
    expect(setCartLineQty([plain], plain.key, cartLineQty(plain) - 1)).toEqual([]);
  });

  test('ordinary selected options do not lock quantity', () => {
    expect(isFixedCartQty({ ...plain, option_selections: [{ id: 'color', value: 'Blue' }] })).toBe(false);
  });

  test('packs and personalized items remain fixed at one', () => {
    expect(isFixedCartQty({ kind: 'bundle' })).toBe(true);
    expect(isFixedCartQty({ kind: 'single', player_number: '12' })).toBe(true);
    expect(isFixedCartQty({ kind: 'single', player_name: 'KOISSIAN' })).toBe(true);
  });
});
