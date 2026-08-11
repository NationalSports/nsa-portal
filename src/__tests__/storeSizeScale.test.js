/* src/lib/storeInventory.js — scaleOf / stockScale.
 *
 * Regression cover for "sizes keep dropping off webstores": ~1,100 catalog rows
 * (mostly bulk-imported adidas CLICK styles) carry available_sizes = [] while
 * holding real per-size stock. available_sizes was the storefront's only source
 * of size buttons, so those products rendered with NO sizes — and because an
 * empty scale also made `needSize` false, the item could be added to the cart
 * with size=null, producing an unfulfillable order line. Reps patched it
 * store-by-store with sizes_offered, which only held while the item was
 * untracked; once stock synced the patch was ignored and the sizes vanished
 * again ("reverted back to no sizes").
 *
 * scaleOf falls back to the sizes implied by stock. These tests pin that
 * fallback AND that a healthy catalog scale is never second-guessed. */
import { scaleOf, stockScale } from '../lib/storeInventory';

// Real rows from the St. Francis stores that reported the bug.
const PANT_STOCK = { L: 57, M: 102, S: 21, XL: 40, XS: 3, '2XL': 6 }; // HI0704
const SHORT_STOCK = { L: 18, M: 65, S: 39, XL: 10, XS: 6, '2XL': 14 }; // GL9698

describe('scaleOf — catalog scale wins whenever it exists', () => {
  test('a healthy product uses its own scale, stock is not consulted', () => {
    expect(scaleOf(['S', 'M', 'L', 'XL', '2XL'], { S: 1 })).toEqual(['S', 'M', 'L', 'XL', '2XL']);
  });
  test('a genuine one-size item keeps its single label', () => {
    expect(scaleOf(['Adjustable'], { Adjustable: 12 })).toEqual(['Adjustable']);
    expect(scaleOf(['OSFA'], { OSFA: 3 })).toEqual(['OSFA']);
  });
  test('the catalog scale is respected even when stock has sizes it lacks', () => {
    // Warehouse holds a 3XL the catalog never listed — the catalog still rules.
    expect(scaleOf(['S', 'M'], { S: 4, M: 2, '3XL': 9 })).toEqual(['S', 'M']);
  });
  test('a tall in the catalog scale folds to its regular twin (pre-existing rule)', () => {
    expect(scaleOf(['S', 'M', 'MT', 'L'])).toEqual(['S', 'M', 'L']);
  });
});

describe('scaleOf — empty catalog scale falls back to stock', () => {
  test('the reported pants (HI0704): empty scale + warehouse stock yields the real run', () => {
    expect(scaleOf([], PANT_STOCK)).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL']);
  });
  test('the reported shorts (GL9698): same, in size order not object order', () => {
    expect(scaleOf([], SHORT_STOCK)).toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL']);
  });
  test('null and undefined scales fall back too', () => {
    expect(scaleOf(null, { S: 1, M: 2 })).toEqual(['S', 'M']);
    expect(scaleOf(undefined, { S: 1, M: 2 })).toEqual(['S', 'M']);
  });
  test('warehouse, vendor and dated-restock sizes all contribute, deduped', () => {
    expect(scaleOf([], { M: 4 }, { L: 2, M: 1 }, { XL: '2026-09-01' })).toEqual(['M', 'L', 'XL']);
  });
  test('a vendor tall folds into its regular twin and does not duplicate it', () => {
    expect(scaleOf([], { L: 3 }, { LT: 5, XLT: 2 })).toEqual(['L', 'XL']);
  });
  test('footwear numbers sort numerically, after lettered sizes', () => {
    expect(scaleOf([], { 10: 1, 9: 2, 8: 3, 11: 1 })).toEqual(['8', '9', '10', '11']);
  });
  test('no scale and no stock stays empty — nothing is invented', () => {
    expect(scaleOf([])).toEqual([]);
    expect(scaleOf([], null, null, null)).toEqual([]);
    expect(scaleOf([], {}, {})).toEqual([]);
  });
  test('a zero-quantity size still counts as part of the scale (it renders sold out, not absent)', () => {
    expect(scaleOf([], { S: 0, M: 5 })).toEqual(['S', 'M']);
  });
});

describe('stockScale', () => {
  test('ignores non-object maps instead of throwing', () => {
    expect(stockScale(null, undefined, 'nope', 5, { S: 1 })).toEqual(['S']);
  });
  test('called with nothing returns empty', () => {
    expect(stockScale()).toEqual([]);
  });
  test('drops the vendor feeds\' unsized placeholder rather than rendering it as a size', () => {
    // inventory_unified spells an unsized style's row `_na` (142 rows live).
    expect(stockScale({ _na: 7 })).toEqual([]);
    expect(stockScale({ _na: 7, M: 3 })).toEqual(['M']);
    expect(stockScale({ NA: 1, 'n/a': 1, NULL: 1, none: 1, '-': 1, '  ': 1, L: 2 })).toEqual(['L']);
  });
  test('a real size is never mistaken for a placeholder', () => {
    expect(stockScale({ S: 1, M: 1, L: 1, NS: 1 })).toEqual(['S', 'M', 'L', 'NS']);
  });
});
