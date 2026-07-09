// ── Shared category rules for the rep daily ops recap ──
// One source of truth for the five "what moved on my orders" categories shown in
// BOTH the Sales Tools → My Day tab (src/App.js) and the emailed rep-ops-digest
// (netlify/functions/rep-ops-digest.js). Written in CommonJS so webpack (client)
// and the Netlify function runtime (require) consume the exact same logic and the
// two surfaces can never drift.
//
// Works on either item shape: client items carry pick_lines / po_lines (flattened
// size maps with meta keys mixed in), the digest builds picks / pos the same way
// from so_item_pick_lines / so_item_po_lines. Pick/PO lines are size maps with
// meta keys alongside (status, pick_id, pulled_at, ...) — NON_SIZE filters those.

const num = (v) => (Number(v) || 0);
const parseDate = (d) => { if (!d) return null; const dt = new Date(d); return isNaN(dt.getTime()) ? null : dt; };

// Meta keys that can appear on a flattened pick/PO line (or inside a sizes JSONB
// fallback) that are NOT sizes. Anything starting with '_' is also meta.
const NON_SIZE = new Set([
  'status', 'pick_id', 'pulled_at', 'memo', 'ship_dest', 'ship_addr', 'deco_vendor', 'created_at',
  'id', 'so_item_id', 'po_id', 'vendor', 'expected_date', 'received', 'cancelled', 'billed',
  'shipments', 'tracking_numbers', 'po_type', 'unit_cost', 'drop_ship', 'deco_type', 'notes',
  'shipping', 'preexisting', 'batch_queue_id', 'batch_po_number',
  // PO-line bookkeeping that can appear alongside size buckets (mirrors OrderEditor _PO_SZ_META)
  'email_history', 'api_order_id', 'api_ordered_at', 'vendor_keys',
]);
const isSizeKey = (k) => !NON_SIZE.has(k) && !String(k).startsWith('_');
const sizeUnits = (m) => Object.entries(m || {}).reduce((a, [k, v]) => a + (isSizeKey(k) ? num(v) : 0), 0);
const sizeKeys = (m) => Object.keys(m || {}).filter(isSizeKey);
// Numeric size buckets on a flattened pick/PO line — same discovery rule as desktop warehouse
// receive (exclude meta keys; accept QTY / OS / OSFA / any apparel size). Used by mobile check-in.
const numericSizeKeys = (m) => Object.keys(m || {}).filter((k) => isSizeKey(k) && typeof m[k] === 'number');

const itemsOf = (so) => (so && Array.isArray(so.items) ? so.items : []);
const picksOf = (it) => (it && (it.pick_lines || it.picks)) || [];
const posOf = (it) => (it && (it.po_lines || it.pos)) || [];
// Draft jobs are parked ideas, not production state — excluded everywhere (mirrors
// components.calcSOStatus's boardJobs filter).
const jobsOf = (so) => ((so && Array.isArray(so.jobs) ? so.jobs : [])).filter((j) => j && j.prod_status !== 'draft');

// ── Fulfillment counters (faithful subset of components.calcSOStatus) ──
// qty_only items hold their quantity in est_qty (sizes is empty); POs/picks track
// them under the 'QTY' key.
function soFulfillment(so) {
  let totalSz = 0, coveredSz = 0, fulfilledSz = 0;
  itemsOf(so).forEach((it) => {
    let entries = Object.entries(it.sizes || {}).filter(([k, v]) => isSizeKey(k) && num(v) > 0);
    if (entries.length === 0 && num(it.est_qty) > 0) entries = [['QTY', num(it.est_qty)]];
    entries.forEach(([sz, v]) => {
      totalSz += v;
      const picked = picksOf(it).reduce((a, pk) => a + num(pk[sz]), 0);
      const poOrd = posOf(it).reduce((a, pk) => a + num(pk[sz]) - num((pk.cancelled || {})[sz]), 0);
      coveredSz += Math.min(v, picked + poOrd);
      const pulledQty = picksOf(it).filter((pk) => pk.status === 'pulled').reduce((a, pk) => a + num(pk[sz]), 0);
      const rcvdQty = posOf(it).reduce((a, pk) => a + num((pk.received || {})[sz]), 0);
      fulfilledSz += Math.min(v, pulledQty + rcvdQty);
    });
  });
  const jobs = jobsOf(so);
  const allJobsShipped = jobs.length > 0 && jobs.every((j) => j.prod_status === 'shipped');
  const anyActiveJob = jobs.some((j) => j.prod_status === 'staging' || j.prod_status === 'in_process');
  return { totalSz, coveredSz, fulfilledSz, allJobsShipped, anyActiveJob };
}

// ── Shipped / fulfilled-out ──
// A REAL shipping signal: ShipStation/job-ship marked it shipped (_shipped /
// _shipping_status), every production job shipped, or — for delivery-preference
// orders, whose terminal step is delivery, never a 'shipped' job state —
// production is done, all goods are in, and the delivered map covers the jobs.
// Deliberately NOT `status === 'complete'`: OMG store orders and manually closed
// orders finalize WITHOUT a shipping step, so completion alone must not read as
// "shipped" (it was surfacing un-shipped OMG orders under Orders Shipped).
// (Approximation of calcSOStatus's delivery branch: the per-no-deco-line delivered
// check is skipped, and jobless orders require at least one delivered entry so a
// plain stock order can't read as delivered by vacuity.)
function isShippedOut(so, ff) {
  if (!so) return false;
  if (so._shipped === true || so._shipping_status === 'shipped' || ff.allJobsShipped) return true;
  if (so.ship_preference === 'warehouse_delivery' || so.ship_preference === 'deliver_on_date') {
    const dlv = so.delivered || {};
    const jobs = jobsOf(so);
    const allJobsDone = jobs.every((j) => j.prod_status === 'completed' || j.prod_status === 'shipped');
    const allJobsDelivered = jobs.every((j) => dlv['job|' + j.id]);
    const anyDelivered = jobs.length > 0 || Object.keys(dlv).length > 0;
    if (anyDelivered && allJobsDone && allJobsDelivered && ff.totalSz > 0 && ff.fulfilledSz >= ff.totalSz) return true;
  }
  return false;
}

// ── All checked in ──
// Every ordered unit is physically in (received on a PO or pulled from stock) and
// nothing is on press yet. Deliberately NOT calcSOStatus==='items_received': a
// fully-received NO-DECO order reports 'ready_to_invoice' there and would be
// silently skipped — the rep still wants to know the goods are all in.
function isCheckedIn(so, ff) {
  if (!so || so.status === 'complete') return false; // closed/finalized — not a fresh check-in
  return !isShippedOut(so, ff) && ff.totalSz > 0 && ff.fulfilledSz >= ff.totalSz && !ff.anyActiveJob;
}

// ── Short on pull (the exact if_short rule from the dashboard todo builder) ──
// Only fires when the warehouse is DONE (every IF pulled), stock came up short,
// and no covering PO exists. A size the order asks for that no pulled pick ever
// carried was added after the pull — new demand, not a shortfall — so skip it.
function shortOnPull(so) {
  let units = 0; const parts = [];
  itemsOf(so).forEach((it) => {
    const picks = picksOf(it);
    if (picks.length === 0 || picks.some((pk) => pk.status !== 'pulled')) return;
    const pulledKeys = new Set(); picks.forEach((pk) => sizeKeys(pk).forEach((k) => pulledKeys.add(k)));
    const szKeys = sizeKeys(it.sizes).filter((k) => num((it.sizes || {})[k]) > 0);
    if (szKeys.some((sz) => !pulledKeys.has(sz))) return; // line edited after its pull → not a short
    let itShort = 0; const bySz = {};
    szKeys.forEach((sz) => {
      const ordered = num(it.sizes[sz]); if (ordered <= 0) return;
      const pulled = picks.reduce((a, pk) => a + (pk.status === 'pulled' ? num(pk[sz]) : 0), 0);
      const onPO = posOf(it).reduce((a, po) => a + num(po[sz]) - num((po.cancelled || {})[sz]), 0);
      const sh = Math.max(0, ordered - pulled - onPO); if (sh > 0) { itShort += sh; bySz[sz] = sh; }
    });
    if (itShort > 0) { units += itShort; parts.push(`${it.sku || it.name || 'Item'} (${Object.entries(bySz).map(([s, n]) => `${s}:${n}`).join(', ')})`); }
  });
  return units > 0 ? { units, detail: parts.join(' · ') } : null;
}

// ── IFs pulled inside a window, grouped by pick_id (one row per IF even when it
// spans several line items; legacy pulled lines without a pick_id stay per-line).
// inWin: (dateish) => boolean. Returns [{pickId, units, skus[], latest}].
function pulledGroups(so, inWin) {
  const groups = {};
  itemsOf(so).forEach((it) => picksOf(it).forEach((pk) => {
    if (!pk || pk.status !== 'pulled' || !inWin(pk.pulled_at)) return;
    const key = pk.pick_id || `line:${it.sku || it.name || ''}`;
    const g = groups[key] || (groups[key] = { pickId: pk.pick_id || null, units: 0, skus: [], latest: pk.pulled_at });
    g.units += sizeUnits(pk);
    const lbl = it.sku || it.name; if (lbl && !g.skus.includes(lbl)) g.skus.push(lbl);
    if (parseDate(pk.pulled_at) > parseDate(g.latest)) g.latest = pk.pulled_at;
  }));
  return Object.values(groups);
}

// ── Ready to invoice ──
// Production is finished but the order hasn't shipped/closed and isn't a promo
// (promos skip the invoicing funnel). Mirrors the two calcSOStatus branches that
// yield 'ready_to_invoice': every production job done, or a pure no-deco stock
// order with all units in. The "already invoiced?" test lives at the call site
// (needs the invoices table), so callers should also exclude SOs that already
// have a non-void invoice.
function isReadyToInvoice(so, ff) {
  if (!so || so.status === 'complete' || so.promo_applied) return false;
  if (isShippedOut(so, ff)) return false;
  if (ff.totalSz <= 0) return false;
  const jobs = jobsOf(so);
  if (jobs.length > 0) return jobs.every((j) => j.prod_status === 'completed' || j.prod_status === 'shipped');
  return itemsOf(so).every((it) => it.no_deco === true) && ff.fulfilledSz >= ff.totalSz;
}

// ── Shipped — not invoiced (money recovery) ──
// isReadyToInvoice deliberately stops firing once an order ships, so an order that
// shipped without ever being invoiced falls out of the invoicing funnel entirely
// and the revenue silently leaks. This catches those: a real shipping signal and
// still no invoice. Webstore/OMG store orders are paid at checkout and promos skip
// invoicing — both excluded. Like isReadyToInvoice, the "has no non-void invoice?"
// half lives at the call site (needs the invoices table), so callers must also
// exclude SOs that already have a non-void invoice.
function isShippedNotInvoiced(so, ff) {
  if (!so || so.promo_applied || so.source === 'webstore') return false;
  return isShippedOut(so, ff);
}

// ── Goods-only order value ──
// units × unit_sell (size-level sells when present), free-promo lines excluded,
// est_qty fallback for qty_only lines. No decoration/shipping/tax — those need the
// full client pricing engine — so it UNDERSTATES the invoiceable total. Used for
// the digest's dollar callouts where the client's calcOrderMargin isn't available.
function soGoodsValue(so) {
  return itemsOf(so).reduce((acc, it) => {
    if (it.is_free_promo) return acc;
    let units = 0, rev = 0;
    Object.entries(it.sizes || {}).forEach(([k, v]) => {
      if (!isSizeKey(k)) return; const n = num(v); if (n <= 0) return;
      units += n; rev += n * num((it._sizeSells || {})[k] || it.unit_sell);
    });
    if (units === 0) rev = num(it.est_qty) * num(it.unit_sell);
    return acc + rev;
  }, 0);
}

// ── Quote aging (the dashboard follow-up tiers, shared with the digest) ──
// Days since a sent estimate last moved (updated_at, falling back to created_at).
// Stamps are locale "M/D/YYYY, h:mm:ss AM" or ISO; the anchored match parses the
// locale form with its full year (the todo builder's old inline regex truncated
// "12/10/2026" to year 2020). Tiers per the dashboard todo builder:
// 3-6d follow up · 7-13d going cold · 14d+ stale.
const QUOTE_FOLLOWUP_DAYS = 3, QUOTE_COLD_DAYS = 7, QUOTE_STALE_DAYS = 14;
const quoteAgeDays = (est, nowMs) => {
  const stamp = est && (est.updated_at || est.created_at); if (!stamp) return null;
  const s = String(stamp);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  const d = m ? new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]) : new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.floor(((nowMs != null ? nowMs : Date.now()) - d.getTime()) / 864e5);
};
const quoteColdBucket = (days) => (days == null || days < QUOTE_FOLLOWUP_DAYS ? null
  : days < QUOTE_COLD_DAYS ? 'follow_up' : days < QUOTE_STALE_DAYS ? 'going_cold' : 'stale');

// ── Invoice A/R helpers ──
const invoiceBalance = (inv) => {
  if (!inv) return 0;
  const st = String(inv.status || '').toLowerCase();
  if (st === 'void' || st === 'paid') return 0;
  return (Number(inv.total) || 0) - (Number(inv.paid) || 0);
};
// An open, collectable invoice: not void/paid/deleted, not a credit memo, balance left.
const isOpenInvoice = (inv) => {
  if (!inv || inv.deleted_at) return false;
  if (String(inv.type || 'invoice').toLowerCase() === 'credit_memo') return false;
  return invoiceBalance(inv) > 0.005;
};
// Whole-day count from due date to a reference YYYY-MM-DD (both parsed at UTC
// midnight so there's no timezone drift). >0 = past due. null when no due date.
const invoiceDaysPastDue = (inv, todayYmd) => {
  if (!inv || !inv.due_date) return null;
  const due = String(inv.due_date).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !/^\d{4}-\d{2}-\d{2}$/.test(todayYmd || '')) return null;
  return Math.round((Date.parse(todayYmd + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / 864e5);
};
// Calendar date (YYYY-MM-DD) from a payment/invoice date string. Payments are
// usually stored date-only (toLocaleDateString → "M/D/YYYY"), sometimes ISO — take
// the literal calendar date from either so there's no timezone shift.
const dateYmd = (dstr) => {
  const s = String(dstr == null ? '' : dstr).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const dt = new Date(s); if (isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
};
// Most recent payment's calendar date across a payments array ([{amount,date}]).
const paymentsLatestYmd = (payments) => {
  let best = null;
  (payments || []).forEach((p) => { const y = dateYmd(p && p.date); if (y && (!best || y > best)) best = y; });
  return best;
};
// An invoice whose balance is fully settled (status paid, or paid covers total).
const isFullyPaidInvoice = (inv) => {
  if (!inv || inv.deleted_at) return false;
  const st = String(inv.status || '').toLowerCase();
  if (st === 'void') return false;
  const total = Number(inv.total) || 0, paid = Number(inv.paid) || 0;
  return st === 'paid' || (total > 0 && paid >= total - 0.005);
};
const AGING_BUCKETS = ['1-30', '31-60', '61-90', '90+'];
const agingBucket = (dpd) => (dpd == null || dpd < 1 ? 'current' : dpd <= 30 ? '1-30' : dpd <= 60 ? '31-60' : dpd <= 90 ? '61-90' : '90+');

module.exports = {
  NON_SIZE, isSizeKey, sizeUnits, sizeKeys, numericSizeKeys, soFulfillment, isShippedOut, isCheckedIn, shortOnPull, pulledGroups,
  isReadyToInvoice, isShippedNotInvoiced, soGoodsValue, invoiceBalance, isOpenInvoice, invoiceDaysPastDue, AGING_BUCKETS, agingBucket,
  dateYmd, paymentsLatestYmd, isFullyPaidInvoice,
  quoteAgeDays, quoteColdBucket, QUOTE_FOLLOWUP_DAYS, QUOTE_COLD_DAYS, QUOTE_STALE_DAYS,
};
