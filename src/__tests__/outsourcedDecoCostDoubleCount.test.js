/* eslint-disable */
/**
 * SO-1397 regression — outsourced deco double-counted in header/commission cost walks.
 *
 * Symptom on SO-1397 (Orange Lutheran Store, 1700 shirts, outside screen print):
 *   Costs tab Expected: blanks $4,845 + outside deco $2,788 + ship $200 = $7,833
 *   Header COST card:   $11,883  (~$4,050 too high)
 *   Header MARGIN:      $217 (1.8%) — looks wrong next to REV $11,900
 *
 * Root cause: Phase 1 wired `isDecoOutsourced` into the Costs tab (and syncJobs) so
 * in-house decoCostAt is suppressed when a deco PO covers the decoration. Header
 * `totals`, calcGP, soCalc, and calcOrderMargin still added BOTH:
 *   1) in-house screen-print cost from decoCostAt / dP (catalog tier), AND
 *   2) the outside deco PO cost from so.deco_pos
 *
 * At qty 1700 / 4-color screen, in-house unit cost ≈ $2.50 → ~$4,250 phantom cost,
 * which matches the observed gap (11,883 − 7,833 = 4,050; slight ink/underbase variance).
 *
 * The MARGIN vs (REV−COST) $200 gap is NOT a bug — margin intentionally includes the
 * quoted shipping charge on the revenue side while REV excludes it (shipping wash).
 *
 * Fix: apply the same `isDecoOutsourced` gate in every cost walk that also sums deco_pos.
 */
const { calcOrderMargin, dP, decoCostAt } = require('../pricing');
const { calcTotals, isDecoOutsourced, outsourcedDecoTypes } = require('../businessLogic');

// SO-1397-shaped fixture: one garment line, art deco covered by an outside screen-print PO.
const mkSO1397 = (overrides = {}) => ({
  id: 'SO-1397',
  shipping_type: 'flat',
  shipping_value: 200,
  art_files: [{ id: 'af1', deco_type: 'screen_print', ink_colors: 'PMS 1\nPMS 2\nPMS 3\nPMS 4' }],
  items: [{
    sku: '64000',
    name: 'Gildan Softstyle T-Shirt',
    unit_sell: 7, // product sell only; deco sell added by dP
    nsa_cost: 4845 / 1700, // blanks expected $4,845
    sizes: { M: 1700 },
    decorations: [{ kind: 'art', art_file_id: 'af1' }],
    po_lines: [{ po_id: 'PO 3525', unit_cost: 4845 / 1700, M: 1700 }],
  }],
  deco_pos: [{
    po_id: 'DPO 3526',
    deco_type: 'screen_print',
    vendor: 'Silver Screen',
    qty: 1700,
    unit_cost: 2788 / 1700,
    expected_cost: 2788,
    item_idxs: [0],
  }],
  ...overrides,
});

describe('SO-1397 — outsourced deco must not double-count in cost walks', () => {
  test('fixture gate: the art deco is outsourced via deco_pos', () => {
    const so = mkSO1397();
    const map = outsourcedDecoTypes(so);
    expect(isDecoOutsourced(so, 0, so.items[0].decorations[0], map)).toBe(true);
  });

  test('phantom in-house screen cost alone explains the ~$4k header gap', () => {
    const so = mkSO1397();
    const af = so.art_files;
    const d = so.items[0].decorations[0];
    const inHouse = decoCostAt(d, 1700, af, 1700, {});
    // 4-color @ 500+ bracket: unit ~$2.07 (~$3.5k); with underbase ~$2.50 (~$4.25k).
    // Observed header−Expected gap was $4,050 — same order of magnitude as this phantom.
    expect(inHouse).toBeGreaterThan(3000);
    expect(inHouse).toBeLessThan(5500);
    expect(Math.abs((11883 - 7833) - inHouse)).toBeLessThan(800);
  });

  test('calcOrderMargin: cost = blanks + outside deco (+ ship), NOT + in-house deco', () => {
    const so = mkSO1397();
    const m = calcOrderMargin(so);
    const blanks = 4845;
    const outside = 2788;
    // No actual ship cost on fixture → cost should be blanks + outside only
    expect(m.cost).toBeCloseTo(blanks + outside, 0);
    // Quoted ship washes into margin revenue side
    expect(m.shipRev).toBe(200);
    // Margin ≈ (product+deco rev + ship) − (blanks + outside)
    expect(m.margin).toBeGreaterThan(2000); // healthy; not the 1.8% phantom
    expect(m.pct).toBeGreaterThan(15);
  });

  test('calcOrderMargin WITHOUT gate would have overstated cost (characterization of the bug)', () => {
    // Prove the bug shape: if we manually add in-house cost on top of deco_pos, we recreate SO-1397.
    const so = mkSO1397();
    const af = so.art_files;
    const d = so.items[0].decorations[0];
    const inHouse = decoCostAt(d, 1700, af, 1700, {});
    const fixed = calcOrderMargin(so);
    const buggyCost = fixed.cost + inHouse;
    expect(buggyCost).toBeGreaterThan(11000);
    expect(buggyCost - fixed.cost).toBeCloseTo(inHouse, 2);
  });

  test('calcTotals (legacy helper): also suppresses in-house cost when deco_pos covers it', () => {
    const so = mkSO1397();
    const t = calcTotals(so, { tax_rate: 0.0775 });
    expect(t.cost).toBeCloseTo(4845 + 2788, 0);
  });

  test('in-house-only order still counts decoCostAt (gate must not over-suppress)', () => {
    const so = mkSO1397({ deco_pos: [] }); // no outside PO
    const m = calcOrderMargin(so);
    const af = so.art_files;
    const d = so.items[0].decorations[0];
    const inHouse = decoCostAt(d, 1700, af, 1700, {});
    expect(m.cost).toBeCloseTo(4845 + inHouse, 0);
  });

  test('sell/revenue still includes decoration sell when outsourced (customer still pays)', () => {
    const so = mkSO1397();
    const m = calcOrderMargin(so);
    const af = so.art_files;
    const d = so.items[0].decorations[0];
    const dp = dP(d, 1700, af, 1700);
    const productRev = 1700 * 7;
    const decoRev = 1700 * dp.sell;
    expect(m.rev).toBeCloseTo(productRev + decoRev, 0);
  });
});
