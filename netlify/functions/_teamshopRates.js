// Team Shop decoration rate card — server-side loader + flat-rate pricer.
//
// Single source of the flat per-piece deco rates the Team Shop storefront
// charges (table: public.teamshop_deco_rates, migration 00198). Consumed by
// BOTH quickorder-quote.js (coach quotes + teamshop-checkout's recompute) and
// teamshop-public-price.js (anonymous builder estimates) so the two paths can
// never disagree on a deco price.
//
// Taxonomy (owner-approved, see 00198):
//   family     — storefront grouping only ('embroidery' | 'heat' | 'screen_print')
//   type       — CONCRETE PRODUCTION IDENTITY ('embroidery' | 'dtf' | 'vinyl' |
//                'silicone_patch' | 'screen_print'); routes the job to the right
//                equipment. Pricing keys off type + option_key, never family.
//   option_key — sub-option within a type ('standard' | 'number' | 'name_number').
//
// ── TRANSITIONAL FALLBACK (read this before touching pricing) ───────────────
// Migration 00198 may not be applied yet when this code deploys. loadRates()
// returns null when the table is missing/unreadable OR has no active rows, and
// BOTH callers then fall back to the legacy decoPricing.dP tables (the exact
// pricing the storefront charged before this rate card existed), logging a
// console.warn. The storefront therefore keeps pricing correctly — at the OLD
// rates — until 00198 is applied. The new heat kinds ('vinyl',
// 'silicone_patch') have NO dP price, so in fallback mode the callers reject
// them rather than charge $0. Once 00198 is live everywhere this fallback can
// be retired.
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Load the active rate rows. Returns an array of rows, or null when the rate
// card is unavailable (table missing / query error / zero active rows) — the
// caller MUST treat null as "fall back to decoPricing.dP".
async function loadRates(admin) {
  try {
    const { data, error } = await admin
      .from('teamshop_deco_rates')
      .select('id,family,type,option_key,label,price,cost,min_qty,sort_order,active')
      .eq('active', true);
    if (error) {
      console.warn('[teamshopRates] rate table unreadable (00198 applied?) — falling back to decoPricing.dP:', error.message);
      return null;
    }
    if (!Array.isArray(data) || !data.length) {
      console.warn('[teamshopRates] no active rate rows (00198 applied?) — falling back to decoPricing.dP');
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[teamshopRates] rate load failed — falling back to decoPricing.dP:', e.message);
    return null;
  }
}

// The rate row for a concrete production type + option ('standard' when the
// deco carries no option). Null when no active row matches.
function rateFor(rates, { type, option } = {}) {
  if (!Array.isArray(rates)) return null;
  const opt = option || 'standard';
  return rates.find((r) => r.type === type && r.option_key === opt) || null;
}

// Flat per-piece sell for one cleaned decoration at a line's quantity.
//   → { sell, rate }                     priced (sell = flat rate, 2dp)
//   → { error: 'MIN_QTY', min, label }   lineQty is under the rate's minimum
//   → { error: 'NO_RATE' }               no active rate row for type/option —
//                                        the caller must REJECT (never $0)
function flatDecoSell(rates, deco, lineQty) {
  const rate = rateFor(rates, { type: deco && deco.type, option: deco && deco.option });
  if (!rate) return { error: 'NO_RATE' };
  const min = Math.max(1, parseInt(rate.min_qty, 10) || 1);
  if ((Number(lineQty) || 0) < min) return { error: 'MIN_QTY', min, label: rate.label };
  return { sell: r2(rate.price), rate };
}

module.exports = { loadRates, rateFor, flatDecoSell };
