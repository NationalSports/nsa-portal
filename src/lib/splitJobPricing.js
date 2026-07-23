/* eslint-disable */
// ── Split-job pricing runs — stamping layer ──
// When a production job is split, the halves are separate press runs and screen-print setup
// isn't shared, so the design must price each run at its own qty tier (JOB-1393-05: a 1-pc
// run bills the bracket-0 flat charge, the 24-pc run bills the 24-tier rate, blended as an
// average per piece). The pricing math lives in decoPricing.js (spRunBlend / decoSplitRuns,
// keyed off d.split_runs); THIS module derives and stamps d.split_runs onto the order's
// decorations from its jobs, so every consumer of dP (order totals, invoices, commissions,
// dashboards) sees the same partition without threading job state through each caller.
//
// Rules (2026-07-22, per ownership):
//  - Splitting is never a rep pricing choice: every split job is stamped priced_separately
//    and reprices. The rep can only REQUEST an override (warehouse-fault splits); pricing
//    reverts to the combined tier only once an admin approves (price_override.status
//    'approved' on any job covering the design).
//  - Forward-only: only jobs flagged priced_separately (stamped at split time from this
//    change on) partition; pre-existing splits without the flag keep combined pricing.
//  - decoSplitRuns() in decoPricing.js re-validates at price time that the stamped runs
//    still sum to the design's live qty — a stale stamp falls back to combined pricing.
// Same dependency-free CJS pattern as decoPricing.js (shared client/tests).

const safeNum = v => typeof v === 'number' && !isNaN(v) ? v : 0;
const safeArr = v => Array.isArray(v) ? v : [];

// Designs a job covers — multi-design jobs carry _art_ids, single-design jobs art_file_id.
const _jobArtIds = j => (safeArr(j._art_ids).length ? j._art_ids : [j.art_file_id]).filter(Boolean);

// { art_file_id -> [runQty, ...] } for designs whose production is split with separate
// pricing. A design partitions only when at least one covering job is flagged
// priced_separately, no covering job has an APPROVED pricing override, and there are 2+
// live runs. Unflagged sibling jobs still contribute their units as runs — jobs partition
// the design's quantity by construction, and decoSplitRuns' sum check enforces it.
function buildSplitRunMap(jobs) {
  const all = {}; const flaggedIds = new Set(); const overridden = new Set();
  safeArr(jobs).forEach(j => {
    if (!j || j._draft) return;
    const ids = _jobArtIds(j);
    if (j.price_override && j.price_override.status === 'approved') ids.forEach(id => overridden.add(id));
    const u = safeNum(j.total_units);
    if (u <= 0) return;
    ids.forEach(id => {
      (all[id] = all[id] || []).push(u);
      if (j.priced_separately) flaggedIds.add(id);
    });
  });
  const out = {};
  flaggedIds.forEach(id => {
    if (overridden.has(id)) return;
    const runs = all[id] || [];
    if (runs.length >= 2) out[id] = runs;
  });
  return out;
}

// Rewrite each art decoration's split_runs from the order's current jobs. Returns
// { changed, order } — order is the same reference when nothing moved, so callers can
// stamp unconditionally without triggering redundant saves/renders.
function stampSplitRuns(o) {
  if (!o) return { changed: false, order: o };
  const map = buildSplitRunMap(o.jobs);
  let changed = false;
  const items = safeArr(o.items).map(it => {
    if (!it || !safeArr(it.decorations).length) return it;
    let iCh = false;
    const decos = it.decorations.map(d => {
      if (!d || d.kind !== 'art' || !d.art_file_id) return d;
      const runs = map[d.art_file_id] || null;
      const cur = Array.isArray(d.split_runs) && d.split_runs.length ? d.split_runs : null;
      const same = (!runs && !cur) || (!!runs && !!cur && runs.length === cur.length && runs.every((r, i) => safeNum(r) === safeNum(cur[i])));
      if (same) return d;
      iCh = true;
      const nd = Object.assign({}, d);
      nd.split_runs = runs; // null clears a stale stamp
      return nd;
    });
    if (!iCh) return it;
    changed = true;
    return Object.assign({}, it, { decorations: decos });
  });
  return changed ? { changed: true, order: Object.assign({}, o, { items }) } : { changed: false, order: o };
}

module.exports = { buildSplitRunMap, stampSplitRuns };
