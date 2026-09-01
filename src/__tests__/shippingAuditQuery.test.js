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
const { buildSql, render, FEATURE_SQL, FEATURE_ORDER, parseFeatures } = require('../../scripts/shipping-audit.js');

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

describe('invoice-corrected cost', () => {
  // The whole point of capturing carrier invoices is that the margin figure gets
  // more accurate as they load. If the correction is not wired into the margin,
  // loading invoices improves a side table and leaves the number people quote
  // exactly as wrong as it was.
  test('true cost comes from the invoice where one exists, else the quote', () => {
    const sql = buildSql({ has_rebills: true });
    expect(sql).toContain('coalesce(iv.billed, coalesce(s._shipstation_cost, s._shipping_cost)) as true_cost');
    // Summing billed lines per order, NOT summing per-line adjustments: an invoice
    // that splits one shipment into a base charge plus surcharges carries the same
    // quote on every line, so summing adjustments would subtract it repeatedly.
    expect(sql).toContain('sum(billed_amount) as billed');
  });

  test('the margin rollup reports the corrected figure alongside the quoted one', () => {
    const sql = buildSql({ has_rebills: true });
    expect(sql).toContain("'cost_true'");
    expect(sql).toContain("'margin_true_pct'");
    expect(sql).toContain("'invoiced'");
  });

  test('without the invoices table the corrected cost collapses to the quote', () => {
    const sql = buildSql({});
    expect(sql).not.toContain('ship_carrier_invoices');
    expect(sql).toContain('where false');
  });

  // Regression: has_true_cost was added to the probe SQL but not parsed out of the
  // result row, so the flag stayed false, the snapshot silently wrote NULL for the
  // corrected columns, and the trend showed a dash forever. Asserting the SQL
  // mentions the flag does NOT catch that — the SQL was already correct. The parse
  // is what has to be pinned.
  test('every flag in the probe SQL is actually read out of the result row', () => {
    for (const flag of FEATURE_ORDER) expect(FEATURE_SQL).toContain(flag);
    // A row of all-true must set every flag true; if one is dropped from the parse
    // it stays false here.
    const allTrue = parseFeatures(FEATURE_ORDER.map(() => 't').join('|'));
    for (const flag of FEATURE_ORDER) expect(allTrue[flag]).toBe(true);
  });

  test('a short or empty probe row leaves flags off rather than undefined', () => {
    expect(parseFeatures('t')).toEqual({ has_rebills: true, has_ncc: false, has_true_cost: false });
    expect(parseFeatures('')).toEqual({ has_rebills: false, has_ncc: false, has_true_cost: false });
    expect(parseFeatures(null)).toEqual({ has_rebills: false, has_ncc: false, has_true_cost: false });
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

  test('the corrected margin is stated where the quoted one would be read as measured', () => {
    const out = render({
      ...empty,
      coverage: { total_sos: 2, with_charge: 2, with_cost: 2, scoreable: 2, unparsed_dates: 0,
        window_start: '2026-01-01', window_end: '2026-01-02' },
      margin: [{ shipping_type: 'TOTAL', n: 2, charged: 200, cost: 78, margin_pct: 60.9,
        losers: 0, inbound: 0, cost_true: 113, margin_true_pct: 43.6, losers_true: 0, invoiced: 2 }],
    }, []);
    expect(out).toContain('Corrected for carrier invoices');
    expect(out).toContain('43.6%');
    expect(out).toContain('2 of 2 scored orders');
  });

  test('with no invoices loaded the margin is labelled an upper bound', () => {
    const out = render({
      ...empty,
      coverage: { total_sos: 1, with_charge: 1, with_cost: 1, scoreable: 1, unparsed_dates: 0,
        window_start: '2026-01-01', window_end: '2026-01-02' },
      margin: [{ shipping_type: 'TOTAL', n: 1, charged: 100, cost: 39, margin_pct: 61,
        losers: 0, inbound: 0, cost_true: 39, margin_true_pct: 61, losers_true: 0, invoiced: 0 }],
    }, []);
    expect(out).toContain('upper bound');
    expect(out).not.toContain('Corrected for carrier invoices');
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
