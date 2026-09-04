import { cartLineQty, isFixedCartQty, setCartLineQty } from '../storefront/Storefront';

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
