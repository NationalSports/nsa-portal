/* eslint-disable */
// ═══════════════════════════════════════════════
// EXTRACTED BUSINESS LOGIC — testable pure functions
// These functions mirror the logic in App.js for testing
// ═══════════════════════════════════════════════

// ── Safe Accessors ──
const safe = (v, def) => v != null ? v : def;
const safeArr = (v) => Array.isArray(v) ? v : [];
const safeObj = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const safeNum = (v) => typeof v === 'number' && !isNaN(v) ? v : 0;
const safeStr = (v) => typeof v === 'string' ? v : '';
const safeSizes = (it) => safeObj(it?.sizes);
const safePicks = (it) => safeArr(it?.pick_lines);
const safePOs = (it) => safeArr(it?.po_lines);
const safeDecos = (it) => safeArr(it?.decorations);
const safeItems = (o) => safeArr(o?.items);
const safeArt = (o) => safeArr(o?.art_files);
const safeJobs = (o) => safeArr(o?.jobs);

// ── Pricing ──
const rQ = v => Math.round(v * 4) / 4;
const rT = v => Math.round(v * 10) / 10;
const SP = { bk: [{ min: 1, max: 11 }, { min: 12, max: 23 }, { min: 24, max: 35 }, { min: 36, max: 47 }, { min: 48, max: 71 }, { min: 72, max: 107 }, { min: 108, max: 143 }, { min: 144, max: 215 }, { min: 216, max: 499 }, { min: 500, max: 99999 }], pr: { 0: [50, 60, 70, null, null], 1: [3.33, 4.33, 5.33, 6, null], 2: [2.33, 3, 4, 4.67, 5.33], 3: [2.13, 2.83, 3.17, 4, 5], 4: [1.97, 2.57, 2.83, 3.33, 4], 5: [1.83, 2.33, 2.63, 3, 3.5], 6: [1.67, 2.13, 2.47, 2.67, 3.17], 7: [1.5, 2, 2.33, 2.5, 2.83], 8: [1.4, 1.9, 2.07, 2.2, 2.67], 9: [1.27, 1.83, 1.93, 2.07, 2.5] }, mk: 1.5, ub: 0.15 };
// fl = minimum per-piece sell price (floor); mirrors EM.fl in pricing.js / App.js.
const EM = { sb: [10000, 15000, 20000, 999999], qb: [6, 24, 48, 99999], pr: [[8, 8.5, 8, 7.5], [9, 8.5, 8, 8], [10, 9.5, 9, 9], [12, 12.5, 12, 10]], mk: 1.6, fl: 8 };
const NP = { bk: [10, 50, 99999], co: [4, 3, 3], se: [7, 6, 5], tc: 3 };
const DTF = [{ label: '4" Sq & Under', cost: 2.5, sell: 4.5 }, { label: 'Front Chest (12"x4")', cost: 4.5, sell: 7.5 }];

// Bracket 0 (under 12) stores sell price (flat total); other brackets store cost.
function spP(q, c, s = true) { const bi = SP.bk.findIndex(b => q >= b.min && q <= b.max); if (bi < 0 || c < 1 || c > 5) return 0; const v = SP.pr[bi]?.[c - 1]; if (v == null) return 0; if (bi === 0) return s ? v : rQ(v / SP.mk); return s ? rT(v * SP.mk) : v }
// EM.pr stores cost; sell = rT(cost × EM.mk).
function emP(st, q, s = true) { const si = EM.sb.findIndex(b => st <= b); const qi = EM.qb.findIndex(b => q <= b); if (si < 0 || qi < 0) return 0; const v = EM.pr[si][qi]; return s ? Math.max(rT(v * EM.mk), EM.fl || 0) : v }
function npP(q, tw = false, s = true) { const bi = NP.bk.findIndex(b => q <= b); if (bi < 0) return 0; return s ? (NP.se[bi] + (tw ? rQ(NP.tc * 1.65) : 0)) : (NP.co[bi] + (tw ? NP.tc : 0)) }

function dP(d, q, artFiles, cq) {
  const pq = cq || q;
  if (d.kind === 'art' && d.art_file_id && artFiles) {
    if (d.art_file_id === '__tbd') { const tType = d.art_tbd_type || 'screen_print';
      if (tType === 'screen_print') { const nc = d.tbd_colors || 1; const u = d.underbase ? 1 + SP.ub : 1; const c = rQ(spP(pq, nc, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
      if (tType === 'embroidery') { const c = emP(d.tbd_stitches || 8000, pq, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
      if (tType === 'heat_press' || tType === 'dtf') { const t = DTF[d.tbd_dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } };
      return { sell: d.sell_override || 0, cost: 0 } }
    const art = artFiles.find(a => a.id === d.art_file_id); if (art) {
      if (art.deco_type === 'screen_print') { const nc = art.ink_colors ? art.ink_colors.split('\n').filter(l => l.trim()).length : 1; const u = d.underbase ? 1 + SP.ub : 1; const c = rQ(spP(pq, nc, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
      if (art.deco_type === 'embroidery') { const c = emP(art.stitches || 8000, pq, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
      if (art.deco_type === 'dtf' || art.deco_type === 'heat_press') { const t = DTF[art.dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } } } }
  if (d.type === 'screen_print') { const u = d.underbase ? 1 + SP.ub : 1; const c = rQ(spP(q, d.colors || 1, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
  if (d.type === 'embroidery') { const c = emP(d.stitches || 8000, q, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
  if (d.kind === 'numbers' || d.type === 'number_press') {
    // Mirror src/pricing.js dP() exactly so the editor and QB billing agree.
    if (d.num_method === 'sublimated') { const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; const useQty = nq || safeNum(d.num_qty) || 0; const mult = (d.front_and_back ? 2 : 1) * (d.reversible ? 2 : 1); return { sell: safeNum(d.sell_override) || 0, cost: 0, _nq: useQty * mult } }
    const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; const hasAssigned = nq > 0; const useQty = hasAssigned ? nq : (safeNum(d.num_qty) || q); const mult = (d.front_and_back ? 2 : 1) * (d.reversible ? 2 : 1); const fnq = useQty * mult;
    // Price the per-number volume break at the doubled application count (fnq), not the garment qty.
    return { sell: d.sell_override != null ? d.sell_override : npP(fnq || 1, d.two_color, true), cost: npP(fnq || 1, d.two_color, false), _nq: fnq } };
  if (d.kind === 'names') { const nc = d.names ? Object.values(d.names).flat().filter(v => v && v.trim()).length : 0; const se = safeNum(d.sell_override || d.sell_each || 6); const co = safeNum(d.cost_each || 3); return { sell: nc > 0 ? rQ(nc * se / q) : se, cost: nc > 0 ? rQ(nc * co / q) : co } };
  if (d.type === 'dtf') { const t = DTF[d.dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } }
  if (d.kind === 'outside_deco') return { sell: d.sell_override || safeNum(d.sell_each), cost: safeNum(d.cost_each) };
  return { sell: 0, cost: 0 }
}

// ── PO Committed ──
const poCommitted = (poLines, sz) => (poLines || []).reduce((a, pk) => { const ordered = pk[sz] || 0; const cancelled = (pk.cancelled || {})[sz] || 0; return a + (ordered - cancelled) }, 0);

// ── Booking Order Helpers ──
function isBookingOrder(ord) {
  return ord?.order_type === 'booking';
}

function bookingDaysUntilShip(ord) {
  if (!ord?.expected_ship_date) return null;
  return Math.ceil((new Date(ord.expected_ship_date) - new Date()) / (1000 * 60 * 60 * 24));
}

function isBookingActive(ord) {
  if (!isBookingOrder(ord)) return true;
  if (ord.booking_confirmed) return true;
  const days = bookingDaysUntilShip(ord);
  const threshold = safeNum(ord.booking_alert_days) || 100;
  return days !== null && days <= threshold;
}

// ── SO Status Calculation ──
function calcSOStatus(ord) {
  // Booking orders stay in 'booking' status until confirmed or within 100 days of ship
  if (isBookingOrder(ord) && !isBookingActive(ord)) return 'booking';

  let totalSz = 0, coveredSz = 0, fulfilledSz = 0;
  safeItems(ord).forEach(it => {
    let entries = Object.entries(safeSizes(it)).filter(([, v]) => safeNum(v) > 0);
    // qty_only items hold their quantity in est_qty (sizes is empty); POs/picks track them under the 'QTY' key
    if (entries.length === 0 && safeNum(it.est_qty) > 0) entries = [['QTY', safeNum(it.est_qty)]];
    entries.forEach(([sz, v]) => {
      totalSz += v;
      const picked = safePicks(it).reduce((a, pk) => a + safeNum(pk[sz]), 0);
      const poOrd = safePOs(it).reduce((a, pk) => a + safeNum(pk[sz]) - safeNum((pk.cancelled || {})[sz]), 0);
      coveredSz += Math.min(v, picked + poOrd);
      const pulledQty = safePicks(it).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
      const rcvdQty = safePOs(it).reduce((a, pk) => a + safeNum((pk.received || {})[sz]), 0);
      fulfilledSz += Math.min(v, pulledQty + rcvdQty);
    });
  });
  if (totalSz === 0) return 'need_order';
  const boardJobs = safeJobs(ord);
  const hasJobs = boardJobs.length > 0;
  const allJobsShipped = hasJobs && boardJobs.every(j => j.prod_status === 'shipped');
  const allJobsDone = hasJobs && boardJobs.every(j => j.prod_status === 'completed' || j.prod_status === 'shipped');
  const anyJobActive = hasJobs && boardJobs.some(j => j.prod_status === 'staging' || j.prod_status === 'in_process');
  const hasAnyDeco = safeItems(ord).some(it => !it.no_deco && safeDecos(it).length > 0);
  if (allJobsShipped) return 'complete';
  // Delivery-preference orders: delivery is the terminal fulfillment step (the equivalent of
  // shipping). Complete once production is done, all goods are in, and every deliverable is
  // marked in the delivered map — these orders never pass through a 'shipped' job state.
  const isDeliveryPref = ord.ship_preference === 'warehouse_delivery' || ord.ship_preference === 'deliver_on_date';
  if (isDeliveryPref) {
    const dlv = ord.delivered || {};
    const noActiveJobs = !hasJobs || allJobsDone;
    const allJobsDelivered = boardJobs.every(j => dlv['job|' + j.id]);
    const noDecoDelivered = safeItems(ord).every((it, idx) => {
      if (!it.no_deco && safeDecos(it).length > 0) return true;
      const units = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
      return units <= 0 || !!dlv['nd|' + idx];
    });
    if (noActiveJobs && fulfilledSz >= totalSz && allJobsDelivered && noDecoDelivered) return 'complete';
  }
  if (!hasAnyDeco && !hasJobs && fulfilledSz >= totalSz) return ord.status === 'complete' ? 'complete' : 'ready_to_invoice';
  if (allJobsDone) return 'ready_to_invoice';
  if (anyJobActive) return 'in_production';
  if (fulfilledSz >= totalSz) return 'items_received';
  if (coveredSz >= totalSz) return 'waiting_receive';
  return 'need_order';
}

// ── Outside decoration (deco POs) ──
// Which deco TYPES are outsourced for each item. A deco PO (SO-level so.deco_pos) and an item-level
// outside-deco PO line each carry a single deco_type and a set of items — when sending work out, the
// rep picks ONE type plus the items it covers. So outsourcing is per DECO TYPE, not per whole item: a
// garment embroidered out of house can still carry a screen-print / DTF / names / numbers run produced
// in-house, and that run still needs its own production job. Returns { [item_idx]: Set<deco_type|'*'> };
// a covering PO with no deco_type can't be matched by type, so it's recorded as '*' (wildcard) and
// suppresses every decoration on that item — preserving the legacy all-or-nothing behavior.
const outsourcedDecoTypes = (o) => {
  const map = {};
  const add = (ix, t) => { (map[ix] || (map[ix] = new Set())).add(t || '*'); };
  safeArr(o?.deco_pos).forEach(dp => safeArr(dp?.item_idxs).forEach(ix => add(ix, dp?.deco_type)));
  safeItems(o).forEach((it, ii) => safePOs(it).forEach(pl => { if (pl && pl.po_type === 'outside_deco') add(ii, pl.deco_type); }));
  return map;
};
// Is a decoration whose resolved type is `concreteDt` produced by an outside vendor (so it must NOT
// spawn an in-house production job)? `outTypes` is the Set returned above for the item (undefined when
// nothing is outsourced). Art with no file assigned yet has no concrete type (pass null/undefined):
// while the item is outsourced we treat that as covered, so a not-yet-assigned design doesn't spawn a
// mistyped placeholder job — once art is assigned, a type that doesn't match the PO un-suppresses it.
const decoIsOutsourced = (outTypes, concreteDt) => !!outTypes && (outTypes.has('*') || !concreteDt || outTypes.has(concreteDt));

// Resolve a decoration's CONCRETE deco type — the art file's type is the source of truth once a
// real design is attached, else the decoration's own type hint. `null` for an art deco that has no
// file/type yet. Mirrors exactly how syncJobs classifies a decoration so jobs and costs never drift.
const decoConcreteType = (o, d) => {
  if (!d) return null;
  if (d.kind === 'art') { const af = d.art_file_id ? safeArt(o).find(a => a.id === d.art_file_id) : null; return (af && af.deco_type) || d.deco_type || null; }
  if (d.kind === 'numbers') return d.num_method || 'heat_transfer';
  if (d.kind === 'names') return d.name_method || 'heat_press';
  return d.deco_type || d.type || null;
};
// THE unified in-house↔outside switch. A decoration is produced outside when it carries a legacy
// kind:'outside_deco', or a covering deco PO (SO-level o.deco_pos or an item-level outside-deco PO
// line) matches its resolved type. This is the single gate BOTH job creation (syncJobs) and cost
// accounting (Costs tab) read, so routing a decoration onto a deco PO suppresses its in-house job
// AND its in-house cost together — never double-counting the in-house cost against the PO's bill.
// Pass a precomputed outsourcedDecoTypes(o) as `outByItem` when calling inside an item loop.
const isDecoOutsourced = (o, itemIdx, d, outByItem) => {
  if (!d) return false;
  if (d.kind === 'outside_deco') return true;
  // Soft routing flag / explicit PO link (Slice 2): a decoration marked outside, or bundled onto a
  // deco PO, is produced by the vendor — no in-house job, cost from the PO.
  if (d.fulfillment === 'outside' || d.deco_po_id) return true;
  const map = outByItem || outsourcedDecoTypes(o);
  return decoIsOutsourced(map[itemIdx], decoConcreteType(o, d));
};

// ── Underbase rule ── Screen-print on anything darker than white / light grey / vegas gold needs
// a white underbase (NSA rule). Returns true when the garment color needs one; blank color → false
// (unknown, don't auto-charge). Used to auto-apply the underbase upcharge on pricing lookups.
const _LIGHT_GARMENT = /white|vegas|(?:light|lt)[\s.]*gr[ae]y/i;
const garmentNeedsUnderbase = (color) => { const c = safeStr(color).trim(); return c ? !_LIGHT_GARMENT.test(c) : false; };

// ── ONE asset resolver (Layer 3 of the one-process art model) ──
// Resolve a design's image for a given color way, keyed on the STABLE `color_way_id` (never the CW
// label string). One function for BOTH the web logo (the standalone cutout placed on a garment
// color) and the mock (the approval proof) so Webstores / OrderEditor / CoachPortal all agree on
// one fallback chain instead of five ad-hoc ones. Returns a url string, or '' when nothing resolves.
//   sel = { kind: 'web_logo' | 'mock', colorWayId, sku, color }
const _assetUrl = (f) => (typeof f === 'string' ? f : (f && (f.url || f.name)) || '');
function pickCwAsset(art, sel) {
  if (!art || !sel) return '';
  const cwId = sel.colorWayId || null;
  if (sel.kind === 'web_logo') {
    const wl = safeArr(art.web_logos).filter((w) => w && w.url);
    if (cwId) {
      const m = wl.find((w) => w.color_way_id === cwId); if (m) return m.url;
      // Legacy label-keyed entry (pre-Decision-2 data): recover the match through the art's
      // own color_ways — the CW id names a label, and an entry tagged with that label is it.
      const cw = safeArr(art.color_ways).find((c) => c && c.id === cwId);
      const lbl = cw ? String(cw.garment_color || '').trim().toLowerCase() : '';
      if (lbl) { const lm = wl.find((w) => String(w.color_way || '').trim().toLowerCase() === lbl); if (lm) return lm.url; }
    }
    // blank/default web logo applies to all garments; then legacy single, then design-level default
    const def = wl.find((w) => w.is_default || (!w.color_way_id && !w.color_way));
    if (def) return def.url;
    if (wl.length && !cwId) return wl[0].url;
    return safeStr(art.web_logo_url) || safeStr(art.preview_url) || '';
  }
  // mock: per-garment mockups first (sku|color, with legacy plain-sku fallback), then general bucket
  const im = safeObj(art.item_mockups);
  const pool = [];
  if (sel.sku != null) {
    const ck = sel.sku + '|' + (sel.color || '');
    if (Array.isArray(im[ck])) pool.push(...im[ck]);
    if (Array.isArray(im[sel.sku])) pool.push(...im[sel.sku]);
  }
  if (Array.isArray(art.mockup_files)) pool.push(...art.mockup_files);
  // A CW-tagged mock matches only its own color way; if none matches, fall back to UNTAGGED mocks
  // only — a color-specific mock must never bleed onto a non-matching garment (mirrors #942).
  if (cwId) { const m = pool.find((f) => f && f.color_way_id === cwId); if (m) return _assetUrl(m); }
  const untagged = pool.find((f) => f && !(typeof f === 'object' && f.color_way_id));
  return untagged ? _assetUrl(untagged) : '';
}

// ── Web-logo re-keying (Decision 2 of the CW web-logo model) ── Stamp the stable
// color_way_id onto label-keyed web_logos[] entries so resolution never rides on the CW
// label string (a rename silently breaks label matches). Blank-label entries are the
// "all garments" default (is_default). Labels are kept for display. Idempotent: entries
// whose color_way_id still points at a live CW pass through untouched; a stale id gets
// re-stamped when its label maps to a current CW.
function normalizeWebLogos(webLogos, colorWays) {
  const cws = safeArr(colorWays).filter((c) => c && c.id);
  const byLabel = new Map(cws.filter((c) => String(c.garment_color || '').trim()).map((c) => [String(c.garment_color).trim().toLowerCase(), c.id]));
  return safeArr(webLogos).filter((w) => w && w.url).map((w) => {
    const label = String(w.color_way || '').trim();
    if (!label) return w.is_default ? w : Object.assign({}, w, { is_default: true });
    if (w.color_way_id && cws.some((c) => c.id === w.color_way_id)) return w;
    const id = byLabel.get(label.toLowerCase());
    return id ? Object.assign({}, w, { color_way_id: id }) : w;
  });
}

// ── Job Building ── Groups items by their full decoration signature, split by deco type
// Different deco types (e.g. screen_print vs embroidery) always create separate jobs
const buildJobs = (o) => {
  if (o?.jobs && o.jobs.length > 0) return o.jobs;
  // Build decoration entries per item, grouped by deco type
  const itemSigs = [];
  safeItems(o).forEach((it, idx) => {
    if (it.no_deco) return;
    const decosByType = {};
    safeDecos(it).forEach((d, di) => {
      if (d.kind === 'art' && d.art_file_id) {
        const artF = safeArr(o?.art_files).find(f => f.id === d.art_file_id);
        const dt = artF?.deco_type || d.deco_type || 'screen_print';
        const part = 'art_' + d.art_file_id;
        // Split-art designs bucket by ART IDENTITY (not the line's split group) so the same logo
        // split across several lines — and a standalone copy of it — all consolidate into ONE job.
        // Non-split decos keep the per-deco-type bucket, so two distinct logos on one garment still
        // bundle into a single combined job (the established Split-Art behavior).
        const bk = d.split_group ? 'art::' + d.art_file_id : dt;
        if (!decosByType[bk]) decosByType[bk] = [];
        decosByType[bk].push({ part, d, di, _dt: dt });
      } else if (d.kind === 'numbers') {
        const dt = d.num_method || 'heat_transfer';
        const part = 'numbers_' + dt + '@' + (d.position || '');
        if (!decosByType[dt]) decosByType[dt] = [];
        decosByType[dt].push({ part, d, di, _dt: dt });
      } else if (d.kind === 'names') {
        const dt = d.name_method || 'heat_press';
        const part = 'names_' + dt + '@' + (d.position || '');
        if (!decosByType[dt]) decosByType[dt] = [];
        decosByType[dt].push({ part, d, di, _dt: dt });
      }
    });
    Object.entries(decosByType).forEach(([bk, decos]) => {
      const dt = decos[0]._dt || bk;
      // De-dupe parts so the same logo applied at two positions on one garment keys the same as a
      // single application (one art = one signature = one job).
      const parts = Array.from(new Set(decos.map(x => x.part))).sort();
      const sig = dt + '::' + parts.join('|');
      if (sig) itemSigs.push({ idx, it, sig, decos });
    });
  });
  // Group by signature
  const sigGroups = {};
  itemSigs.forEach(({ idx, it, sig, decos }) => {
    if (!sigGroups[sig]) sigGroups[sig] = { sig, items: [] };
    sigGroups[sig].items.push({ idx, it, decos });
  });
  return Object.values(sigGroups).map((grp, gi) => {
    const firstEntry = grp.items[0];
    const positions = new Set();
    const artNames = []; const artIds = []; const decoTypes = [];
    let worstArtSt = 'art_complete';
    firstEntry.decos.forEach(({ d }) => {
      if (d.kind === 'art' && d.art_file_id) {
        positions.add(d.position || '');
        artIds.push(d.art_file_id);
        const af = safeArr(o?.art_files).find(f => f.id === d.art_file_id);
        if (af) { artNames.push(af.name || 'Unnamed'); decoTypes.push(af.deco_type || 'screen_print');
          // Skipping the production-files stage (landing straight on art_complete) requires EXPLICIT
          // confirmation — the per-design prod_files_attached checkbox, or, for embroidery, a .dst that
          // IS the production file. A file merely sitting in prod_files (e.g. an order-sheet PDF dropped
          // in before the seps exist) is NOT enough, so an approved job waits in its production-files
          // stage until someone confirms. Mirrors artProdFilesConfirmed in constants.js.
          const _prodConfirmed = af.prod_files_attached === true || ((af.deco_type || '') === 'embroidery' && [...(af.files || []), ...(af.prod_files || [])].some(f => { const n = (typeof f === 'string' ? f : (f && (f.name || f.url)) || '').toLowerCase(); return n.endsWith('.dst'); }));
          const _prodNeededSt = (['dtf','heat_press'].includes(af.deco_type || '')) ? 'order_dtf_transfers' : (af.deco_type || '') === 'embroidery' ? 'upload_emb_files' : 'production_files_needed';
          const st = af.status === 'approved' ? (_prodConfirmed ? 'art_complete' : _prodNeededSt) : af.status === 'needs_approval' ? 'waiting_approval' : af.status === 'uploaded' ? 'waiting_approval' : 'needs_art';
          if (st !== 'art_complete') worstArtSt = st;
        } else { artNames.push('Unnamed'); decoTypes.push('screen_print'); worstArtSt = 'needs_art'; }
      } else if (d.kind === 'numbers') {
        positions.add(d.position || '');
        artNames.push('Numbers — ' + (d.num_method || 'heat_transfer').replace(/_/g, ' '));
        decoTypes.push(d.num_method || 'heat_transfer');
      } else if (d.kind === 'names') {
        positions.add(d.position || '');
        artNames.push('Names — ' + (d.name_method || 'heat_press').replace(/_/g, ' '));
        decoTypes.push(d.name_method || 'heat_press');
      }
    });
    const items = grp.items.map(({ idx, it, decos }) => {
      const decoIdxs = decos.map(x => x.di);
      // Split-art job: this group is one design carrying its own per-size allocation.
      const splitDeco = decos.length === 1 && decos[0].d.split_group && decos[0].d.split_sizes ? decos[0].d : null;
      const szMap = splitDeco ? splitDeco.split_sizes : safeSizes(it);
      // qty_only items (Custom — no size breakdown) keep their quantity in est_qty with an empty
      // sizes map, so summing szMap yields 0. Fall back to est_qty — mirrors allocateJobFulfillment —
      // so the freshly built job totals its real units instead of showing 0.
      let units = Object.values(szMap).reduce((a, v) => a + safeNum(v), 0);
      if (!splitDeco && units === 0 && safeNum(it.est_qty) > 0) units = safeNum(it.est_qty);
      const out = { item_idx: idx, deco_idx: decoIdxs[0] || 0, deco_idxs: decoIdxs, sku: it.sku, name: safeStr(it.name), color: it.color || '', units, fulfilled: 0 };
      // Per-ITEM split group: a consolidated art job spans several split lines, so each item carries
      // its own line's split group. allocateJobFulfillment keys received-unit apportioning on this so
      // sibling designs on a shared line never both count the same garments.
      if (splitDeco) { out.sizes = Object.assign({}, splitDeco.split_sizes); out.split_group = splitDeco.split_group; }
      return out;
    });
    const totalUnits = items.reduce((a, it) => a + it.units, 0);
    return { id: o.id.replace('SO-', 'JOB-') + '-' + (gi + 1 < 10 ? '0' : '') + (gi + 1), key: grp.sig, art_file_id: artIds[0] || null,
      _art_ids: artIds, art_name: artNames.join(' + ') || 'Unnamed', deco_type: decoTypes[0] || 'screen_print',
      art_status: worstArtSt, item_status: 'need_to_order', prod_status: 'hold',
      total_units: totalUnits, fulfilled_units: 0, split_from: null, split_group: null, items, _auto: true };
  });
};

// ── Live art files for a job ──
// The designs a job actually decorates with, taken from its items' CURRENT
// decorations rather than the job's stored _art_ids/art_file_id (which can go
// stale when an item's art is swapped, leaving an orphaned art file behind).
// Falls back to the stored ids only when the items reference no art (e.g.
// names/numbers-only jobs). Excludes art files that no longer exist or are archived.
const jobLiveArtIds = (j, o) => {
  const ids = []; const seen = new Set();
  (j?.items || []).forEach(gi => {
    const it = safeItems(o)[gi.item_idx]; if (!it) return;
    safeDecos(it).forEach(d => {
      if (d.kind === 'art' && d.art_file_id && d.art_file_id !== '__tbd' && !seen.has(d.art_file_id)) {
        seen.add(d.art_file_id); ids.push(d.art_file_id);
      }
    });
  });
  let arr = ids;
  if (arr.length === 0) arr = (j?._art_ids && j._art_ids.length) ? j._art_ids : [j?.art_file_id].filter(Boolean);
  return arr.filter(id => { const a = safeArr(o?.art_files).find(f => f.id === id); return a && !a.archived; });
};

// ── Split-family fulfillment apportioning ──
// Received/pulled units are tracked on the SO line item, so every job referencing that item
// reads the same pool. For unrelated jobs that's correct — the same physical garment fulfills
// a front-print job AND a back-embroidery job. But a split family (a parent and the slices
// split off it via split_from) PARTITIONS the item's units between its jobs, so within a
// family the pool must be apportioned, never double-counted: after a split-by-received the
// parent's open remainder would otherwise re-count the very receipts its slice was created to
// own. Slices claim first (deepest split first — matching the receipts-go-to-the-split-first
// convention used when a split is created); the root parent takes what's left. EXCEPTION: a slice
// flagged split_open is a backorder peeled OFF a producible parent ("split off backorder"), so it
// claims LAST within its family — the received units stay on the parent, and the backorder slice
// fills only as its own not-yet-received units actually arrive. Each job is
// capped at its own per-size quantities (gi.sizes when the split recorded them, else the full
// item sizes). Returns one {total, fulfilled, fulSizes[<item index>]} entry per job, aligned
// with the jobs array.
const allocateJobFulfillment = (jobs, items) => {
  const byId = {};
  jobs.forEach(j => { if (j && j.id) byId[j.id] = j; });
  const famMeta = (j) => {
    let cur = j, depth = 0; const seen = {};
    while (cur && cur.id && cur.split_from && byId[cur.split_from] && !seen[cur.id]) {
      seen[cur.id] = 1; cur = byId[cur.split_from]; depth++;
    }
    // Split-art siblings (two logos sharing one line via split_group) partition that line's
    // units, so they share one apportioning pool — otherwise each would count the same receipts.
    // Treating the split_group as the family root makes receipts fill one design, then the next.
    const root = (j && j.split_group) ? ('sg:' + j.split_group) : ((cur && cur.id) || (j && j.id) || '');
    return { root, depth, open: (j && j.split_open) ? 1 : 0 };
  };
  // open: 0 (received parent / normal slice) sorts before 1 (backorder slice) so the backorder
  // claims its family's receipts last; within each open-tier the deepest split still claims first.
  const order = jobs.map((j, i) => ({ i, m: famMeta(j) })).sort((a, b) => (a.m.open - b.m.open) || (b.m.depth - a.m.depth) || (a.i - b.i));
  const claimed = {}; // family root::item_idx::size -> units already taken by deeper slices
  const out = new Array(jobs.length);
  order.forEach(e => {
    const j = jobs[e.i];
    const res = { total: 0, fulfilled: 0, fulSizes: [] };
    out[e.i] = res;
    if (!j) return;
    (j.items || []).forEach((gi, gii) => {
      const fs = {};
      res.fulSizes[gii] = fs;
      const it = safeArr(items)[gi.item_idx]; if (!it) return;
      const sizeSrc = (gi.sizes && Object.keys(gi.sizes).length > 0) ? gi.sizes : safeSizes(it);
      let entries = Object.entries(sizeSrc).filter(([, v]) => safeNum(v) > 0);
      // qty_only items hold their quantity in est_qty (sizes is empty); POs/picks track them
      // under the 'QTY' key — mirror calcSOStatus so a custom / no-size-breakdown job still
      // totals its units and counts receipts. Without this its total stays 0, so the job never
      // reads items_received / isJobReady and sits on "Ordered — Waiting" even fully received.
      if (entries.length === 0 && safeNum(it.est_qty) > 0) entries = [['QTY', safeNum(it.est_qty)]];
      entries.forEach(([sz, v]) => {
        res.total += v;
        const pulledQty = safePicks(it).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
        const rcvdQty = safePOs(it).reduce((a, pk) => a + safeNum((pk.received || {})[sz]), 0);
        // Per-ITEM split group: consolidated art jobs span multiple split lines, so a shared line's
        // receipts must pool by that line's split group (not the job) — otherwise two art jobs that
        // both include the line would each claim its full receipts. Non-split items fall back to the
        // job's family root, so unrelated jobs sharing a garment still each count it in full.
        const ck = (gi.split_group ? 'sg:' + gi.split_group : e.m.root) + '::' + gi.item_idx + '::' + sz;
        const take = Math.min(safeNum(v), Math.max(0, pulledQty + rcvdQty - (claimed[ck] || 0)));
        claimed[ck] = (claimed[ck] || 0) + take;
        if (take > 0) fs[sz] = take;
        res.fulfilled += take;
      });
    });
  });
  return out;
};

// ── Job Readiness Check ──
const isJobReady = (j, o) => {
  if (j.art_status !== 'art_complete') return false;
  const artIds = jobLiveArtIds(j, o);
  for (const aid of artIds) {
    const af = safeArr(o?.art_files).find(f => f.id === aid);
    if (!af) continue;
    // Art team explicitly confirmed production files are attached for this design.
    if (af.prod_files_attached === true) continue;
    if ((af.prod_files || []).length > 0) continue;
    // A .dst attached to the embroidery art counts as the production file.
    if ((af.deco_type || '') === 'embroidery' && (af.files || []).some(f => { const n = (typeof f === 'string' ? f : (f && (f.name || f.url)) || '').toLowerCase(); return n.endsWith('.dst'); })) continue;
    return false;
  }
  // Garments in hand — family-apportioned so a split slice and its parent never both count the
  // same receipts (a parent left with 10 open units must not read ready off its sibling's 90).
  const jobs = safeJobs(o);
  let ji = jobs.indexOf(j);
  if (ji === -1) ji = jobs.findIndex(x => x && x.id && j.id && x.id === j.id);
  const a = allocateJobFulfillment(ji === -1 ? [j] : jobs, safeItems(o))[ji === -1 ? 0 : ji];
  return a.total > 0 && a.fulfilled >= a.total;
};

// ── Job Fulfillment Recalculation ──
// Recomputes every job's fulfilled/total units and item_status from its items' CURRENT
// pulled picks + PO receipts. Every flow that changes receiving or pull state (receive
// shipment, edit/delete a shipment receipt, pull stock, undo a pull) must run this so the
// "Items Received" badge moves in BOTH directions — including back to partially_received
// when a receipt is reduced (e.g. mis-shipped units un-received on the PO).
// Split jobs carry only their subset of sizes in gi.sizes (same convention as isJobReady),
// so honor that before falling back to the full SO item sizes — otherwise a receive after
// a custom split would clobber both halves' totals with the full item quantity. Receipts are
// apportioned within each split family (see allocateJobFulfillment) so a slice and its parent
// never both count the same units, and jobs carrying per-size splits get gi.fulfilled /
// gi.fulSizes refreshed to the apportioned amounts — stored fulSizes is what the UI's size
// chips show (and what syncJobs preserves), so it has to track receipts in both directions.
// NOTE: no spread syntax in this file — babel would inject an ESM helper import for it,
// which makes webpack treat this CommonJS module as ESM and drop module.exports entirely.
const recalcJobFulfillment = (o, items) => {
  const alloc = allocateJobFulfillment(safeJobs(o), items);
  return safeJobs(o).map((j, ji) => {
    const a = alloc[ji];
    const itemSt = a.fulfilled >= a.total && a.total > 0 ? 'items_received' : a.fulfilled > 0 ? 'partially_received' : 'need_to_order';
    let giChanged = false;
    const newItems = (j.items || []).map((gi, gii) => {
      if (!gi.sizes || Object.keys(gi.sizes).length === 0) return gi;
      const fs = a.fulSizes[gii] || {};
      const f = Object.keys(fs).reduce((x, sz) => x + fs[sz], 0);
      const old = gi.fulSizes || {};
      const oldKeys = Object.keys(old).filter(sz => safeNum(old[sz]) > 0);
      const same = safeNum(gi.fulfilled) === f && oldKeys.length === Object.keys(fs).length && oldKeys.every(sz => safeNum(old[sz]) === fs[sz]);
      if (same) return gi;
      giChanged = true;
      return Object.assign({}, gi, { fulSizes: fs, fulfilled: f });
    });
    if (!giChanged && j.item_status === itemSt && j.fulfilled_units === a.fulfilled && j.total_units === a.total) return j;
    return Object.assign({}, j, { item_status: itemSt, fulfilled_units: a.fulfilled, total_units: a.total, items: newItems });
  });
};

// ── Ready-for-decoration transition ──
// Given a job list from before and after a fulfillment recalc, returns the jobs that JUST
// crossed into items_received while their artwork is already complete — i.e. the moment the
// warehouse checks in (or pulls) the final units and the job can move straight to decoration.
// Jobs already past hold are excluded: production has them, so there's no hand-off to flag.
const jobsNowReadyForDeco = (prevJobs, nextJobs) => safeArr(nextJobs).filter(j => {
  if (j.item_status !== 'items_received' || j.art_status !== 'art_complete') return false;
  if (j.prod_status && j.prod_status !== 'hold') return false;
  const prev = safeArr(prevJobs).find(pj => pj.id === j.id);
  return !!prev && prev.item_status !== 'items_received';
});

// ── When did a job's items actually arrive? ──
// items_received_at was never persisted, so the dashboard's "All items received" notifications
// and to-dos fell back to updated_at — which tracks the LAST edit of the SO/job (inventory syncs,
// memo tweaks, status changes), making long-received jobs read "Yesterday". Derive the real moment
// instead from the receipts that fulfilled the job: the latest pulled pick (pulled_at) and the
// latest PO shipment receipt (shipment.date) across the job's items. Mirrors how the "IF pulled"
// feed already timestamps itself off pulled_at. Returns the raw timestamp string (whatever format
// it was stored in — parseable by new Date()) or null when nothing is timestamped (legacy data),
// leaving the caller to pick its own fallback. Self-healing: works for existing + new jobs, no migration.
const jobReceivedAt = (j, items) => {
  if (!j) return null;
  let latest = -Infinity, raw = null;
  const bump = (d) => { if (!d) return; const t = new Date(d).getTime(); if (!isNaN(t) && t > latest) { latest = t; raw = d; } };
  const idxs = new Set((j.items || []).map(gi => gi.item_idx));
  safeArr(items).forEach((it, ii) => {
    if (!idxs.has(ii)) return;
    safePicks(it).forEach(pk => { if (pk.status === 'pulled') bump(pk.pulled_at); });
    safePOs(it).forEach(po => {
      const rcvd = po.received || {};
      // Only count a PO's shipment dates once it has actually received units — an ordered-but-not-yet-
      // received PO carries no receipt, so its (absent) shipments shouldn't stamp a receive time.
      if (Object.keys(rcvd).some(sz => safeNum(rcvd[sz]) > 0)) {
        safeArr(po.shipments).forEach(s => bump(s && s.date));
      }
    });
  });
  return raw;
};

// ── Linking jobs that share a decoration ("run together") ──
// Two jobs are "the same screen/setup" when they carry the same artwork (matched by name +
// deco type, the same way art is de-duped across orders elsewhere). Used to auto-detect jobs
// that should run together so the screen/digitized file isn't recreated per sales order.
const jobScreenKey = (j) => {
  if (!j) return null;
  const name = (j.art_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!name || !j.deco_type) return null;
  return name + '|' + j.deco_type;
};

// Resolve the group a job runs with. Manual link_group (an explicit override) always wins —
// it lets reps tie jobs together even when art names differ across sub-customers. Otherwise
// jobs auto-group by screen key, scoped to the parent customer so unrelated parents that
// happen to reuse a name don't merge. auto_group_off opts a job out of auto-grouping (the
// override for when two different designs share a name). Returns null when the job groups
// with nothing.
const jobGroupKey = (j, parentId) => {
  if (!j) return null;
  if (j.link_group) return 'm:' + j.link_group;
  if (j.auto_group_off) return null;
  const sk = jobScreenKey(j);
  return sk ? 'a:' + (parentId || '') + '|' + sk : null;
};

// ── Totals Calculation ──
function calcTotals(o, cust) {
  const artQty = {};
  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    safeDecos(it).forEach(d => { if (d.kind === 'art' && d.art_file_id) { artQty[d.art_file_id] = (artQty[d.art_file_id] || 0) + q } });
  });
  const af = safeArt(o);
  let rev = 0, cost = 0;
  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    if (!q) return;
    rev += q * safeNum(it.unit_sell);
    cost += q * safeNum(it.nsa_cost);
    safeDecos(it).forEach(d => {
      const cq = d.kind === 'art' && d.art_file_id ? artQty[d.art_file_id] : q;
      const dp = dP(d, q, af, cq);
      const eq = dp._nq != null ? dp._nq : (d.reversible ? q * 2 : q);
      rev += eq * dp.sell;
      cost += eq * dp.cost;
    });
    // Legacy per-item outside-deco POs: the supplier-bill refactor moved these
    // onto o.deco_pos[], but historical orders still carry them on items[].po_lines —
    // their decoration cost must still be counted so margins aren't overstated.
    (it.po_lines || []).forEach(pl => {
      if (pl.po_type !== 'outside_deco') return;
      const plQty = Object.keys(safeSizes(it)).reduce((a, sz) => a + safeNum(pl[sz]), 0);
      cost += plQty * safeNum(pl.unit_cost);
    });
  });
  // Outside-deco POs live at the SO level (so.deco_pos), not per-item
  (o.deco_pos || []).forEach(dp => {
    const bc = safeNum(dp._bill_cost);
    if (bc > 0) { cost += bc; return; }
    cost += safeNum(dp.qty || 0) * safeNum(dp.unit_cost || 0);
  });
  const ship = o.shipping_type === 'pct' ? rev * (o.shipping_value || 0) / 100 : (o.shipping_value || 0);
  const tax = rev * (cust?.tax_rate || 0);
  return { rev, cost, ship, tax, grand: rev + ship + tax, margin: rev - cost, pct: rev > 0 ? ((rev - cost) / rev * 100) : 0 };
}

// ── Invoice Creation Logic ──
function createInvoice(o, invSelItems, cust, artQty) {
  const items = safeItems(o);
  const af = safeArt(o);
  const selTotals = invSelItems.reduce((acc, idx) => {
    const it = items[idx]; if (!it) return acc;
    const qty = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    const rev = qty * safeNum(it.unit_sell);
    let decoRev = 0;
    safeDecos(it).forEach(d => {
      if (d.kind === 'art' && d.art_file_id) {
        const artF = af.find(a => a.id === d.art_file_id);
        const dp = dP(d, qty, artF ? [artF] : [], qty);
        decoRev += qty * dp.sell;
      } else if (d.kind === 'numbers') {
        const dp = dP(d, qty, [], qty);
        decoRev += (dp._nq != null ? dp._nq : qty) * dp.sell;
      } else if (d.kind === 'names') {
        const dp = dP(d, qty, [], qty);
        decoRev += qty * dp.sell;
      } else if (d.kind === 'outside_deco') {
        const dp = dP(d, qty, [], qty);
        decoRev += qty * dp.sell;
      }
    });
    return { items: acc.items + 1, units: acc.units + qty, subtotal: acc.subtotal + rev + decoRev };
  }, { items: 0, units: 0, subtotal: 0 });

  const totals = calcTotals(o, cust);
  const invShip = invSelItems.length === items.length ? totals.ship : 0;
  const invTax = invSelItems.length === items.length ? totals.tax : 0;
  const invTotal = selTotals.subtotal + invShip + invTax;

  const lineItems = invSelItems.map(idx => {
    const it = items[idx]; if (!it) return null;
    const qty = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    const decoSell = safeDecos(it).reduce((a, d) => {
      const cq = d.kind === 'art' && d.art_file_id ? (artQty || {})[d.art_file_id] : qty;
      const dp2 = dP(d, qty, af, cq);
      return a + dp2.sell;
    }, 0);
    return { desc: it.sku + ' ' + it.name + (it.color ? ' — ' + it.color : ''), qty, rate: safeNum(it.unit_sell) + decoSell, amount: qty * (safeNum(it.unit_sell) + decoSell) };
  }).filter(Boolean);

  return { total: invTotal, lineItems, selTotals, ship: invShip, tax: invTax };
}

// ── QB Sync Builders ──
function buildQBSalesOrder(so, cust, qbMapping) {
  const saf = safeArt(so);
  const _aq = {};
  safeItems(so).forEach(it2 => {
    const q2 = Object.values(safeSizes(it2)).reduce((a, v) => a + safeNum(v), 0);
    safeDecos(it2).forEach(d2 => { if (d2.kind === 'art' && d2.art_file_id) { _aq[d2.art_file_id] = (_aq[d2.art_file_id] || 0) + q2 * (d2.reversible ? 2 : 1) } });
  });
  const c = cust;
  const lines = [];
  safeItems(so).forEach(it => {
    const qty = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    if (!qty) return;
    lines.push({ type: 'SalesItemLine', desc: it.sku + ' ' + it.name + (it.color ? ' - ' + it.color : ''), qty, rate: it.unit_sell, amount: qty * it.unit_sell, account: qbMapping.income_account });
    safeDecos(it).forEach(d => {
      const cq = d.kind === 'art' && d.art_file_id ? _aq[d.art_file_id] : qty;
      const dp = dP(d, qty, saf, cq);
      const sell = dp.sell;
      // Bill the effective application count: _nq for numbers/names splits, ×2 for reversible garments.
      const eq = dp._nq != null ? dp._nq : (d.reversible ? qty * 2 : qty);
      if (sell > 0) lines.push({ type: 'SalesItemLine', desc: 'Decoration: ' + (d.position || d.deco_type || d.kind || 'Art'), qty: eq, rate: sell, amount: eq * sell, account: qbMapping.income_account });
    });
  });
  return { docType: 'SalesOrder', docNumber: so.id, customerRef: c?.name || 'Unknown', date: so.created_at, memo: so.memo, lines, total: lines.reduce((a, l) => a + l.amount, 0) };
}

function buildQBInvoice(inv, sos, cust, qbMapping) {
  const so = sos.find(s => s.id === inv.so_id);
  return { docType: 'Invoice', docNumber: inv.id, customerRef: cust.find(c => c.id === inv.customer_id)?.name,
    date: inv.date, soRef: inv.so_id, amount: inv.total, paid: inv.paid, balance: inv.total - inv.paid,
    account: qbMapping.ar_account };
}

// ── Promo Dollars Pricing ──
// When promo is applied to an order:
// - Adidas/UA/NB items: sell at retail_price (no tier discount)
// - Other items: sell at retail_price if available, otherwise nsa_cost * 2.0
// - Decoration sells increase by 25%
// - Shipping on promo portion increases by 25%
// - Tax = $0 on promo portion
const PROMO_DECO_MULT = 1.25;
const PROMO_SHIP_MULT = 1.25;

function calcPromoItemSell(item) {
  if (safeNum(item.retail_price) > 0) return safeNum(item.retail_price);
  return safeNum(item.nsa_cost) * 2.0;
}

// Calculate promo-adjusted totals for an order
// Returns { promoRev, promoShip, promoAmount, normalRev, normalShip, normalTax, customerPays }
function calcPromoTotals(o, cust) {
  if (!o.promo_applied) return null;

  const artQty = {};
  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    safeDecos(it).forEach(d => {
      if (d.kind === 'art' && d.art_file_id) { artQty[d.art_file_id] = (artQty[d.art_file_id] || 0) + q }
    });
  });
  const af = safeArt(o);
  let promoRev = 0, promoCost = 0, normalRev = 0, normalCost = 0, origPromoRev = 0;

  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    if (!q) return;

    if (it.is_promo) {
      // unit_sell is already set to retail/MSRP when promo is applied
      promoRev += q * safeNum(it.unit_sell);
      promoCost += q * safeNum(it.nsa_cost);
      // Track original revenue (pre-promo sell) for shipping base
      origPromoRev += q * safeNum(it._pre_promo_sell || it.unit_sell);
      safeDecos(it).forEach(d => {
        const cq = d.kind === 'art' && d.art_file_id ? artQty[d.art_file_id] : q;
        const dp = dP(d, q, af, cq);
        const eq = dp._nq != null ? dp._nq : (d.reversible ? q * 2 : q);
        promoRev += eq * rQ(dp.sell * PROMO_DECO_MULT);
        promoCost += eq * dp.cost;
        origPromoRev += eq * dp.sell;
      });
    } else {
      normalRev += q * safeNum(it.unit_sell);
      normalCost += q * safeNum(it.nsa_cost);
      safeDecos(it).forEach(d => {
        const cq = d.kind === 'art' && d.art_file_id ? artQty[d.art_file_id] : q;
        const dp = dP(d, q, af, cq);
        const eq = dp._nq != null ? dp._nq : (d.reversible ? q * 2 : q);
        normalRev += eq * dp.sell;
        normalCost += eq * dp.cost;
      });
    }
  });

  // Shipping: use original (pre-promo) revenue for base to avoid inflation, then apply 25% to promo portion
  const origTotalRev = origPromoRev + normalRev;
  const baseShip = o.shipping_type === 'pct' ? origTotalRev * (o.shipping_value || 0) / 100 : (o.shipping_value || 0);
  const promoPct = origTotalRev > 0 ? origPromoRev / origTotalRev : (promoRev > 0 ? 1 : 0);
  const promoShip = rQ(baseShip * promoPct * PROMO_SHIP_MULT);
  const normalShip = rQ(baseShip * (1 - promoPct));

  // Tax: $0 on promo portion, normal tax on non-promo
  const taxRate = cust?.tax_exempt ? 0 : (cust?.tax_rate || 0);
  const normalTax = normalRev * taxRate;

  // Promo amount consumed = promo item/deco revenue + promo shipping
  const promoAmount = promoRev + promoShip;

  // Customer pays only the non-promo portion
  const customerPays = normalRev + normalShip + normalTax;

  return {
    promoRev, promoCost, promoShip, promoAmount,
    normalRev, normalCost, normalShip, normalTax,
    customerPays, totalCost: promoCost + normalCost
  };
}

// Calculate promo allocation from spend over a date range
// Returns the dollar amount to allocate as promo
function calcPromoSpendAllocation(orders, customerIds, periodStart, periodEnd, percentage) {
  const ids = Array.isArray(customerIds) ? customerIds : [customerIds];
  const filtered = orders.filter(o => {
    if (!ids.includes(o.customer_id)) return false;
    const d = o.created_at || '';
    return d >= periodStart && d <= periodEnd;
  });
  let totalRev = 0;
  filtered.forEach(o => {
    safeItems(o).forEach(it => {
      const q = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
      totalRev += q * safeNum(it.unit_sell);
    });
  });
  return Math.round(totalRev * safeNum(percentage) * 100) / 100;
}

// Net sales (product + deco) that qualifies a line for promo earning. A line's net revenue
// only counts when its margin (sell-cost)/sell meets minMargin (default 20%). Mirrors the
// app helper in pricing.js so co-op earning ignores thin-margin lines.
function calcQualifyingSpend(o, minMargin = 0.2) {
  if (!o) return 0;
  const items = safeItems(o); const af = safeArt(o);
  const artQty = {};
  items.forEach(it => {
    const sq = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    const q = sq > 0 ? sq : safeNum(it.est_qty);
    if (!q) return;
    safeDecos(it).forEach(d => { if (d.kind === 'art' && d.art_file_id) { artQty[d.art_file_id] = (artQty[d.art_file_id] || 0) + q * (d.reversible ? 2 : 1) } });
  });
  let total = 0;
  items.forEach(it => {
    if (it.is_free_promo) return;
    const sq = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
    const q = sq > 0 ? sq : safeNum(it.est_qty);
    if (!q) return;
    let rev = 0, cost = 0;
    if (it._sizeSells && sq > 0) {
      Object.entries(safeSizes(it)).forEach(([sz, v]) => { const n = safeNum(v); if (n > 0) { rev += n * (it._sizeSells?.[sz] || safeNum(it.unit_sell)); cost += n * (it._sizeCosts?.[sz] || safeNum(it.nsa_cost)) } });
    } else {
      rev += q * safeNum(it.unit_sell); cost += q * safeNum(it.nsa_cost);
    }
    safeDecos(it).forEach(d => {
      const cq = d.kind === 'art' && d.art_file_id ? artQty[d.art_file_id] : q;
      const dp = dP(d, q, af, cq);
      const eq = dp._nq != null ? dp._nq : (d.reversible ? q * 2 : q);
      rev += eq * safeNum(dp.sell); cost += eq * safeNum(dp.cost);
    });
    const margin = rev > 0 ? (rev - cost) / rev : 0;
    if (margin >= minMargin) total += rev;
  });
  return total;
}

// Get the current promo period boundaries
// Returns { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', label: 'H1 2026' }
function getCurrentPromoPeriod(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth(); // 0-11
  if (m < 6) {
    return { start: y + '-01-01', end: y + '-06-30', label: 'H1 ' + y };
  } else {
    return { start: y + '-07-01', end: y + '-12-31', label: 'H2 ' + y };
  }
}

// Get previous promo period
function getPreviousPromoPeriod(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  if (m < 6) {
    return { start: (y - 1) + '-07-01', end: (y - 1) + '-12-31', label: 'H2 ' + (y - 1) };
  } else {
    return { start: y + '-01-01', end: y + '-06-30', label: 'H1 ' + y };
  }
}

// ── Inventory Helpers ──
function checkInventoryConflicts(currentSO, item, newInv, allOrders) {
  const warnings = [];
  allOrders.forEach(so => {
    if (so.id === currentSO.id) return;
    safeItems(so).forEach(it => {
      if (it.sku !== item.sku && it.product_id !== item.product_id) return;
      safePicks(it).forEach(pk => {
        if (pk.status === 'pulled') return;
        const overSizes = [];
        Object.entries(pk).forEach(([sz, qty]) => {
          if (sz === 'status' || sz === 'pick_id' || typeof qty !== 'number' || qty <= 0) return;
          if (qty > (newInv[sz] || 0)) overSizes.push(sz + ': needs ' + qty + ', only ' + (newInv[sz] || 0));
        });
        if (overSizes.length > 0) warnings.push({ so: so.id, pick: pk.pick_id || 'IF', sizes: overSizes });
      });
    });
  });
  return warnings;
}

// ─── Item-edit reconciliation (data-loss guard helper) ───
// Decide whether a client's item add/remove is a VERIFIED deliberate edit when the session's bulk item load
// timed out — in that state the global per-table hydration flag (_itemsHydrated) is false for EVERY order, so it
// can't be trusted per-order and would otherwise gate legitimate deletions ("Save blocked — reload the page").
// Key insight: a timed-out/partial load leaves the client with an EMPTY item list (handled separately by the
// zero-wipe guard), never a coherent subset of THIS order's real items. So the edit is provably deliberate when
// the client items reconcile with the freshly-read DB rows by SKU/name: client ⊆ DB (a deletion) or DB ⊆ client
// (an addition). The dangerous "phantom-empty load, then user adds new rows on top" case is NOT a superset of the
// DB rows, so it returns false and stays blocked. Returns false for an empty / identity-less client list (it can
// never be "proven loaded"). NOTE: the save guards only call this once the DB already has rows (oldItemIds > 0).
function itemEditReconciles(clientItems, dbItems) {
  if (!Array.isArray(clientItems) || clientItems.length === 0) return false;
  const keyOf = (x) => String((x && (x.sku || x.name)) || '').trim();
  const toMs = (arr) => {
    const m = new Map();
    (arr || []).forEach((x) => { const k = keyOf(x); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const subset = (a, b) => { for (const [k, n] of a) { if ((b.get(k) || 0) < n) return false; } return true; };
  const c = toMs(clientItems), d = toMs(dbItems);
  if (c.size > 0 && (subset(c, d) || subset(d, c))) return true;
  // Custom lines have no stable identity — no product_id, and their sku/name is exactly what reps edit —
  // so a renamed custom line plus any count change defeats the multiset match above and blocked the whole
  // save (EST-1351 / EST-1353 "won't save"). Fall back to reconciling only the catalog rows (those with a
  // product_id): if they prove the client held the real estimate, the custom-line churn is a deliberate
  // edit. BOTH sides must contribute at least one catalog row — with an empty dCat the subset(dCat, cCat)
  // direction is vacuously true, which would let a phantom-empty client that added one catalog row pass
  // verification and delete real DB rows (callers whose DB read omits product_id would hit this on every
  // save). Requiring dCat.size > 0 keeps the phantom-load protection intact.
  const hasPid = (x) => !!(x && x.product_id);
  const cCat = toMs(clientItems.filter(hasPid)), dCat = toMs((dbItems || []).filter(hasPid));
  return cCat.size > 0 && dCat.size > 0 && (subset(cCat, dCat) || subset(dCat, cCat));
}

// ─── Per-item quantity-wipe detection (data-loss guard helper) ───
// The item-count / decoration / art-file guards all reason about how many CHILD ROWS exist; none of them
// looks INSIDE a surviving line at its quantities. The estimate save RPC (save_estimate) upserts each
// item's `sizes` verbatim, so a line that is still present but whose `sizes` silently emptied — from a
// stale in-memory snapshot, a size-mode switch, or an edit side effect — overwrites real units with `{}`
// with nothing to stop it. And because that row is UPSERTed (never DELETEd), no estimate_items_audit
// snapshot is written either, so the loss is invisible after the fact. (This is the EST-1316 failure: a
// 53-unit jersey saved down to `sizes:{}`, reading $0 everywhere.)
//
// Returns the DB items whose quantities this save would wipe: a line still occupying its slot (matched by
// item_index, then confirmed to be the SAME line by sku or product_id) whose size total drops from > 0 to
// 0. Deliberate, non-lossy edits are intentionally NOT flagged: a partial reduction (53 → 20), a replaced
// slot (different sku/product), an item whose count moved to est_qty, and qty-only / service lines. To
// remove a line a rep deletes it (caught by the count guards) rather than zeroing every size, so a full
// in-place wipe is treated as unintended. `clientItems` is indexed by item_index (its array position, the
// value the save writes); each `dbItems` row carries its own `item_index`.
function itemsWithWipedQty(clientItems, dbItems) {
  const out = [];
  if (!Array.isArray(clientItems) || !Array.isArray(dbItems)) return out;
  const total = (sizes) => {
    if (!sizes || typeof sizes !== 'object') return 0;
    let t = 0;
    for (const k in sizes) { const n = safeNum(sizes[k]); if (n > 0) t += n; }
    return t;
  };
  dbItems.forEach((db) => {
    const idx = db && db.item_index;
    if (typeof idx !== 'number') return;
    const oldQty = total(db.sizes);
    if (oldQty <= 0) return;                          // DB line had no quantities — nothing to lose
    const ci = clientItems[idx];
    if (!ci) return;                                  // slot removed / reindexed — the count guards cover it
    const ciSku = String(ci.sku || '').trim();
    const dbSku = String(db.sku || '').trim();
    const sameLine = (ciSku && ciSku === dbSku) || (ci.product_id && ci.product_id === db.product_id);
    if (!sameLine) return;                            // a different line now occupies the slot — deliberate replacement
    if (ci.qty_only || safeNum(ci.est_qty) > 0) return; // quantity lives in est_qty, not in sizes
    if (total(ci.sizes) === 0) out.push({ item_index: idx, sku: db.sku, name: db.name, prevQty: oldQty });
  });
  return out;
}

module.exports = {
  // Safe accessors
  safe, safeArr, safeObj, safeNum, safeStr, safeSizes, safePicks, safePOs, safeDecos, safeItems, safeArt, safeJobs,
  // Pricing
  rQ, rT, spP, emP, npP, dP, DTF, SP, EM, NP,
  // Business logic
  poCommitted, calcSOStatus, buildJobs, outsourcedDecoTypes, decoIsOutsourced, decoConcreteType, isDecoOutsourced, pickCwAsset, normalizeWebLogos, garmentNeedsUnderbase, isJobReady, allocateJobFulfillment, recalcJobFulfillment, jobsNowReadyForDeco, jobReceivedAt, jobLiveArtIds, jobScreenKey, jobGroupKey, calcTotals, createInvoice,
  // Booking orders
  isBookingOrder, bookingDaysUntilShip, isBookingActive,
  // Promo dollars
  PROMO_DECO_MULT, PROMO_SHIP_MULT, calcPromoItemSell, calcPromoTotals, calcPromoSpendAllocation, calcQualifyingSpend, getCurrentPromoPeriod, getPreviousPromoPeriod,
  // QB sync
  buildQBSalesOrder, buildQBInvoice,
  // Inventory
  checkInventoryConflicts,
  // Data-loss guards
  itemEditReconciles, itemsWithWipedQty,
};
