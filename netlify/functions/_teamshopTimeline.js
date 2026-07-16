// Team Shop delivery-timeline resolution (table: teamshop_delivery_timelines,
// migration 00203) — the SINGLE implementation both pricing endpoints use, so
// the anonymous product builder and a coach's cart/checkout can never disagree
// on an estimate:
//   * teamshop-public-price.js (anon builder estimates)
//   * quickorder-quote.js buildQuote (coach cart quotes AND teamshop-checkout's
//     quote_totals / place_order recompute, which call buildQuote)
//
// The estimate is DISPLAY METADATA ONLY: never money, never a hash input
// (quickorder-quote's normalizeAndHash whitelists its fields, so an attached
// `timeline` can't flip a quote hash), and the browser never computes it —
// it renders the server's { min_weeks, max_weeks, label } verbatim.
//
// Resolution order (rules live as staff-editable ROWS — see 00203):
//   1. in-stock: NSA warehouse stock (product_inventory) covers the ENTIRE
//      line → the 'in_stock' row's band. Stock is ALLOCATED across the quote's
//      lines (shared makeOnHandAllocator below, the same semantics
//      teamshop-auto-po's computeNeeds uses), so two lines can never both
//      claim the same units.
//   2. otherwise the first active 'source' row (by sort_order) whose
//      inventory_sources contains products.inventory_source.
//   3. then every matching 'deco' override is applied as max(): a deco
//      override can only LENGTHEN the band, never shorten it (adidas ~3 weeks
//      + screen print stays ~3 weeks).
// A line with no matching rule gets null; the order-level estimate is the
// SLOWEST line, and null when ANY line is unknown — never promise a date the
// rules can't back.
//
// Pre-migration / unreadable table: loadTimelines() returns null and
// computeTimelines() returns all-null — the storefront hides the estimate and
// pricing is NEVER blocked (every DB touch in here is failure-isolated).
//
// Cache: the rule rows are tiny and read on the HOT public-price path (one
// hit per product view), so they're cached in module memory for 60s per warm
// lambda — a staff edit takes effect within a minute, and a cold start always
// reads fresh. The per-quote product_inventory read is NOT cached (stock
// moves constantly, and staleness there could promise "~1 week" wrongly).

const CACHE_MS = 60 * 1000;
let _cache = { at: 0, rows: null };

// Load the active timeline rule rows (sorted by sort_order — match priority
// for 'source' rows). Returns the rows array, or null when the table is
// unavailable (00203 not applied / query error / zero active rows) — the
// caller MUST treat null as "no estimates, hide the UI".
async function loadTimelines(admin) {
  if (_cache.at && Date.now() - _cache.at < CACHE_MS) return _cache.rows;
  let rows = null;
  try {
    const { data, error } = await admin
      .from('teamshop_delivery_timelines')
      .select('id,rule_key,rule_type,inventory_sources,deco_type,min_weeks,max_weeks,label,sort_order,active')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) {
      console.warn('[teamshopTimeline] timeline table unreadable (00203 applied?) — no estimates:', error.message);
    } else if (!Array.isArray(data) || !data.length) {
      rows = null; // zero active rows — staff turned everything off
    } else {
      rows = data;
    }
  } catch (e) {
    console.warn('[teamshopTimeline] timeline load failed — no estimates:', e.message);
  }
  _cache = { at: Date.now(), rows };
  return rows;
}

// Tests only — the 60s cache would otherwise leak canned rows between cases.
function _clearCache() { _cache = { at: 0, rows: null }; }

// ── Shared warehouse on-hand allocator ───────────────────────────────
// EXTRACTED from teamshop-auto-po.js's computeNeeds (which now imports it) so
// the timeline in-stock check and the auto-PO needs math share ONE allocation
// semantics: on-hand per (product, size) — size keys trimmed/uppercased — is
// MUTATED as lines claim it, so two lines sharing a product+size never both
// count the same units (under-ordering / over-promising is the dangerous
// direction for both consumers).
function makeOnHandAllocator(inventoryRows) {
  const bySize = {}; // product_id -> { SIZEKEY: remaining qty }
  (inventoryRows || []).forEach((r) => {
    const pid = r.product_id || '';
    if (!pid) return;
    const sizeKey = String(r.size || '').trim().toUpperCase();
    const m = bySize[pid] || (bySize[pid] = {});
    m[sizeKey] = (m[sizeKey] || 0) + (Number(r.quantity) || 0);
  });
  return {
    // Claim up to qty units of (product, size); returns how many were taken.
    take(productId, size, qty) {
      if (!productId) return 0;
      const m = bySize[productId];
      if (!m) return 0;
      const k = String(size || '').trim().toUpperCase();
      const take = Math.min(m[k] || 0, Math.max(0, Number(qty) || 0));
      if (take > 0) m[k] -= take;
      return take;
    },
    // Claim up to qty units of a product across ANY size — used only for the
    // builder's size-less representative 1-pc line (before sizes are picked).
    takeAny(productId, qty) {
      if (!productId) return 0;
      const m = bySize[productId];
      if (!m) return 0;
      let remaining = Math.max(0, Number(qty) || 0);
      let took = 0;
      for (const k of Object.keys(m)) {
        if (!remaining) break;
        const t = Math.min(m[k] || 0, remaining);
        if (t > 0) { m[k] -= t; took += t; remaining -= t; }
      }
      return took;
    },
  };
}

// "~1 week" / "~1.5–2 weeks" — only used when a deco max() merge produces a
// band matching NEITHER contributing row's numbers (so neither staff label
// fits); every plain band shows its row's staff-edited label verbatim.
const wk = (n) => String(Number(n));
const fmtBand = (min, max) => (
  Number(min) === Number(max)
    ? `~${wk(min)} week${Number(min) === 1 ? '' : 's'}`
    : `~${wk(min)}–${wk(max)} weeks`
);

// Resolve one line: base band (in-stock beats source) + deco max() overrides.
// Returns { min_weeks, max_weeks, label } or null (no matching rule).
function resolveTimeline(rows, { inStock, source, decoTypes } = {}) {
  if (!Array.isArray(rows) || !rows.length) return null;
  let base = null;
  if (inStock) base = rows.find((r) => r.rule_type === 'in_stock') || null;
  if (!base && source) {
    base = rows.find((r) => r.rule_type === 'source' && (r.inventory_sources || []).includes(source)) || null;
  }
  if (!base) return null;
  let min = Number(base.min_weeks) || 0;
  let max = Number(base.max_weeks) || 0;
  let label = base.label;
  for (const t of decoTypes || []) {
    const d = rows.find((r) => r.rule_type === 'deco' && r.deco_type === t);
    if (!d) continue;
    const dMin = Number(d.min_weeks) || 0;
    const dMax = Number(d.max_weeks) || 0;
    const nMin = Math.max(min, dMin);
    const nMax = Math.max(max, dMax);
    if (nMin === min && nMax === max) continue; // override never shortens — band unchanged, keep the base label
    label = (nMin === dMin && nMax === dMax) ? d.label : fmtBand(nMin, nMax);
    min = nMin;
    max = nMax;
  }
  return { min_weeks: min, max_weeks: max, label };
}

// Order-level estimate = the SLOWEST line (greatest max_weeks, ties by
// min_weeks). Null when any line is unknown — a partial promise is a wrong one.
function pickSlowest(lineTimelines) {
  const list = Array.isArray(lineTimelines) ? lineTimelines : [];
  if (!list.length || list.some((t) => !t)) return null;
  return list.reduce((slow, t) => (
    t.max_weeks > slow.max_weeks || (t.max_weeks === slow.max_weeks && t.min_weeks > slow.min_weeks) ? t : slow
  ));
}

// ── The one entry point the pricing functions call ───────────────────
// lines:       [{ product_id, size, qty, deco_types }] — priced quote lines
//              in order (size null = the builder's representative line).
// productById: the products the caller ALREADY loaded for pricing (must
//              include inventory_source) — no second products query.
// Returns { lines: [timeline|null per input line], order: timeline|null }.
// Never throws; any failure degrades to nulls (pricing is never blocked).
async function computeTimelines(admin, lines, productById) {
  const inputs = Array.isArray(lines) ? lines : [];
  const nulls = { lines: inputs.map(() => null), order: null };
  try {
    const rows = await loadTimelines(admin);
    if (!rows) return nulls;

    // Warehouse on-hand — one query per quote, only when an in_stock rule is
    // active (staff can deactivate it to skip this read entirely). Unreadable
    // stock = nobody is "in stock" (estimates fail LONG, never short).
    let alloc = null;
    const ids = [...new Set(inputs.map((l) => l && l.product_id).filter(Boolean))];
    if (ids.length && rows.some((r) => r.rule_type === 'in_stock')) {
      try {
        const inv = await admin.from('product_inventory')
          .select('product_id,size,quantity').in('product_id', ids);
        if (!inv.error) alloc = makeOnHandAllocator(inv.data || []);
      } catch (e) { /* treat as no stock data */ }
    }

    const out = inputs.map((l) => {
      if (!l || !l.product_id) return null;
      const p = productById ? productById[l.product_id] : null;
      const qty = Math.max(0, Number(l.qty) || 0);
      let inStock = false;
      if (alloc && qty > 0) {
        // In-stock = the ENTIRE line coverable by warehouse stock (allocated —
        // a partial take still consumes stock, same as computeNeeds, so a
        // later line can't re-claim units this one already needs).
        const took = l.size != null && String(l.size).trim() !== ''
          ? alloc.take(l.product_id, l.size, qty)
          : alloc.takeAny(l.product_id, qty);
        inStock = took >= qty;
      }
      return resolveTimeline(rows, {
        inStock,
        source: p ? (p.inventory_source || null) : null,
        decoTypes: Array.isArray(l.deco_types) ? l.deco_types : [],
      });
    });
    return { lines: out, order: pickSlowest(out) };
  } catch (e) {
    console.warn('[teamshopTimeline] timeline computation failed — no estimates:', e.message);
    return nulls;
  }
}

module.exports = {
  loadTimelines,
  makeOnHandAllocator,
  resolveTimeline,
  pickSlowest,
  fmtBand,
  computeTimelines,
  _clearCache,
};
