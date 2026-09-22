/* eslint-disable */
/**
 * Embroidery minimum sell price (the EM floor).
 *
 * Verifies the live pricing module (src/pricing.js) never sells embroidery below
 * its per-piece minimum, while tiers whose tiered price is already above the
 * minimum keep their higher price. Cost is never floored, so margin math stays
 * accurate.
 *
 * The floor is PER STITCH BRACKET: EM.sf[i] overrides the global EM.fl for
 * bracket i (null = use EM.fl). The ≤5k bracket sells at $6; every other bracket
 * keeps the $8 minimum. Without its own floor the $8 global would swallow the
 * cheaper tier whole — a 3.5k-stitch left chest would still bill $8.
 *
 * SAFE: pure functions only — no Supabase, no DOM, no network.
 */
const { emP, dP, EM, rT } = require('../pricing');

describe('Embroidery minimum sell price (the EM floor)', () => {
  test('global floor is $8, and only the ≤5k bracket overrides it', () => {
    expect(EM.fl).toBe(8);
    expect(EM.sf).toEqual([6, null, null, null, null]);
    expect(EM.sb[0]).toBe(5000);
  });

  test('sub-minimum tiers are lifted to the floor', () => {
    // 8000-stitch logo: raw sell = cost × 1.6 lands at $7.20–$8.20 depending on qty.
    expect(emP(8000, 100, true)).toBe(8);   // raw 7.20 -> floored to 8
    expect(emP(8000, 6, true)).toBe(8);     // raw 7.70 -> floored to 8
    expect(emP(8000, 24, true)).toBe(8.2);  // raw 8.20 already above floor -> unchanged
  });

  test('higher stitch tiers keep their higher tiered price', () => {
    expect(emP(20000, 24, true)).toBe(rT(EM.pr[3][1] * EM.mk)); // 9.10
    expect(emP(30000, 6, true)).toBe(rT(EM.pr[4][0] * EM.mk));  // 11.50
  });

  // ── The ≤5k bracket: $3.50 cost, $6 sell ──
  test('≤5k stitches sell at $6 on its own floor, not the global $8', () => {
    // raw sell = 3.50 × 1.6 = 5.60, lifted by the bracket's own $6 floor.
    [1, 6, 7, 24, 25, 48, 49, 100, 500].forEach(q => {
      expect(emP(3658, q, true)).toBe(6);
      expect(emP(3658, q, false)).toBe(3.5);
    });
  });

  test('the bracket boundary is exact: 5000 is cheap, 5001 is not', () => {
    expect(emP(5000, 24, true)).toBe(6);
    expect(emP(5001, 24, true)).toBe(8.2);
  });

  test('an unset stitch count still defaults to the 5k–10k tier, never the cheap one', () => {
    // dP falls back to 8000 when stitches is null/0, so a blank field can't
    // silently drop a job into the $6 bracket.
    const blank = dP({ type: 'embroidery', stitches: null }, 100, [], 100);
    expect(blank.sell).toBe(8);
    expect(blank.cost).toBe(EM.pr[1][3]); // 4.50
  });

  test('sell is never below the floor that applies to its own bracket', () => {
    const floorFor = st => { const i = EM.sb.findIndex(b => st <= b); return EM.sf[i] != null ? EM.sf[i] : EM.fl };
    [3000, 5000, 8000, 12000, 18000, 25000].forEach(st =>
      [1, 6, 12, 24, 48, 100].forEach(q =>
        expect(emP(st, q, true)).toBeGreaterThanOrEqual(floorFor(st))));
  });

  test('cost is unaffected by the floor (margins stay accurate)', () => {
    expect(emP(8000, 100, false)).toBe(EM.pr[1][3]); // 4.50, well under the $8 sell floor
    expect(emP(3658, 100, false)).toBe(EM.pr[0][3]); // 3.50, under the $6 floor
  });

  test('dP embroidery floors the computed sell but preserves true cost', () => {
    const res = dP({ type: 'embroidery', stitches: 8000 }, 100, [], 100);
    expect(res.sell).toBe(8);
    expect(res.cost).toBe(EM.pr[1][3]); // 4.50

    // dP prices from cost, so it must resolve the SAME per-bracket floor emP does.
    const cheap = dP({ type: 'embroidery', stitches: 3658 }, 100, [], 100);
    expect(cheap.sell).toBe(6);
    expect(cheap.cost).toBe(3.5);
  });

  test('dP honors the ≤5k floor through the art-file and TBD paths too', () => {
    const art = [{ id: 'a1', deco_type: 'embroidery', stitches: 3658 }];
    const viaArt = dP({ kind: 'art', art_file_id: 'a1' }, 100, art, 100);
    expect(viaArt.sell).toBe(6);
    expect(viaArt.cost).toBe(3.5);

    const viaTbd = dP({ kind: 'art', art_file_id: '__tbd', art_tbd_type: 'embroidery', tbd_stitches: 3658 }, 100, [], 100);
    expect(viaTbd.sell).toBe(6);
    expect(viaTbd.cost).toBe(3.5);
  });

  test('an explicit sell_override is honored even below the floor', () => {
    const res = dP({ type: 'embroidery', stitches: 8000, sell_override: 5 }, 100, [], 100);
    expect(res.sell).toBe(5);
  });
});
