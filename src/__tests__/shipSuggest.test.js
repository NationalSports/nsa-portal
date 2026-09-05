/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — src/lib/shipSuggest.js and its wiring into both editors.
//
// This suggestion is read by a rep deciding what to charge a customer. Every
// failure mode is quiet and expensive: a number that is too low loses money on
// an order that already loses money more often than not, and a number shown
// with false confidence gets trusted more than the data supports.
// ═══════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { suggestShipping, orderUnits, pickSizeBucket, MIN_SAMPLE, MIN_BUCKET } = require('../lib/shipSuggest');

// The shape the audit writes, with the real production numbers as of Sep 2026.
// Note how far median_cost_per_unit (0.958) sits from what a large order really
// costs: that gap is the bug the size curve exists to close.
const SIZE_BUCKETS = [
  { min_units: 0,   max_units: 9,    n: 5,  median_cost: 35.32, p25_cost: 34.42, p75_cost: 48.60 },
  { min_units: 10,  max_units: 24,   n: 26, median_cost: 29.49, p25_cost: 21.87, p75_cost: 71.20 },
  { min_units: 25,  max_units: 49,   n: 17, median_cost: 38.70, p25_cost: 25.48, p75_cost: 52.23 },
  { min_units: 50,  max_units: 99,   n: 22, median_cost: 48.20, p25_cost: 30.30, p75_cost: 77.93 },
  { min_units: 100, max_units: 199,  n: 15, median_cost: 74.01, p25_cost: 35.51, p75_cost: 117.91 },
  { min_units: 200, max_units: null, n: 23, median_cost: 114.26, p25_cost: 46.63, p75_cost: 185.58 },
];

const basis = {
  sample_n: 107, median_cost_per_unit: 0.958, median_cost_pct_merch: 3.86,
  p25_cost_pct_merch: 2.33, p75_cost_pct_merch: 9.05, target_margin_pct: 15,
  size_buckets: SIZE_BUCKETS,
};

describe('suggestShipping', () => {
  test('leaves the target margin on the shipping line', () => {
    // cost / (1 - margin), not cost * (1 + margin) — those differ, and the
    // second one silently under-charges.
    const s = suggestShipping({ units: 0, merchTotal: 1000, basis });
    expect(s.basedOn).toBe('merch');           // no unit count -> no size class
    expect(s.estCost).toBe(38.6);              // 3.86% of 1000
    expect(s.dollars).toBeCloseTo(45.41, 2);   // 38.6 / 0.85
    // Charging that amount really does yield the target margin.
    expect((s.dollars - s.estCost) / s.dollars * 100).toBeCloseTo(15, 1);
  });

  // THE BUG A REP CAUGHT. 130 tee shirts in 2-3 boxes were suggested at $140.88,
  // because the helper multiplied a GLOBAL median cost-per-unit ($0.958, whose
  // median is set by small orders) by the order's 125 units -> $119.75, then took
  // the higher of that and percent-of-merch. Orders of that actual size have a
  // median cost of $74.01. Shipping is priced per box, not per garment.
  //
  // Measured over the scored orders: flat $/unit had +$44.59 mean bias, and the
  // max() of it and percent-of-merch was worse than either input alone at +$60.43.
  test('does not extrapolate a small-order per-unit rate onto a big order', () => {
    const s = suggestShipping({ units: 125, merchTotal: 1070, basis });
    expect(s.basedOn).toBe('size');
    expect(s.estCost).toBe(74.01);                       // its own size class
    expect(s.estCost).toBeLessThan(125 * 0.958);         // never the flat rate
    expect(s.dollars).toBeCloseTo(87.07, 2);             // 74.01 / 0.85
    expect(s.dollars).toBeLessThan(140.88);              // the number that shipped
  });

  test('never takes the max of the two estimates — that measured worse than either', () => {
    // 200+ units: size says $114.26. Percent-of-merch on a rich order says far
    // more (3.86% of 50k = $1,930). The old rule took the larger; the size class
    // is the one grounded in what shipping actually costs, so it wins outright.
    const s = suggestShipping({ units: 500, merchTotal: 50000, basis });
    expect(s.basedOn).toBe('size');
    expect(s.estCost).toBe(114.26);
    expect(s.estCost).toBeLessThan(50000 * 0.0386);
  });

  test('cost per unit falls as the order grows, the way the data does', () => {
    const at = (u) => suggestShipping({ units: u, merchTotal: 9999, basis }).estCost / u;
    expect(at(15)).toBeGreaterThan(at(75));
    expect(at(75)).toBeGreaterThan(at(150));
    expect(at(150)).toBeGreaterThan(at(500));
  });

  test('falls back to percent-of-merch when the size class is too thin to trust', () => {
    const thin = { ...basis, size_buckets: SIZE_BUCKETS.map(
      (b) => (b.min_units === 100 ? { ...b, n: MIN_BUCKET - 1 } : b)) };
    const s = suggestShipping({ units: 125, merchTotal: 1070, basis: thin });
    expect(s.basedOn).toBe('merch');
    expect(s.estCost).toBeCloseTo(41.30, 2);
  });

  test('an order past the last bucket edge still lands in the open-ended bucket', () => {
    expect(pickSizeBucket(SIZE_BUCKETS, 100000).min_units).toBe(200);
    expect(pickSizeBucket(SIZE_BUCKETS, 1).min_units).toBe(0);
    expect(pickSizeBucket(null, 50)).toBeNull();
  });

  // The printed range must be computed the SAME way as the number beside it.
  // Before, the button showed a size-derived 13.2% next to a percent-of-merch
  // spread of 2.33-9.05% — a figure sitting outside its own stated range.
  test('carries the sample size and a spread that matches the estimate shown', () => {
    const s = suggestShipping({ units: 125, merchTotal: 5000, basis });
    expect(s.sampleN).toBe(15);            // the size class, not all 107
    expect(s.lowCost).toBe(35.51);
    expect(s.highCost).toBe(117.91);
    expect(s.estCost).toBeGreaterThanOrEqual(s.lowCost);
    expect(s.estCost).toBeLessThanOrEqual(s.highCost);
  });

  test('stays silent on a sample too small to mean anything', () => {
    expect(suggestShipping({ units: 10, merchTotal: 1000, basis: { ...basis, sample_n: MIN_SAMPLE - 1 } })).toBeNull();
    expect(suggestShipping({ units: 10, merchTotal: 1000, basis: null })).toBeNull();
  });

  test('stays silent rather than dividing by zero on an empty order', () => {
    expect(suggestShipping({ units: 0, merchTotal: 0, basis })).toBeNull();
    expect(suggestShipping({ units: 0, merchTotal: -5, basis })).toBeNull();
  });

  test('survives a calibration row with nulls in it', () => {
    const s = suggestShipping({ units: 10, merchTotal: 1000,
      basis: { ...basis, size_buckets: null, median_cost_per_unit: null, p25_cost_pct_merch: null } });
    expect(Number.isFinite(s.dollars)).toBe(true);
    expect(s.estCost).toBe(38.6);
  });

  // A database migrated to ship_cost_basis but not yet to size_buckets must keep
  // working rather than showing nothing.
  test('an un-migrated basis with no size curve still suggests from merch', () => {
    const { size_buckets, ...noCurve } = basis;
    const s = suggestShipping({ units: 125, merchTotal: 1000, basis: noCurve });
    expect(s.basedOn).toBe('merch');
    expect(s.estCost).toBe(38.6);
  });
});

describe('orderUnits', () => {
  test('sums per-size quantities, falling back to est_qty', () => {
    expect(orderUnits([{ sizes: { M: 6, L: 4 } }, { sizes: {}, est_qty: 20 }])).toBe(30);
  });
  test('null and junk input do not throw', () => {
    expect(orderUnits(null)).toBe(0);
    expect(orderUnits([null, { sizes: null }])).toBe(0);
  });
});

// CLAUDE.md: a change to one editor must land in the other, or half the users
// (classic is the default) never see it.
describe('both editors show the suggestion', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s renders it from the shared helper', (file) => {
    const src = read(file);
    expect(src).toContain("from './lib/shipSuggest'");
    expect(src).toContain('shipCostBasis');
    expect(src).toContain('suggestShipping({units:orderUnits(safeItems(o)),merchTotal:totals.rev,basis:shipCostBasis})');
    expect(src).toContain('Suggest {sug.pct}%');
    // The spread has to travel with the number; a bare figure implies precision
    // the underlying data does not have.
    expect(src).toContain('typical ${sug.lowCost.toFixed(2)}–${sug.highCost.toFixed(2)}');
    // and no editor may still be printing the old percent spread
    expect(src).not.toContain('sug.lowPct');
  });

  test('App loads the calibration and passes it down', () => {
    const src = read('App.js');
    expect(src).toContain("supabase.from('ship_cost_basis')");
    expect(src).toContain('shipCostBasis={shipCostBasis}');
  });

  // THE BUG THIS PINS. ship_cost_basis is readable only by an authenticated staff
  // member, and Supabase restores the session asynchronously on first load. The
  // original loader fired the query at mount with no gate, so on a cold load it
  // went out under the anon key, RLS matched nothing, and maybeSingle() returned
  // {data:null,error:null} — a silent, permanent "no calibration" for the life of
  // the page. Nothing rendered and nothing was logged.
  //
  // Asserting the two strings are merely present would pass on the broken code,
  // so this pins their ORDER inside the effect: the session gate must come first.
  test('the calibration load waits for a live session before querying', () => {
    const src = read('App.js');
    const start = src.indexOf('const[shipCostBasis,setShipCostBasis]=useState(null);');
    expect(start).toBeGreaterThan(-1);
    const effect = src.slice(start, src.indexOf('const[shipCartons,setShipCartons]', start));

    const gate = effect.indexOf('_isLiveSession(session)');
    const query = effect.indexOf("supabase.from('ship_cost_basis')");
    expect(gate).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(query);

    // ...and the helper it leans on is actually imported, not a stray identifier.
    expect(src).toContain('_isLiveSession,');
  });

  // An empty result here is indistinguishable from "the audit never ran". Whichever
  // it is, the rep sees no suggestion and no reason why, so it has to reach a log.
  test('coming away with no calibration is reported, not swallowed', () => {
    const src = read('App.js');
    expect(src).toContain('[ship] no shipping cost basis');
  });
});
