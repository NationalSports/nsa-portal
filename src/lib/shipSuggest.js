// Suggested shipping charge for the order editor.
//
// Calibration lives in the ship_cost_basis table, refreshed by
// scripts/shipping-audit.js on every run — not in constants here — so the
// suggestion improves as more orders get a recorded actual cost instead of
// needing a code change.
//
// What this can and cannot do. Across orders with a recorded cost, shipping
// cost correlates only about 0.5 with both unit count and merchandise value,
// and the middle half of orders spans roughly 2%-9% of merch. Shipping cost is
// genuinely not well predicted by anything known at quote time; that is the
// audit's central finding, not a modelling failure. So this returns a range and
// a sample size alongside the number, and callers must present it as a starting
// point. A confident-looking single number here would be a lie.
//
// The estimate deliberately takes the HIGHER of the two bases. On the orders we
// can score, most lost money on shipping, so being wrong low is the expensive
// direction.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Below this many scored orders the medians are noise, and a suggestion would
// carry more authority than it has earned.
const MIN_SAMPLE = 20;

/**
 * @param units      total garment units on the order
 * @param merchTotal order revenue the shipping percentage is applied to
 * @param basis      a ship_cost_basis row, or null
 * @returns {{pct,dollars,estCost,sampleN,lowPct,highPct,perUnit,marginPct}} or null
 */
export function suggestShipping({ units, merchTotal, basis }) {
  if (!basis) return null;
  const n = num(basis.sample_n);
  if (n < MIN_SAMPLE) return null;

  const merch = num(merchTotal);
  const qty = num(units);
  if (merch <= 0) return null;

  const perUnit = num(basis.median_cost_per_unit);
  const pctMerch = num(basis.median_cost_pct_merch);

  // Two independent reads on the same order; take the more cautious.
  const byUnits = qty > 0 && perUnit > 0 ? qty * perUnit : 0;
  const byMerch = pctMerch > 0 ? merch * (pctMerch / 100) : 0;
  const estCost = Math.max(byUnits, byMerch);
  if (estCost <= 0) return null;

  // Charge that leaves the target margin ON THE SHIPPING LINE:
  // margin = (charge - cost) / charge, so charge = cost / (1 - margin).
  const marginPct = num(basis.target_margin_pct) || 15;
  const denom = 1 - marginPct / 100;
  const dollars = denom > 0 ? estCost / denom : estCost;

  return {
    estCost: Math.round(estCost * 100) / 100,
    dollars: Math.round(dollars * 100) / 100,
    pct: Math.round((dollars / merch) * 1000) / 10,   // one decimal
    sampleN: n,
    // The observed spread, carried through so the UI can show that the point
    // estimate sits inside a wide band rather than implying precision.
    lowPct: num(basis.p25_cost_pct_merch),
    highPct: num(basis.p75_cost_pct_merch),
    perUnit,
    marginPct,
  };
}

// Units on an order: sum the per-size quantities, falling back to est_qty.
// Mirrors how the editors and the audit both total a line.
export function orderUnits(items) {
  return (Array.isArray(items) ? items : []).reduce((total, it) => {
    const sizes = it && it.sizes && typeof it.sizes === 'object' ? it.sizes : {};
    const summed = Object.values(sizes).reduce((a, v) => a + num(v), 0);
    return total + (summed > 0 ? summed : num(it && it.est_qty));
  }, 0);
}

export { MIN_SAMPLE };
