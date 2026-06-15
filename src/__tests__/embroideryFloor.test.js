/* eslint-disable */
/**
 * Embroidery minimum sell price (EM.fl floor).
 *
 * Verifies the live pricing module (src/pricing.js) never sells embroidery
 * below the configured per-piece minimum (EM.fl, default $8), while tiers whose
 * tiered price is already above the minimum keep their higher price. Cost is
 * never floored, so margin math stays accurate.
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
const { emP, dP, EM, rT } = require('../pricing');

describe('Embroidery minimum sell price (EM.fl floor)', () => {
  test('default floor is $8', () => {
    expect(EM.fl).toBe(8);
  });

  test('sub-minimum tiers are lifted to the floor', () => {
    // 8000-stitch logo: raw sell = cost × 1.6 lands at $7.20–$8.20 depending on qty.
    expect(emP(8000, 100, true)).toBe(8);   // raw 7.20 -> floored to 8
    expect(emP(8000, 6, true)).toBe(8);     // raw 7.70 -> floored to 8
    expect(emP(8000, 24, true)).toBe(8.2);  // raw 8.20 already above floor -> unchanged
  });

  test('higher stitch tiers keep their higher tiered price', () => {
    expect(emP(20000, 24, true)).toBe(rT(EM.pr[2][1] * EM.mk)); // 9.10
    expect(emP(30000, 6, true)).toBe(rT(EM.pr[3][0] * EM.mk));  // 11.50
  });

  test('sell is never below the floor anywhere in the matrix', () => {
    [5000, 8000, 12000, 18000, 25000].forEach(st =>
      [1, 6, 12, 24, 48, 100].forEach(q =>
        expect(emP(st, q, true)).toBeGreaterThanOrEqual(EM.fl)));
  });

  test('cost is unaffected by the floor (margins stay accurate)', () => {
    expect(emP(8000, 100, false)).toBe(EM.pr[0][3]); // 4.50, well under the $8 sell floor
  });

  test('dP embroidery floors the computed sell but preserves true cost', () => {
    const res = dP({ type: 'embroidery', stitches: 8000 }, 100, [], 100);
    expect(res.sell).toBe(8);
    expect(res.cost).toBe(EM.pr[0][3]); // 4.50
  });

  test('an explicit sell_override is honored even below the floor', () => {
    const res = dP({ type: 'embroidery', stitches: 8000, sell_override: 5 }, 100, [], 100);
    expect(res.sell).toBe(5);
  });
});
