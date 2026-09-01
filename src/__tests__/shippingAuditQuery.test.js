/* eslint-disable */
// ═══════════════════════════════════════════════
// REGRESSION — scripts/shipping-audit.js
//
// The audit regenerates SHIPPING_COST_HANDOFF.md from live data. Two things it must not
// get wrong, both of which fail silently rather than loudly:
//   1. It runs against databases at different migration levels. A query referencing a
//      column that does not exist yet errors out and the doc simply stops updating.
//   2. actual_cost is NULL on an unrecorded order. `not (actual_cost > 0)` is NULL, and a
//      FILTER on NULL drops the row — reporting zero unresolved orders at the exact moment
//      every order is unresolved. That is the number the whole document is about.
// ═══════════════════════════════════════════════
const { buildSql, render } = require('../../scripts/shipping-audit.js');

describe('audit query feature detection', () => {
  test('uses the new column and table when the database has them', () => {
    const sql = buildSql({ has_ncc: true, has_rebills: true });
    expect(sql).toContain('coalesce(s.no_carrier_cost, false) as no_carrier_cost');
    expect(sql).toContain('from ship_carrier_invoices');
  });

  test('degrades to literals when the migration has not been applied', () => {
    const sql = buildSql({});
    expect(sql).toContain('false as no_carrier_cost');
    expect(sql).not.toContain('ship_carrier_invoices');
    expect(sql).toContain("'rebills', null");
  });

  test('unresolved count survives a NULL actual_cost', () => {
    const sql = buildSql({ has_ncc: true });
    expect(sql).toContain('coalesce(actual_cost, 0) <= 0');
    // The bare NOT is the bug: it silently counts zero when everything is unrecorded.
    expect(sql).not.toContain('not (actual_cost > 0)');
  });
});

describe('audit rendering', () => {
  const empty = {
    coverage: { total_sos: 0, with_charge: 0, with_cost: 0, scoreable: 0, unparsed_dates: 0,
      window_start: null, window_end: null },
    margin: [], brands: [], adidas_bands: [],
  };

  test('an empty database renders no NaN, Infinity or undefined', () => {
    expect(render(empty, [])).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('an asserted no-carrier-cost order is reported as resolved, not as a gap', () => {
    const out = render({
      ...empty,
      coverage: { total_sos: 2, with_charge: 2, with_cost: 0, scoreable: 0, no_carrier_cost: 1,
        unresolved: 1, unparsed_dates: 0, window_start: '2026-01-01', window_end: '2026-01-02' },
    }, []);
    expect(out).toContain('1 charged order is still unresolved');
    expect(out).toContain('resolved the other way');
  });

  test('rebill totals surface the adjustment the label-time cost never showed', () => {
    const out = render({
      ...empty,
      rebills: { rows: 2, matched_so: 1, quoted: 59.14, billed: 72.8, adjustment: 13.66, dim_weight_adj: 13.66 },
    }, []);
    expect(out).toContain('Carrier rebills');
    expect(out).toContain('$13.66');
  });
});
