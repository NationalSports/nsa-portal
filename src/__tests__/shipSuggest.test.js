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
const { suggestShipping, orderUnits, MIN_SAMPLE } = require('../lib/shipSuggest');

const basis = {
  sample_n: 107, median_cost_per_unit: 0.958, median_cost_pct_merch: 3.86,
  p25_cost_pct_merch: 2.33, p75_cost_pct_merch: 9.05, target_margin_pct: 15,
};

describe('suggestShipping', () => {
  test('leaves the target margin on the shipping line', () => {
    // cost / (1 - margin), not cost * (1 + margin) — those differ, and the
    // second one silently under-charges.
    const s = suggestShipping({ units: 0, merchTotal: 1000, basis });
    expect(s.estCost).toBe(38.6);              // 3.86% of 1000
    expect(s.dollars).toBeCloseTo(45.41, 2);   // 38.6 / 0.85
    // Charging that amount really does yield the target margin.
    expect((s.dollars - s.estCost) / s.dollars * 100).toBeCloseTo(15, 1);
  });

  test('takes the higher of the two bases', () => {
    // 500 units x 0.958 = 479 beats 3.86% of 1000 = 38.60. Most scored orders
    // lost money, so being wrong low is the expensive direction.
    const s = suggestShipping({ units: 500, merchTotal: 1000, basis });
    expect(s.estCost).toBe(479);
  });

  test('carries the sample size and observed spread, not just a number', () => {
    const s = suggestShipping({ units: 10, merchTotal: 5000, basis });
    expect(s.sampleN).toBe(107);
    expect(s.lowPct).toBe(2.33);
    expect(s.highPct).toBe(9.05);
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
      basis: { ...basis, median_cost_per_unit: null, p25_cost_pct_merch: null } });
    expect(Number.isFinite(s.dollars)).toBe(true);
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
    expect(src).toContain('spread {sug.lowPct}–{sug.highPct}%');
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
