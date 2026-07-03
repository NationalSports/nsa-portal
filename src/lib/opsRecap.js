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
]);
const isSizeKey = (k) => !NON_SIZE.has(k) && !String(k).startsWith('_');
const sizeUnits = (m) => Object.entries(m || {}).reduce((a, [k, v]) => a + (isSizeKey(k) ? num(v) : 0), 0);
const sizeKeys = (m) => Object.keys(m || {}).filter(isSizeKey);

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
// ShipStation marked it shipped, every production job shipped, the order was
// closed out (sticky status='complete'), or — for delivery-preference orders,
// whose terminal step is delivery, never a 'shipped' job state — production is
// done, all goods are in, and the delivered map covers the jobs. (Approximation
// of calcSOStatus's delivery branch: the per-no-deco-line delivered check is
// skipped, and jobless orders require at least one delivered entry so a plain
// stock order can't read as delivered by vacuity.)
function isShippedOut(so, ff) {
  if (!so) return false;
  if (so._shipping_status === 'shipped' || ff.allJobsShipped || so.status === 'complete') return true;
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

module.exports = { NON_SIZE, isSizeKey, sizeUnits, sizeKeys, soFulfillment, isShippedOut, isCheckedIn, shortOnPull, pulledGroups };
