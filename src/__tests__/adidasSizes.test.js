// Locks the size ordering used by the adidas catalog's StyleCard chips and the
// per-colorway size grid in the detail modal. The bug this guards: shorts carry
// compound "base size + inseam" labels (e.g. "S 3\"", "XL5\"", "2XL3") that the
// old sizeRank didn't recognize, so every one fell to the same rank and the run
// rendered alphabetically (2XL, L, M, S, XL, XS) instead of smallest→largest.
import { sizeRank } from '../storefront/AdidasInventory';

const sortedBy = (sizes) => [...sizes].sort((a, b) => sizeRank(a) - sizeRank(b));

describe('sizeRank ordering', () => {
  test('plain apparel sizes run smallest → largest', () => {
    expect(sortedBy(['2XL', 'S', 'XL', 'XS', 'M', 'L', '3XL']))
      .toEqual(['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']);
  });

  test('footwear numbers (and half sizes) stay numeric', () => {
    expect(sortedBy(['10', '8', '9-', '9', '11'])).toEqual(['8', '9', '9-', '10', '11']);
  });

  test('shorts sort by base size, then inseam — the IQ2728 case from the modal', () => {
    // Exact labels from inventory_unified for IQ2728 (spacing/quote vary per the feed).
    const feedOrder = ['2XL3', '2XL5', 'L 3"', 'L 5"', 'M 3"', 'M 5"', 'S 3"', 'S 5"', 'XL3"', 'XL5"', 'XS3"', 'XS5"'];
    expect(sortedBy(feedOrder)).toEqual([
      'XS3"', 'XS5"', 'S 3"', 'S 5"', 'M 3"', 'M 5"', 'L 3"', 'L 5"', 'XL3"', 'XL5"', '2XL3', '2XL5',
    ]);
  });

  test('a single size keeps its inseams in ascending order', () => {
    expect(sortedBy(['M 9"', 'M 3"', 'M 7"', 'M 5"'])).toEqual(['M 3"', 'M 5"', 'M 7"', 'M 9"']);
  });

  test('inseam never bleeds a size into the next slot (XS 9" still < S 3")', () => {
    expect(sizeRank('XS9"')).toBeLessThan(sizeRank('S 3"'));
    expect(sizeRank('XL5"')).toBeLessThan(sizeRank('2XL3'));
  });
});
