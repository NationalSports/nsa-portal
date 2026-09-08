// Suggested shipping charge for the order editor.
//
// Calibration lives in the ship_cost_basis table, refreshed by
// scripts/shipping-audit.js on every run — not in constants here — so the
// suggestion improves as more orders get a recorded actual cost instead of
// needing a code change.
//
// COST IS DRIVEN BY BOXES, NOT GARMENTS. This helper used to multiply a global
// median cost-per-unit by the order's unit count. That is wrong, and wrong in
// the expensive direction: $/unit falls about 20x from the smallest orders to
// the largest, so a rate whose median is set by small orders massively
// overestimates a big one. A real 125-unit order was suggested at $119.75 when
// orders of its own size have a median cost of $74. It also took the HIGHER of
// that and a percent-of-merch estimate, which measured worse than either input
// alone (+$60 mean bias). Both are gone.
//
// What replaced them: ship_cost_basis.size_buckets is the observed cost curve —
// the median, p25 and p75 actual cost of orders in each size class. Pick the
// bucket the order falls in. Measured over the scored orders this halves the
// error of every alternative (mean abs error $45 vs $85 / $78 / $89).
//
// What this still cannot do. Even the bucket median carries a median absolute
// error near $20, because the things that actually set the price — box count,
// dimensions, destination zone — are not recorded on most orders. So this
// returns a range and a sample size alongside the number, and callers must
// present it as a starting point. A confident-looking single number is a lie.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Below this many scored orders overall, the calibration is noise and a
// suggestion would carry more authority than it has earned.
const MIN_SAMPLE = 20;
// And below this many inside the order's own size class, that bucket's median is
// noise even when the overall sample is fine — fall back to percent-of-merch.
const MIN_BUCKET = 5;

// The bucket whose unit range contains qty. max_units null means open-ended.
export function pickSizeBucket(buckets, qty) {
  if (!Array.isArray(buckets)) return null;
  return buckets.find((b) => {
    if (!b) return false;
    const lo = num(b.min_units);
    const hi = b.max_units == null ? Infinity : num(b.max_units);
    return qty >= lo && qty <= hi;
  }) || null;
}

/**
 * @param units      total garment units on the order
 * @param merchTotal order revenue the shipping percentage is applied to
 * @param basis      a ship_cost_basis row, or null
 * @returns {{pct,dollars,estCost,lowCost,highCost,sampleN,basedOn,marginPct}} or null
 */
export function suggestShipping({ units, merchTotal, basis }) {
  if (!basis) return null;
  const n = num(basis.sample_n);
  if (n < MIN_SAMPLE) return null;

  const merch = num(merchTotal);
  if (merch <= 0) return null;
  const qty = num(units);

  // Preferred: what orders of this physical size actually cost.
  const bucket = qty > 0 ? pickSizeBucket(basis.size_buckets, qty) : null;
  const bucketN = bucket ? num(bucket.n) : 0;

  let estCost;
  let lowCost;
  let highCost;
  let sampleN;
  let basedOn;

  if (bucket && bucketN >= MIN_BUCKET && num(bucket.median_cost) > 0) {
    estCost = num(bucket.median_cost);
    lowCost = num(bucket.p25_cost);
    highCost = num(bucket.p75_cost);
    sampleN = bucketN;
    basedOn = 'size';
  } else {
    // Fallback only: no usable size class for this order.
    const pctMerch = num(basis.median_cost_pct_merch);
    if (pctMerch <= 0) return null;
    estCost = merch * (pctMerch / 100);
    lowCost = merch * (num(basis.p25_cost_pct_merch) / 100);
    highCost = merch * (num(basis.p75_cost_pct_merch) / 100);
    sampleN = n;
    basedOn = 'merch';
  }
  if (estCost <= 0) return null;

  // Charge that leaves the target margin ON THE SHIPPING LINE:
  // margin = (charge - cost) / charge, so charge = cost / (1 - margin).
  const marginPct = num(basis.target_margin_pct) || 15;
  const denom = 1 - marginPct / 100;
  const dollars = denom > 0 ? estCost / denom : estCost;

  const r2 = (v) => Math.round(v * 100) / 100;
  return {
    estCost: r2(estCost),
    dollars: r2(dollars),
    pct: Math.round((dollars / merch) * 1000) / 10,   // one decimal
    // The observed spread for THIS estimate, in dollars, so the UI never prints a
    // number next to a range that was computed a different way.
    lowCost: r2(lowCost),
    highCost: r2(highCost),
    sampleN,
    basedOn,
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

export { MIN_SAMPLE, MIN_BUCKET };
