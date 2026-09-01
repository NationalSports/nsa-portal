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
// Same "does this art file actually have anything to review" check the approval-card UI uses
// (App.js totalMocks) — an art file can carry a stale 'needs_approval'/'uploaded' status with 0
// files/0 mockups (e.g. after a recall that didn't reset status), which must NOT read as waiting_approval
// or it regenerates a phantom "Mockup ready for review" action item forever (SO-1038).
const _hasMockupContent = (af) => Math.max((af.mockup_files || af.files || []).length, Object.values(af.item_mockups || {}).reduce((a, arr) => a + (arr || []).length, 0)) > 0;

// ── Pricing ──
const rQ = v => Math.round(v * 4) / 4;
const rT = v => Math.round(v * 10) / 10;
const SP = { bk: [{ min: 1, max: 11 }, { min: 12, max: 23 }, { min: 24, max: 35 }, { min: 36, max: 47 }, { min: 48, max: 71 }, { min: 72, max: 107 }, { min: 108, max: 143 }, { min: 144, max: 215 }, { min: 216, max: 499 }, { min: 500, max: 99999 }], pr: { 0: [50, 60, 80, 100, null], 1: [3.33, 4.33, 5.33, 6, null], 2: [2.33, 3, 4, 4.67, 5.33], 3: [2.13, 2.83, 3.17, 4, 5], 4: [1.97, 2.57, 2.83, 3.33, 4], 5: [1.83, 2.33, 2.63, 3, 3.5], 6: [1.67, 2.13, 2.47, 2.67, 3.17], 7: [1.5, 2, 2.33, 2.5, 2.83], 8: [1.4, 1.9, 2.07, 2.2, 2.67], 9: [1.27, 1.83, 1.93, 2.07, 2.5] }, mk: 1.5, ub: 0.15 };
// Mirrors EM in pricing.js / App.js (schema _v:4 defaults). This copy had drifted — it still
// carried the pre-_v:4 cost table, so tests validated embroidery prices production doesn't use.
// Guarded against re-drift by src/__tests__/pricingDrift.test.js.
const EM = { sb: [10000, 15000, 20000, 999999], qb: [6, 24, 48, 99999], pr: [[4.8, 5.1, 4.8, 4.5], [5.4, 5.1, 4.8, 4.8], [6, 5.7, 5.4, 5.4], [7.2, 7.5, 7.2, 6]], mk: 1.6, fl: 8 };
const NP = { bk: [10, 50, 99999], co: [4, 3, 3], se: [7, 6, 5], tc: 3 };
const DTF = [{ label: '4" Sq & Under', cost: 2.5, sell: 4.5 }, { label: 'Front Chest (12"x4")', cost: 4.5, sell: 7.5 }];
// Tackle twill (mirror of src/lib/decoPricing.js). TWA = chest/logo menu, TWN = jersey numbers
// by height × color. Flat per-application; sell defaults to 2× cost. Guarded by pricingDrift test.
const TWA = [{ label: 'Left Chest 1 Color', cost: 6, sell: 12 }, { label: 'Full Chest 1 Color', cost: 11, sell: 22 }, { label: 'Full Chest 1 Color — Open Jerseys', cost: 12.5, sell: 25 }, { label: 'Full Chest 2 Color', cost: 13.5, sell: 27 }, { label: 'Full Chest 2 Color — Open Jerseys', cost: 16.5, sell: 33 }];
const TWN = [{ size: '1-4"', cost1: 1.5, sell1: 3, cost2: 2.5, sell2: 5 }, { size: '6"', cost1: 1.75, sell1: 3.5, cost2: 2.75, sell2: 5.5 }, { size: '8-10"', cost1: 3, sell1: 6, cost2: 4, sell2: 8 }];

// Bracket 0 (under 12) stores sell price (flat total); other brackets store cost.
function spP(q, c, s = true) { const bi = SP.bk.findIndex(b => q >= b.min && q <= b.max); if (bi < 0 || c < 1 || c > 5) return 0; const v = SP.pr[bi]?.[c - 1]; if (v == null) return 0; if (bi === 0) return s ? v : rQ(v / SP.mk); return s ? rT(v * SP.mk) : v }
// Under-12 screen print is an ALL-IN flat charge for the run, not per piece (mirrors src/pricing.js
// spFlatShare — keep in sync). Unrounded per-piece shares so qty x value rebuilds the exact flat total.
function spFlatShare(q, c, u = 1) { const b0 = SP.bk[0]; if (!(q >= b0.min && q <= b0.max)) return null; const v = SP.pr[0]?.[c - 1]; if (v == null || !(q > 0)) return null; const fs = v * u; return { sell: fs / q, cost: rQ(fs / SP.mk) / q } }
// Split-job screen print: each production run priced at its own tier, summed, returned as
// unrounded per-piece shares (mirrors src/lib/decoPricing.js spRunBlend/decoSplitRuns — keep in sync).
function spRunBlend(runs, c, u = 1) { let Q = 0, sT = 0, cT = 0; for (const r0 of runs || []) { const r = safeNum(r0); if (!(r > 0)) continue; Q += r; const f = spFlatShare(r, c, u); if (f) { sT += f.sell * r; cT += f.cost * r; continue } const cc = rQ(spP(r, c, false) * u); sT += rT(cc * SP.mk) * r; cT += cc * r } if (!(Q > 0) || (runs || []).filter(r => safeNum(r) > 0).length < 2) return null; return { sell: sT / Q, cost: cT / Q } }
function decoSplitRuns(d, pq) { if (!d || !Array.isArray(d.split_runs)) return null; const runs = d.split_runs.map(safeNum).filter(r => r > 0); if (runs.length < 2) return null; const tot = runs.reduce((a, b) => a + b, 0); const rm = d.reversible ? 2 : 1; if (tot * rm === pq) return runs.map(r => r * rm); if (tot === pq) return runs; return null }
// EM.pr stores cost; sell = rT(cost × EM.mk).
// Non-positive stitch counts / quantities are invalid input, not the smallest tier —
// return 0 like spP does. Synced with pricing.js/decoPricing.js and App.js copies.
function emP(st, q, s = true) { if (!(st > 0) || !(q > 0)) return 0; const si = EM.sb.findIndex(b => st <= b); const qi = EM.qb.findIndex(b => q <= b); if (si < 0 || qi < 0) return 0; const v = EM.pr[si][qi]; return s ? Math.max(rT(v * EM.mk), EM.fl || 0) : v }
function npP(q, tw = false, s = true) { if (!(q > 0)) return 0; const bi = NP.bk.findIndex(b => q <= b); if (bi < 0) return 0; return s ? (NP.se[bi] + (tw ? rQ(NP.tc * 1.65) : 0)) : (NP.co[bi] + (tw ? NP.tc : 0)) }
// Tackle twill (mirror of src/lib/decoPricing.js). twaP: chest/logo by TWA index. twnP: number by TWN size × color.
function twaP(idx, s = true) { const t = TWA[idx || 0] || TWA[0]; if (!t) return 0; return s ? safeNum(t.sell) : safeNum(t.cost) }
function twnP(size, tw = false, s = true) { const r = TWN.find(x => x.size === size) || TWN[0]; if (!r) return 0; return s ? safeNum(tw ? r.sell2 : r.sell1) : safeNum(tw ? r.cost2 : r.cost1) }

function dP(d, q, artFiles, cq) {
  // A sell_override that can't coerce to a finite number (e.g. 'abc' from a bad paste)
  // must not NaN the SO totals — treat it as absent so the computed price applies.
  // Numeric strings ('12.5') still pass through. Synced with App.js dP / decoPricing.js _dPInner.
  // (Object.assign, not spread — see the no-spread NOTE above recalcJobFulfillment.)
  if (d && d.sell_override != null && !Number.isFinite(Number(d.sell_override))) d = Object.assign({}, d, { sell_override: null });
  const pq = cq || q;
  if (d.kind === 'art' && d.art_file_id && artFiles) {
    if (d.art_file_id === '__tbd') { const tType = d.art_tbd_type || 'screen_print';
      if (tType === 'screen_print') { const nc = d.tbd_colors || 1; const u = d.underbase ? 1 + SP.ub : 1; const _sr = decoSplitRuns(d, pq); if (_sr) { const b = spRunBlend(_sr, nc, u); if (b) return { sell: d.sell_override != null ? d.sell_override : b.sell, cost: b.cost } } const f = spFlatShare(pq, nc, u); if (f) return { sell: d.sell_override != null ? d.sell_override : f.sell, cost: f.cost }; const c = rQ(spP(pq, nc, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
      if (tType === 'embroidery') { const c = emP(d.tbd_stitches || 8000, pq, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
      if (tType === 'heat_press' || tType === 'dtf') { const t = DTF[d.tbd_dtf_size || 0]; return { sell: d.sell_override != null ? d.sell_override : t.sell, cost: t.cost } };
      return { sell: d.sell_override || 0, cost: 0 } }
    const art = artFiles.find(a => a.id === d.art_file_id); if (art) {
      if (art.deco_type === 'screen_print') { const nc = art.ink_colors ? art.ink_colors.split('\n').filter(l => l.trim()).length : 1; const u = d.underbase ? 1 + SP.ub : 1; const _sr = decoSplitRuns(d, pq); if (_sr) { const b = spRunBlend(_sr, nc, u); if (b) return { sell: d.sell_override != null ? d.sell_override : b.sell, cost: b.cost } } const f = spFlatShare(pq, nc, u); if (f) return { sell: d.sell_override != null ? d.sell_override : f.sell, cost: f.cost }; const c = rQ(spP(pq, nc, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
      if (art.deco_type === 'embroidery') { const c = emP(art.stitches || 8000, pq, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
      // Transfer-code decos carry real cost on cost_each — keep in sync with decoPricing.js.
      if (art.deco_type === 'dtf' || art.deco_type === 'heat_press') { const t = DTF[art.dtf_size || 0]; return { sell: d.sell_override != null ? d.sell_override : t.sell, cost: (d.transfer_code && d.cost_each != null) ? safeNum(d.cost_each) : t.cost } } } }
  // Team Shop conversion decos (00199): cost_each is the rate-card cost-of-record; sell
  // stays 0 (already folded into unit_sell). Keep in sync with src/lib/decoPricing.js.
  if (d.kind === 'art' && !d.art_file_id && d.cost_each != null) return { sell: safeNum(d.sell_override) || safeNum(d.sell_each), cost: safeNum(d.cost_each) };
  if (d.type === 'screen_print') { const u = d.underbase ? 1 + SP.ub : 1; const f = spFlatShare(q, d.colors || 1, u); if (f) return { sell: d.sell_override != null ? d.sell_override : f.sell, cost: f.cost }; const c = rQ(spP(q, d.colors || 1, false) * u); return { sell: d.sell_override != null ? d.sell_override : rT(c * SP.mk), cost: c } }
  if (d.type === 'embroidery') { const c = emP(d.stitches || 8000, q, false); return { sell: d.sell_override != null ? d.sell_override : Math.max(rT(c * EM.mk), EM.fl || 0), cost: c } }
  if (d.kind === 'numbers' || d.type === 'number_press') {
    // Mirror src/pricing.js dP() exactly so the editor and QB billing agree.
    if (d.num_method === 'sublimated') { const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; const useQty = nq || Math.max(0, safeNum(d.num_qty)) || 0; const mult = (d.front_and_back ? 2 : 1) * (d.reversible ? 2 : 1); return { sell: safeNum(d.sell_override) || 0, cost: 0, _nq: useQty * mult } }
    // Tackle twill numbers: flat price from TWN (num_size × two_color), not the qty-tiered npP.
    if (d.num_method === 'tackle_twill') { const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; const useQty = nq > 0 ? nq : Math.max(0, safeNum(d.num_qty) || q); const mult = (d.front_and_back ? 2 : 1) * (d.reversible ? 2 : 1); const fnq = useQty * mult; return { sell: d.sell_override != null ? d.sell_override : twnP(d.num_size, d.two_color, true), cost: twnP(d.num_size, d.two_color, false), _nq: fnq } }
    const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; const hasAssigned = nq > 0; const useQty = hasAssigned ? nq : Math.max(0, safeNum(d.num_qty) || q); const mult = (d.front_and_back ? 2 : 1) * (d.reversible ? 2 : 1); const fnq = useQty * mult;
    // Price the per-number volume break at the doubled application count (fnq), not the garment qty.
    return { sell: d.sell_override != null ? d.sell_override : npP(fnq || 1, d.two_color, true), cost: npP(fnq || 1, d.two_color, false), _nq: fnq } };
  // sell_override honors an explicit 0 (nullish, matches decoPricing.js — keep in sync).
  // Names bill per NAME, not per garment: return the true per-name rate and hand the
  // application count out as _nq, exactly like the numbers branch above. The old form
  // baked the count into the rate (rQ(nc*se/q)), so one $5 name on a 24-pc line printed
  // as "24 x $0.25" and the quarter-rounding then billed $6 of sell and $6 of cost for
  // $5 of work at $3 of cost (EST-2126). Deco walks already read _nq, so the line TOTAL
  // is unchanged everywhere nc*se/q happened to land on an exact quarter.
  if (d.kind === 'names') { const nc = d.names ? Object.values(d.names).flat().filter(v => v && v.trim()).length : 0; const se = safeNum(d.sell_override != null ? d.sell_override : (d.sell_each || 6)); const co = safeNum(d.cost_each || 3); return { sell: se, cost: co, _nq: (nc || q) * (d.reversible ? 2 : 1) } };
  if (d.type === 'dtf') { const t = DTF[d.dtf_size || 0]; return { sell: d.sell_override != null ? d.sell_override : t.sell, cost: t.cost } }
  // Tackle-twill chest/logo: flat per-garment price from the TWA menu (index on d.dtf_size).
  if (d.kind === 'twill') return { sell: d.sell_override != null ? d.sell_override : twaP(d.dtf_size, true), cost: twaP(d.dtf_size, false) };
  if (d.kind === 'outside_deco') return { sell: d.sell_override != null ? d.sell_override : safeNum(d.sell_each), cost: safeNum(d.cost_each) };
  return { sell: 0, cost: 0 }
}

// ── PO Committed ──
// Per-line floor at 0: cancelling more than was ordered (data-entry slip) must not
// produce a negative committed count — negative quantities are invalid, not credits.
const poCommitted = (poLines, sz) => (poLines || []).reduce((a, pk) => { const ordered = pk[sz] || 0; const cancelled = (pk.cancelled || {})[sz] || 0; return a + Math.max(0, ordered - cancelled) }, 0);

// Quantities that can safely move to a replacement SKU without touching anything already
// pulled on an IF or committed to an active PO. Cancelled PO units are open again. The maps
// make the confirmation UI explicit about what moves and what stays on the original line.
function unfulfilledSizes(item) {
  const orderedMap = safeSizes(item);
  const keys = new Set(Object.keys(orderedMap));
  if (!keys.size && item && item.qty_only) keys.add('QTY');
  const ordered = {}, picked = {}, po = {}, open = {};
  keys.forEach(sz => {
    const oq = sz === 'QTY' && !Object.keys(orderedMap).length ? safeNum(item.est_qty) : safeNum(orderedMap[sz]);
    if (!(oq > 0)) return;
    const pq = safePicks(item).reduce((a, pk) => a + Math.max(0, safeNum(pk[sz])), 0);
    const poq = poCommitted(safePOs(item).filter(pl => pl && pl.status !== 'cancelled'), sz);
    const available = Math.max(0, oq - pq - poq);
    ordered[sz] = oq;
    if (pq > 0) picked[sz] = pq;
    if (poq > 0) po[sz] = poq;
    if (available > 0) open[sz] = available;
  });
  return { ordered, picked, po, open };
}

// ── PO over-commit check ──
// Sizes about to go on a NEW PO for `item` that exceed what the line still has OPEN
// (line qty − picked − already PO-committed, same math as the PO form's open counts).
// The PO form's qty boxes default to the open count but accept any typed number, so a
// typo — or a rep re-ordering a line whose PO they didn't spot — puts the same units
// on two POs. Both get received, and the extras sit on the SO as a cost write-off
// (SO-1295: JW6602's 9 extra hoods on PO 3371 a day after PO 3345 covered the line).
// Returns one row per over-committed size: { sz, qty, open, committed, pos } where
// `pos` names the PO lines already holding units of that size, so the caller can show
// exactly which PO the units are on before asking the rep to confirm. Empty array = OK.
// qty_only lines (no size grid) track their count under 'QTY', mirroring poCommitted's
// callers (openSizesFor / allocateJobFulfillment).
const poOverCommit = (item, sizes) => {
  const out = [];
  if (!item) return out;
  const szMap = safeSizes(item);
  const hasSizes = Object.values(szMap).some(v => safeNum(v) > 0);
  Object.keys(sizes || {}).forEach(sz => {
    const qty = safeNum((sizes || {})[sz]);
    if (!(qty > 0)) return;
    const lineQty = hasSizes ? safeNum(szMap[sz]) : (sz === 'QTY' ? safeNum(item.est_qty) : 0);
    const picked = safePicks(item).reduce((a, pk) => a + safeNum(pk[sz]), 0);
    const committed = poCommitted(safePOs(item), sz);
    const open = Math.max(0, lineQty - picked - committed);
    if (qty > open) {
      const pos = [];
      safePOs(item).forEach(pl => {
        if (!pl || !(safeNum(pl[sz]) > 0)) return;
        const pid = pl.po_id || 'PO';
        if (pos.indexOf(pid) === -1) pos.push(pid);
      });
      out.push({ sz, qty, open, committed, pos });
    }
  });
  return out;
};

// ── Accepted-overage ordered-qty ceiling ──
// When a human accepts a flagged over-billing, the bill wizard raises the po_line's ORDERED
// qty to the billed total so the extra units are accounted for. That is right only when the
// extra units are real. A bill claiming units that never arrived AND the order never asked
// for is a mis-mapped or duplicate vendor document — raising ordered to match it mints open
// units that can never be received, so the line reads partial forever while the job board,
// which counts goods actually in hand, correctly reads fully received. (SO-1348: two adidas
// invoices each billed JX4452 L 10 onto one 10-unit line → ordered 20, "10/20 Rcvd" stuck
// against a true 12/12 job. Uncapped, this left ~3.2k phantom units across 69 orders.)
//
// Ceiling = the largest quantity the goods themselves justify:
//   received — units physically checked in above the ordered qty ARE a genuine overage
//   need     — the SO line's own quantity for that size (the order legitimately grew)
//   ordered  — never ratchet a line DOWN; this only ever caps a raise
// Returns the qty `ordered` should become: unchanged when the bill isn't over-claiming, the
// billed total for a justified overage, else the ceiling.
const billOverageQty = (ordered, billed, received, need) => {
  const ord = safeNum(ordered);
  if (safeNum(billed) <= ord) return ord;
  return Math.min(safeNum(billed), Math.max(ord, safeNum(received), safeNum(need)));
};
// The `need` fed to billOverageQty for ONE po_line: the SO item's qty for that size minus what
// the item's OTHER lines already commit (ordered − cancelled). With the item's full size qty as
// the ceiling, an item split across several PO lines let a duplicate bill raise each line as far
// as the WHOLE need — one line's justification reused per line. Other lines are read at their
// pre-apply values, so within a single multi-line apply the ceiling can lag one raise behind;
// it converges on the next apply and never exceeds the item's total need overall.
const billLineNeed = (it, line, sz) => {
  const others = safePOs(it).filter(p => p && p !== line);
  return Math.max(0, safeNum(safeSizes(it)[sz]) - poCommitted(others, sz));
};

// ── Reducing a size the POs / picks already cover ──
// A rep who ordered the wrong size has to be able to take it back off the order even after the
// goods landed and the vendor billed us — otherwise the order can never be made right (SO-1845:
// 3 XL ordered by mistake, received and billed, and the size grid refused every reduction).
// Those units stay bought: the po_line keeps its ordered / received / billed history untouched,
// so the SO keeps carrying their cost (garmentCost walks po_lines, not sizes) until a vendor
// credit or a return brings the money back. That is the whole point of the write-off — the
// order eats the cost knowingly instead of silently losing it.
//
// PICKED units are never absorbable: they are physically pulled from stock into this order, and
// the way to undo that is to return the pick to inventory, not to zero the size.
//
// Both order editors carry hand-synced copies of the size grid, so the arithmetic lives here —
// one place to test, one place to fix.
//
// NOTE for anything added below: use Object.assign, never object spread ({...x}), in this file.
// This module exports through `module.exports`, and the object-spread transform turns it into an
// ES module in the production build — at which point webpack sees NO named exports and every
// `import { … } from './businessLogic'` in the app fails to compile. Jest never sees it.
const _pulledForSize = (it, sz) => safePicks(it).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
// Per-line adjustability for one size: open (not received/billed) units on normal blanks lines.
// Batch-queued and outside-deco lines stay locked — they're managed elsewhere.
const _poLineSizeInfo = (pl, sz) => {
  const ord = safeNum(pl[sz]) - safeNum((pl.cancelled || {})[sz]);
  const locked = Math.max(safeNum((pl.received || {})[sz]), safeNum((pl.billed || {})[sz]));
  const frozen = pl.status === 'queued' || pl.po_type === 'outside_deco';
  return { ord, locked, adj: frozen ? 0 : Math.max(0, ord - locked), frozen };
};
const _poLineSizeKeys = (pl) => Object.keys(pl).filter(k => !k.startsWith('_') && !_PO_LINE_META.has(k) && typeof pl[k] === 'number');
const _recalcPoLineStatus = (pl) => {
  const szK = _poLineSizeKeys(pl);
  const totR = szK.reduce((a, s2) => a + safeNum((pl.received || {})[s2]), 0);
  const totOp = szK.reduce((a, s2) => a + Math.max(0, safeNum(pl[s2]) - safeNum((pl.received || {})[s2]) - safeNum((pl.cancelled || {})[s2])), 0);
  if (totR > 0) pl.status = totOp <= 0 ? 'received' : 'partial';
  return pl;
};
// Plan for setting item.sizes[sz] = n. Never mutates the item.
//   'plain'   nothing committed stands in the way — just write the number
//   'blocked' n is below the picked floor — return the pick to stock first
//   'cut'     open, unreceived PO units have to come down too — confirm, then apply po_lines
//   'absorb'  n is below what a PO already received/billed/queued — confirm the write-off,
//             then apply po_lines (open units trimmed, received units left in place)
function planSizeCut(item, sz, n, opts) {
  const picked = _pulledForSize(item, sz);
  const lines = safePOs(item);
  const poQty = poCommitted(lines, sz);
  const committed = picked + poQty;
  const plan = { kind: 'plain', sz, n, picked, poQty, committed, floor: 0, lockedPo: 0, cut: 0, absorb: 0, poIds: [], absorbPoIds: [], po_lines: null };
  if (!(committed > 0 && n < committed)) return plan;
  const infos = lines.map(pl => _poLineSizeInfo(pl, sz));
  const adjustable = infos.reduce((a, x) => a + x.adj, 0);
  const floor = committed - adjustable;
  plan.floor = floor;
  plan.lockedPo = Math.max(0, floor - picked);
  if (n < picked) return Object.assign({}, plan, { kind: 'blocked' });
  plan.cut = Math.min(adjustable, committed - n);
  plan.absorb = Math.max(0, floor - n);
  plan.kind = plan.absorb > 0 ? 'absorb' : 'cut';
  plan.poIds = [...new Set(lines.filter((pl, pi) => infos[pi].adj > 0).map(pl => pl.po_id || 'PO'))];
  plan.absorbPoIds = [...new Set(lines.filter((pl, pi) => infos[pi].locked > 0).map(pl => pl.po_id || 'PO'))];
  // Trim the open units, newest line first — a rebalance should come off the order that is
  // still open, not the one already in the warehouse.
  let newPls = lines.map(pl => Object.assign({}, pl));
  let remaining = plan.cut;
  for (let pi = newPls.length - 1; pi >= 0 && remaining > 0; pi--) {
    const { adj } = _poLineSizeInfo(newPls[pi], sz); if (adj <= 0) continue;
    const take = Math.min(adj, remaining); remaining -= take;
    const pl = newPls[pi];
    const newOrd = safeNum(pl[sz]) - take;
    if (newOrd > 0) pl[sz] = newOrd;
    else { delete pl[sz]; if (pl.cancelled && pl.cancelled[sz] != null) { const c = Object.assign({}, pl.cancelled); delete c[sz]; pl.cancelled = c } }
    _recalcPoLineStatus(pl);
  }
  // Stamp the write-off on the lines actually holding the stranded units, so months later the
  // answer to "why is there cost here with nothing to sell?" is on the record. `_absorbed` is
  // underscore-prefixed, so every size-key walk (garmentCost, receiving, the save mapper) skips
  // it, and it round-trips through so_item_po_lines.sizes with no schema change.
  if (plan.absorb > 0) {
    let left = plan.absorb;
    const stamp = { at: (opts && opts.at) || new Date().toISOString(), by: (opts && opts.by) || '' };
    for (let pi = newPls.length - 1; pi >= 0 && left > 0; pi--) {
      const { locked } = _poLineSizeInfo(newPls[pi], sz); if (locked <= 0) continue;
      const take = Math.min(locked, left); left -= take;
      newPls[pi]._absorbed = (newPls[pi]._absorbed || []).concat([Object.assign({ sz, qty: take }, stamp)]);
    }
  }
  // Drop lines left with no size buckets and no receiving/billing history
  plan.po_lines = newPls.filter(pl => {
    if (_poLineSizeKeys(pl).length > 0) return true;
    return Object.values(pl.received || {}).some(v => v > 0) || Object.values(pl.billed || {}).some(v => v > 0);
  });
  return plan;
}
// Units a PO already received or billed for a size the SO line no longer sells — what an absorb
// leaves behind (also catches a plain vendor over-ship). Derived from both sides rather than read
// from a stored flag, so it stays true after any later edit to the size or to the PO.
function absorbedSizes(item) {
  const lines = safePOs(item);
  const sizes = safeSizes(item);
  const keys = new Set();
  lines.forEach(pl => { Object.keys(pl.received || {}).forEach(k => keys.add(k)); Object.keys(pl.billed || {}).forEach(k => keys.add(k)) });
  const out = {};
  keys.forEach(sz => {
    const locked = lines.reduce((a, pl) => a + Math.max(safeNum((pl.received || {})[sz]), safeNum((pl.billed || {})[sz])), 0);
    const over = locked - safeNum(sizes[sz]);
    if (over > 0) out[sz] = over;
  });
  return out;
}

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
    // Topstar digitizing/vector billing lines are covered by their SO-level deco PO
    // (so.deco_pos) — an item-level PO is never created for them, so counting them as goods
    // held the whole SO in need_order forever ("Items need ordering — Create PO" on every
    // order with a digitizing PO). Count them covered+fulfilled: the file service has its own
    // tracking on the deco PO and must not gate the garment fulfillment ladder.
    // Mirrors constants.js isServiceLine — match the persisted sku markers ('DIGITIZING',
    // 'Artwork'), not just the in-memory _topstar flag (never saved to so_items, so it's gone
    // after a reload). Artwork charge lines are in-house art time with no vendor PO — they
    // must not hold the SO in need_order (SO-1566).
    if (it._topstar || it.sku === 'DIGITIZING' || /^artwork$/i.test(safeStr(it.sku).trim())) {
      let units = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
      if (units === 0) units = safeNum(it.est_qty);
      totalSz += units; coveredSz += units; fulfilledSz += units;
      return;
    }
    let entries = Object.entries(safeSizes(it)).filter(([, v]) => safeNum(v) > 0);
    // qty_only items hold their quantity in est_qty (sizes is empty); POs/picks track them under the 'QTY' key
    if (entries.length === 0 && safeNum(it.est_qty) > 0) entries = [['QTY', safeNum(it.est_qty)]];
    entries.forEach(([sz, v]) => {
      totalSz += v;
      const picked = safePicks(it).reduce((a, pk) => a + safeNum(pk[sz]), 0);
      const poOrd = safePOs(it).reduce((a, pk) => a + safeNum(pk[sz]) - safeNum((pk.cancelled || {})[sz]), 0);
      coveredSz += Math.min(v, picked + poOrd);
      const pulledQty = safePicks(it).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
      // Drop-ship lines count billed units as fulfilled (vendor ships direct — the warehouse
      // never checks them in, so `received` stays empty forever). max, not +, so a drop-ship
      // line that also got checked in manually can't count twice. Mirrors safeHelpers.poLineFulfilledQty.
      const rcvdQty = safePOs(it).reduce((a, pk) => a + (pk.drop_ship ? Math.max(safeNum((pk.received || {})[sz]), safeNum((pk.billed || {})[sz])) : safeNum((pk.received || {})[sz])), 0);
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
  // A deco PO carries ONE deco_type but covers whole items, whose decorations may be of several
  // types. When a covering PO's type matches NONE of an item's concretely-typed decorations, the PO
  // is paying for that item's decoration(s) under a default/mislabeled type (SO-1199: an 'embroidery'
  // PO covering DTF & screen-print garments) — so promote that item to the '*' wildcard and suppress
  // its whole in-house set. When the PO's type DOES match a decoration on the item, per-type coverage
  // stands, so a garment can keep one deco in-house while another is sent out. Art with no concrete
  // type yet is ignored here (decoIsOutsourced already treats it as covered), so an unassigned design
  // never forces the promotion.
  Object.keys(map).forEach(ix => {
    const set = map[ix];
    if (set.has('*')) return;
    const it = safeItems(o)[ix];
    if (!it) return;
    const concrete = safeDecos(it).map(d => decoConcreteType(o, d)).filter(Boolean);
    if (concrete.length && !concrete.some(t => set.has(t))) set.add('*');
  });
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
// line) matches its resolved type. This is the single gate job creation (syncJobs) AND every cost
// walk read (Costs tab, OrderEditor totals, calcGP, soCalc, calcOrderMargin, calcTotals) — so
// routing a decoration onto a deco PO suppresses its in-house job AND its in-house cost together,
// never double-counting the in-house cost against the PO's bill (SO-1397).
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

// Every decoration this job claims is routed to an outside vendor — explicitly (fulfillment
// 'outside' / deco_po_id / legacy outside_deco kind) or because its whole item is deco-PO covered
// (the vendor decorates the garment). Such a job retires on the order's next sync (OrderEditor's
// _jobAllOutsourced), but boards that read stored jobs directly (Art Dashboard) need the same
// answer WITHOUT waiting for a sync (SO-1009: a job moved to outside deco sat in Needs Approval).
// Partial PO coverage — a transfers purchase on an item that keeps in-house work — does NOT count:
// that job is still produced in-house. Missing item/deco pairs are NEUTRAL — they can't be produced
// in-house or outside, so they neither grant nor block "routed outside" (SO-1403: a released job
// over an outside-routed tee plus a deleted-deco pant must read routed-outside, matching the sync's
// retirement). A job with no live pairs at all reads false (deleted-line snapshot preservation is
// the sync's business, not the board's).
const jobAllRoutedOutside = (o, j, outByItem) => {
  const map = outByItem || outsourcedDecoTypes(o);
  const pairs = [];
  safeArr(j?.items).forEach(gi => {
    const dis = Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length ? gi.deco_idxs : (gi?.deco_idx != null ? [gi.deco_idx] : []);
    dis.forEach(di => pairs.push([gi.item_idx, di]));
  });
  if (!pairs.length) return false;
  const _itemFullyOut = (ii) => {
    const it = safeItems(o)[ii];
    const ds = it ? safeDecos(it).filter(d => d && (d.kind === 'art' || d.kind === 'numbers' || d.kind === 'names')) : [];
    return ds.length > 0 && ds.every(d => isDecoOutsourced(o, ii, d, map));
  };
  let out = 0;
  for (const [ii, di] of pairs) {
    const it = safeItems(o)[ii]; if (!it) continue;
    const d = safeDecos(it)[di]; if (!d) continue;
    if (d.kind === 'outside_deco' || d.fulfillment === 'outside' || !!d.deco_po_id || _itemFullyOut(ii)) out++;
    else return false;
  }
  return out > 0;
};

// ── Underbase rule ── Screen-print on anything darker than white / light grey / vegas gold needs
// a white underbase (NSA rule). Returns true when the garment color needs one; blank color → false
// (unknown, don't auto-charge). Used to auto-apply the underbase upcharge on pricing lookups.
const _LIGHT_GARMENT = /white|vegas|(?:light|lt)[\s.]*gr[ae]y/i;
// Catalog colors name the BODY first and the trim/logo second ("Black/White", "Team Power Red/ White",
// "Black/White (JX4452)"), so the light test must read the body token ALONE. Testing the whole string
// let every dark two-tone garment escape the underbase upcharge on the "/White" half of its own name —
// EST-2139 priced one screen at $4.90/pc on a Black/White tee and $5.60/pc on a Black one. Strips a
// trailing "(SKU)" note, then keeps everything before the first slash; falls back to the full string
// when that leaves nothing (a color written as "/White").
const _garmentBody = (c) => c.replace(/\s*\([^)]*\)\s*$/, '').split('/')[0].trim() || c;
const garmentNeedsUnderbase = (color) => { const c = safeStr(color).trim(); return c ? !_LIGHT_GARMENT.test(_garmentBody(c)) : false; };

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

// ── Job Building ── Groups items by their full decoration signature. Mixed-media garments
// (e.g. screen-print front + heat-press numbers) stay ONE job so the garments travel through
// production on a single tech sheet — the per-deco-type split (SO-1395/SO-1639) sent the same
// hoodies through the floor as two jobs. Split-art designs still get their own job (per-size
// allocation), and outsourced decorations never enter a bucket (syncJobs), so those still
// separate. The job's deco_type is the primary method (art first); deco_types lists all of them.
const buildJobs = (o) => {
  if (o?.jobs && o.jobs.length > 0) return o.jobs;
  // Build decoration entries per item, grouped by deco type
  const itemSigs = [];
  safeItems(o).forEach((it, idx) => {
    if (it.no_deco) return;
    const decosByType = {};
    safeDecos(it).forEach((d, di) => {
      // Routed outside (soft flag / on a deco PO) — the vendor produces it, so no derived job.
      // Mirrors syncJobs' guard in the editors: without it, an SO whose stored jobs are EMPTY
      // (a fully-outsourced webstore batch never creates any; retiring the last job saves [])
      // fails the short-circuit above and this derive re-materializes phantom jobs on every
      // board. Kind-agnostic, same as isDecoOutsourced — names/numbers route outside too.
      if (d.fulfillment === 'outside' || d.deco_po_id) return;
      if (d.kind === 'art') {
        const artF = d.art_file_id ? safeArr(o?.art_files).find(f => f.id === d.art_file_id) : null;
        const dt = artF?.deco_type || d.deco_type || 'screen_print';
        // Art TBD saves to the DB with a null art_file_id (see _sanitizeDeco), so an unassigned
        // deco must still form a job — keyed by position, mirroring syncJobs in OrderEditor —
        // instead of silently vanishing from the production board.
        const part = d.art_file_id ? 'art_' + d.art_file_id : 'unassigned@' + safeStr(d.position);
        // Split-art designs bucket by ART IDENTITY (not the line's split group) so the same logo
        // split across several lines — and a standalone copy of it — all consolidate into ONE job.
        // Everything else shares the item's single combined bucket: all of a garment's in-house
        // decorations — mixed methods included — form one job.
        const bk = (d.art_file_id && d.split_group) ? 'art::' + d.art_file_id : '__combined';
        if (!decosByType[bk]) decosByType[bk] = [];
        decosByType[bk].push({ part, d, di, _dt: dt });
      } else if (d.kind === 'numbers') {
        const dt = d.num_method || 'heat_transfer';
        const part = 'numbers_' + dt + '@' + (d.position || '');
        if (!decosByType['__combined']) decosByType['__combined'] = [];
        decosByType['__combined'].push({ part, d, di, _dt: dt });
      } else if (d.kind === 'names') {
        const dt = d.name_method || 'heat_press';
        const part = 'names_' + dt + '@' + (d.position || '');
        if (!decosByType['__combined']) decosByType['__combined'] = [];
        decosByType['__combined'].push({ part, d, di, _dt: dt });
      }
    });
    Object.entries(decosByType).forEach(([bk, decos]) => {
      // Primary method for the sig prefix / job deco_type: an art deco's method wins (sorted so
      // the choice is deterministic whatever order the decos were added in); numbers/names methods
      // only lead on garments with no art. All methods still appear in the sorted parts, so two
      // garments group only when their FULL decoration sets (methods included) match.
      const artDts = decos.filter(x => x.d.kind === 'art').map(x => x._dt).sort();
      const dt = artDts[0] || decos.map(x => x._dt).sort()[0] || bk;
      // De-dupe parts so the same logo applied at two positions on one garment keys the same as a
      // single application (one art = one signature = one job).
      const parts = Array.from(new Set(decos.map(x => x.part))).sort();
      const sig = dt + '::' + parts.join('|');
      if (sig) itemSigs.push({ idx, it, sig, decos, decoType: dt });
    });
  });
  // Group by signature
  const sigGroups = {};
  itemSigs.forEach(({ idx, it, sig, decos, decoType }) => {
    if (!sigGroups[sig]) sigGroups[sig] = { sig, items: [], decoType };
    sigGroups[sig].items.push({ idx, it, decos });
  });
  return Object.values(sigGroups).map((grp, gi) => {
    const firstEntry = grp.items[0];
    const positions = new Set();
    const artNames = []; const artIds = []; const decoTypes = [];
    let worstArtSt = 'art_complete';
    firstEntry.decos.forEach(({ d }) => {
      if (d.kind === 'art' && !d.art_file_id) {
        // Art TBD (null id after _sanitizeDeco) — there is no artwork yet, so the job can never
        // read as complete/ready. Mirrors the unassigned branch in OrderEditor's syncJobs.
        positions.add(d.position || '');
        artNames.push('Unassigned Art (' + safeStr(d.position) + ')');
        decoTypes.push(d.deco_type || 'screen_print');
        worstArtSt = 'needs_art';
      } else if (d.kind === 'art' && d.art_file_id) {
        positions.add(d.position || '');
        artIds.push(d.art_file_id);
        const af = safeArr(o?.art_files).find(f => f.id === d.art_file_id);
        if (af) { artNames.push(af.name || 'Unnamed'); decoTypes.push(af.deco_type || 'screen_print');
          // Skipping the production-files stage (landing straight on art_complete) requires EXPLICIT
          // confirmation — the per-design prod_files_attached checkbox, or, for embroidery, a .dst that
          // IS the production file. A file merely sitting in prod_files (e.g. an order-sheet PDF dropped
          // in before the seps exist) is NOT enough, so an approved job waits in its production-files
          // stage until someone confirms. Same rule as artProdFilesConfirmed in constants.js — a .dst
          // confirms on its own; staleness after a recall is gated by af.status, not this check.
          // CANONICAL copy of constants.artStatusForFile (this module is import-free CommonJS and can't
          // share the symbol). The 'uploaded' branch below is load-bearing — keep both in lockstep.
          const _prodConfirmed = af.prod_files_attached === true || ((af.deco_type || '') === 'embroidery' && [...(af.files || []), ...(af.prod_files || [])].some(f => { if (f && typeof f === 'object' && f.stale) return false; const n = (typeof f === 'string' ? f : (f && (f.name || f.url)) || '').toLowerCase(); return n.endsWith('.dst'); }));
          const _prodNeededSt = (['dtf','heat_press'].includes(af.deco_type || '')) ? 'order_dtf_transfers' : (af.deco_type || '') === 'embroidery' ? 'upload_emb_files' : 'production_files_needed';
          const st = af.status === 'approved' ? (_prodConfirmed ? 'art_complete' : _prodNeededSt) : (af.status === 'needs_approval' || af.status === 'uploaded') ? (_hasMockupContent(af) ? 'waiting_approval' : 'needs_art') : 'needs_art';
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
      _art_ids: artIds, art_name: artNames.join(' + ') || 'Unnamed', deco_type: grp.decoType || decoTypes[0] || 'screen_print',
      deco_types: Array.from(new Set(decoTypes.length ? decoTypes : [grp.decoType].filter(Boolean))),
      art_status: worstArtSt, item_status: 'need_to_order', prod_status: 'hold',
      total_units: totalUnits, fulfilled_units: 0, split_from: null, split_group: null, items, _auto: true };
  });
};

// ── Live art files for a job ──
// The designs a job actually decorates with, taken from its items' CURRENT
// decorations rather than the job's stored _art_ids/art_file_id (which can go
// stale when an item's art is swapped, leaving an orphaned art file behind).
// Scoped to the decorations each job item OWNS (deco_idxs) so a numbers-only job —
// or a second logo job on the same garment line — never inherits a sibling job's
// art (which used to gate its completion on, and stamp prod_files_attached onto,
// the OTHER job's art files). Legacy items without deco_idxs keep the unscoped
// behavior. Falls back to the stored ids only when the items reference no art
// (e.g. names/numbers-only jobs). Excludes art files that no longer exist or are archived.
// Mirrors jobItemDecoIdxs in safeHelpers.js (this module stays dependency-free for tests).
const jobItemDecoIdxs = (gi) => Array.isArray(gi?.deco_idxs) && gi.deco_idxs.length ? gi.deco_idxs : null;
const jobLiveArtIds = (j, o) => {
  const ids = []; const seen = new Set();
  (j?.items || []).forEach(gi => {
    const it = safeItems(o)[gi.item_idx]; if (!it) return;
    const dis = jobItemDecoIdxs(gi);
    safeDecos(it).forEach((d, di) => {
      if (dis && !dis.includes(di)) return;
      if (d.kind === 'art' && d.art_file_id && d.art_file_id !== '__tbd' && !seen.has(d.art_file_id)) {
        seen.add(d.art_file_id); ids.push(d.art_file_id);
      }
    });
  });
  let arr = ids;
  if (arr.length === 0) arr = (j?._art_ids && j._art_ids.length) ? j._art_ids : [j?.art_file_id].filter(Boolean);
  return arr.filter(id => { const a = safeArr(o?.art_files).find(f => f.id === id); return a && !a.archived; });
};

// Is this job the BACKORDER half of a split-by-received (the "-S" slice)?
//
// splitByReceived stamps `split_open` for exactly this question, but that flag has been lost in
// the field: so_jobs rejects several columns the client sends (`priced_separately`,
// `price_override`, `split_group`, `_draft` — none exist in the table), and once the save's
// per-column retry budget is spent it falls back to core columns only, which drops `split_open`
// with the rest of the extras. A slice whose flag was lost is treated as a plain deeper split and
// claims its family's receipts FIRST, so the parent's received garments show up as still-open on
// the parent and as in-hand on the backorder — the sizes look shuffled between the two jobs even
// though the jobs' own unit totals are right (SO-1462: JOB-1462-01 rendered S 1/5 · M 4/7 next to
// its 17/17 header while JOB-1462-01-S rendered S 4/4 · M 3/3 next to its 0/8).
//
// `key` is a core column that always survives, and the `__split__S` suffix is minted by
// splitByReceived alone (`__split__B` is by-SKU, `__split__C` is custom), so deriving the
// backorder from it makes the ordering independent of a flag that may not have persisted — and
// heals the rows already saved without it. Nested backorders ("-S-S") keep the suffix and so stay
// in the open tier too.
const isOpenSplitSlice = (j) => !!(j && (j.split_open || /__split__S\d*$/.test(String(j.key || ''))));

// ── Split-family fulfillment apportioning ──
// Received/pulled units are tracked on the SO line item, so every job referencing that item
// reads the same pool. For unrelated jobs that's correct — the same physical garment fulfills
// a front-print job AND a back-embroidery job. But a split family (a parent and the slices
// split off it via split_from) PARTITIONS the item's units between its jobs, so within a
// family the pool must be apportioned, never double-counted: after a split-by-received the
// parent's open remainder would otherwise re-count the very receipts its slice was created to
// own. Slices claim first (deepest split first — matching the receipts-go-to-the-split-first
// convention used when a split is created); the root parent takes what's left. EXCEPTION: a slice
// that isOpenSplitSlice recognizes is a backorder peeled OFF a producible parent ("split off backorder"), so it
// claims LAST within its family — the received units stay on the parent, and the backorder slice
// fills only as its own not-yet-received units actually arrive. Each job is
// capped at its own per-size quantities (gi.sizes when the split recorded them, else the full
// item sizes). Returns one {total, fulfilled, fulSizes[<item index>], itemTotals[<item index>]}
// entry per job, aligned with the jobs array. itemTotals is the per-LINE unit count behind
// `total` — the live source recalcJobFulfillment heals each gi.units from, so a job's lines
// always sum to its summary. It is left undefined for a line whose SO item no longer exists,
// so a dangling reference is never healed down to 0.
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
    return { root, depth, open: isOpenSplitSlice(j) ? 1 : 0 };
  };
  // open: 0 (received parent / normal slice) sorts before 1 (backorder slice) so the backorder
  // claims its family's receipts last; within each open-tier the deepest split still claims first.
  const order = jobs.map((j, i) => ({ i, m: famMeta(j) })).sort((a, b) => (a.m.open - b.m.open) || (b.m.depth - a.m.depth) || (a.i - b.i));
  const claimed = {}; // family root::item_idx::size -> units already taken by deeper slices
  const out = new Array(jobs.length);
  order.forEach(e => {
    const j = jobs[e.i];
    const res = { total: 0, fulfilled: 0, fulSizes: [], itemTotals: [] };
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
      let iTot = 0;
      entries.forEach(([sz, v]) => {
        res.total += v; iTot += v;
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
      res.itemTotals[gii] = iTot;
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
// never both count the same units. EVERY job item gets its scalars gi.units and gi.fulfilled
// refreshed to the allocated/apportioned amounts (split items also refresh their per-size
// gi.fulSizes, which the UI's size chips read and syncJobs preserves), so a job's per-line
// units and fulfilled never drift from its total_units / fulfilled_units summary the way a
// warehouse receipt on a non-split line, or an edit that moved units between a job's garments,
// used to leave them.
// NOTE: no spread syntax in this file — babel would inject an ESM helper import for it,
// which makes webpack treat this CommonJS module as ESM and drop module.exports entirely.
const recalcJobFulfillment = (o, items) => {
  const alloc = allocateJobFulfillment(safeJobs(o), items);
  return safeJobs(o).map((j, ji) => {
    const a = alloc[ji];
    const itemSt = a.fulfilled >= a.total && a.total > 0 ? 'items_received' : a.fulfilled > 0 ? 'partially_received' : 'need_to_order';
    let giChanged = false;
    const newItems = (j.items || []).map((gi, gii) => {
      const fs = a.fulSizes[gii] || {};
      const f = Object.keys(fs).reduce((x, sz) => x + fs[sz], 0);
      // gi.units is a BUILD-TIME snapshot. total_units above is re-derived from the live per-size
      // allocation on every recompute, but the per-line scalar never was — so anything that moved
      // units between a job's garments (an edited size grid, a size shifted onto a second colorway)
      // left the sub-lines summing to something other than the job total, e.g. SO-1199's 40 + 1
      // under a 40-unit job while the size chips on those same rows read 37 and 3. Heal it from
      // the same allocation the chips read. Skipped when the SO item is gone (itemTotals[gii]
      // undefined) so a dangling line isn't silently zeroed.
      const u = a.itemTotals[gii];
      const unitsOff = u != null && safeNum(gi.units) !== u;
      // Split job items carry a per-size gi.sizes and render fulSizes chips, so refresh BOTH the
      // size map and the scalar. A plain (non-split) job item has no gi.sizes and only tracks the
      // scalar gi.fulfilled — refresh just that. It used to be skipped entirely, so gi.fulfilled
      // froze at its build-time 0 even as receipts arrived: after a warehouse receive the job
      // summary read e.g. "50 fulfilled" while every line under it still read 0, drifting from
      // fulfilled_units. OrderEditor.syncJobs already derives gi.fulfilled from receipts — mirror
      // it here so the recompute and the editor agree instead of one freezing what the other heals.
      if (gi.sizes && Object.keys(gi.sizes).length > 0) {
        const old = gi.fulSizes || {};
        const oldKeys = Object.keys(old).filter(sz => safeNum(old[sz]) > 0);
        const same = safeNum(gi.fulfilled) === f && oldKeys.length === Object.keys(fs).length && oldKeys.every(sz => safeNum(old[sz]) === fs[sz]);
        if (same && !unitsOff) return gi;
        giChanged = true;
        const upd = { fulSizes: fs, fulfilled: f };
        if (unitsOff) upd.units = u;
        return Object.assign({}, gi, upd);
      }
      if (safeNum(gi.fulfilled) === f && !unitsOff) return gi;
      giChanged = true;
      const upd = { fulfilled: f };
      if (unitsOff) upd.units = u;
      return Object.assign({}, gi, upd);
    });
    if (!giChanged && j.item_status === itemSt && j.fulfilled_units === a.fulfilled && j.total_units === a.total) return j;
    return Object.assign({}, j, { item_status: itemSt, fulfilled_units: a.fulfilled, total_units: a.total, items: newItems });
  });
};

// ── Derived (display) product status for a job ──
// The stored item_status (set by recalcJobFulfillment) tracks RECEIPTS only: it reads
// 'need_to_order' whenever fulfilled_units is 0, even when a PO already covers every unit.
// That's correct for the floor release gate (advance_job_stage / jobReadiness key off it —
// "goods in hand?"), but it is the WRONG thing to LABEL "Need to Order" on the Jobs board:
// a job whose garments are fully on a PO — or a drop-ship job that never gets received —
// would sit under "Need to Order" forever even though nothing more needs ordering.
// This derives a coverage-aware status for DISPLAY/FILTER, mirroring calcSOStatus's coverage
// math (committed = PO ordered − cancelled, or already on a pick line). It NEVER mutates the
// stored item_status. Same ladder as OrderEditor's job-detail jItemStatus so the Jobs list and
// the order's job detail agree:
//   items_received  — every unit received/pulled
//   partially_received — some (but not all) units received
//   waiting_receive — nothing received, but every unit is committed (fully ordered/picked)
//   on_order        — nothing received, some units committed
//   need_to_order   — nothing received and nothing committed (genuinely still needs a PO)
const deriveJobItemStatus = (j, o) => {
  const total = safeNum(j.total_units);
  const ful = safeNum(j.fulfilled_units);
  if (total > 0 && ful >= total) return 'items_received';
  if (ful > 0) return 'partially_received';
  const items = safeItems(o);
  let totalSz = 0, coveredSz = 0;
  (j.items || []).forEach(gi => {
    const it = items[gi.item_idx];
    if (!it) return;
    // Split job items carry their own subset in gi.sizes; fall back to the full line otherwise.
    // qty_only items (no size breakdown) hold their count in est_qty under the 'QTY' bucket.
    let entries = Object.entries(gi.sizes && Object.keys(gi.sizes).length > 0 ? gi.sizes : safeSizes(it)).filter(([, v]) => safeNum(v) > 0);
    if (entries.length === 0 && safeNum(it.est_qty) > 0) entries = [['QTY', safeNum(it.est_qty)]];
    entries.forEach(([sz, v]) => {
      const need = safeNum(v);
      totalSz += need;
      const picked = safePicks(it).reduce((a, pk) => a + safeNum(pk[sz]), 0);
      const poOrd = safePOs(it).reduce((a, pk) => a + safeNum(pk[sz]) - safeNum((pk.cancelled || {})[sz]), 0);
      coveredSz += Math.min(need, picked + poOrd);
    });
  });
  // Nothing to source: the job carries no garment units at all (no job items, or every item
  // it points at is gone / has zero quantity — e.g. SO-1684's three 0-unit art jobs). Such a
  // job can never be "ordered", so falling through to 'need_to_order' parked it under the Jobs
  // board's "Need to Order" chip forever on orders where every garment IS on a PO. Return null
  // (no product state) so it matches no product chip and doesn't inflate "Needs Product".
  if (totalSz === 0) return null;
  if (coveredSz >= totalSz) return 'waiting_receive';
  if (coveredSz > 0) return 'on_order';
  return 'need_to_order';
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
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + Math.max(0, safeNum(v)), 0);
    safeDecos(it).forEach(d => { if (d.kind === 'art' && d.art_file_id) { artQty[d.art_file_id] = (artQty[d.art_file_id] || 0) + q } });
  });
  const af = safeArt(o);
  // Same outsourced gate as Costs tab / OrderEditor totals / calcGP / calcOrderMargin —
  // never add in-house deco cost for decorations a deco PO already covers (SO-1397).
  const outByItem = outsourcedDecoTypes(o);
  let rev = 0, cost = 0;
  safeItems(o).forEach((it, ii) => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + Math.max(0, safeNum(v)), 0);
    if (!q) return;
    rev += q * safeNum(it.unit_sell);
    cost += q * safeNum(it.nsa_cost);
    safeDecos(it).forEach(d => {
      const cq = d.kind === 'art' && d.art_file_id ? artQty[d.art_file_id] : q;
      const dp = dP(d, q, af, cq);
      const eq = dp._nq != null ? dp._nq : (d.reversible ? q * 2 : q);
      rev += eq * dp.sell;
      if (!isDecoOutsourced(o, ii, d, outByItem)) cost += eq * dp.cost;
    });
    // Legacy per-item outside-deco POs: the supplier-bill refactor moved these
    // onto o.deco_pos[], but historical orders still carry them on items[].po_lines —
    // their decoration cost must still be counted so margins aren't overstated.
    (it.po_lines || []).forEach(pl => {
      if (pl.po_type !== 'outside_deco') return;
      const plQty = Object.keys(safeSizes(it)).reduce((a, sz) => a + Math.max(0, safeNum(pl[sz])), 0);
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
  // Prior shipping carried from a Manual Ship recorded when the customer had no open order.
  const priorShip = safeNum(o.pending_ship_applied ? o.pending_ship_amount : 0);
  const tax = rev * (cust?.tax_rate || 0);
  return { rev, cost, ship, priorShip, tax, grand: rev + ship + priorShip + tax, margin: rev - cost, pct: rev > 0 ? ((rev - cost) / rev * 100) : 0 };
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
        decoRev += (dp._nq != null ? dp._nq : qty) * dp.sell;
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
  // Same >0 guard as retail_price: a negative nsa_cost (cost-correction typo) must not
  // produce a negative sell price flowing into promoRev/customerPays.
  const c = safeNum(item.nsa_cost);
  return c > 0 ? c * 2.0 : 0;
}

// Calculate promo-adjusted totals for an order
// Returns { promoRev, promoShip, promoAmount, normalRev, normalShip, normalTax, customerPays }
function calcPromoTotals(o, cust) {
  if (!o.promo_applied) return null;

  const artQty = {};
  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + Math.max(0, safeNum(v)), 0);
    safeDecos(it).forEach(d => {
      if (d.kind === 'art' && d.art_file_id) { artQty[d.art_file_id] = (artQty[d.art_file_id] || 0) + q }
    });
  });
  const af = safeArt(o);
  let promoRev = 0, promoCost = 0, normalRev = 0, normalCost = 0, origPromoRev = 0;

  safeItems(o).forEach(it => {
    const q = Object.values(safeSizes(it)).reduce((a, v) => a + Math.max(0, safeNum(v)), 0);
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
      const q = Object.values(safeSizes(it)).reduce((a, v) => a + Math.max(0, safeNum(v)), 0);
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

// ─── Unaccounted-for line drops (data-loss guard helper) ───
// Returns the sku|color keys of DB rows a save would delete WITHOUT this session having removed them.
// Empty array = the save is safe to let through.
//
// Why this exists: the SO save rewrites so_items wholesale (insert-new / delete-old), and its count-mismatch
// guard trusts any session that loaded items cleanly — but "loaded cleanly" is a fact about load time, not
// about whether the list is still complete when the save fires. A tab open across another user's edit, or a
// list shortened at load by the loader's item_index dedup, both pass that guard and silently delete real
// garment lines (SO-1468 lost two, 2026-07-13/14).
//
// Deliberately narrow, so this can't block ordinary work: it only reports a drop when the client list is a
// PURE SUBSET of the DB's — every client line matches a DB row, with at least one DB row left over. A silent
// drop is always a pure subset; import/convert/replace flows introduce new keys and are never one, so they
// keep their existing behaviour. `removedKeys` is the session tombstone the editor stamps when the user
// actually deletes a line, which is what separates a deliberate removal from a loss.
function unaccountedDroppedItems(clientItems, dbItems, removedKeys) {
  const items = Array.isArray(clientItems) ? clientItems : [];
  const rows = Array.isArray(dbItems) ? dbItems : [];
  if (items.length === 0 || rows.length === 0) return [];// zero-wipe is a different guard's job
  const keyOf = (x) => ((String((x && x.sku) || '')) + '|' + (String((x && x.color) || ''))).toLowerCase();
  // Compared as SETS, not multisets, and deliberately so. An interrupted save swap (insert-new
  // succeeded, delete-old never ran) leaves genuine duplicate rows behind — that is the state the
  // loader's item_index dedup exists to collapse, and counting copies here would report the leftover
  // as a dropped line and block every save on that order until someone cleaned it by hand. That is
  // the very false-positive _oldDistinctItemIndexCount was introduced to avoid. A line is LOST only
  // when its sku|color disappears from the order entirely, which is what set difference measures.
  // Cost of this choice: two lines sharing a sku+color (same garment, different decoration) are one
  // key, so deleting one of them is invisible here. That errs toward abstaining rather than
  // false-blocking, and the pre-existing count/hydration guards still see that case.
  const dbKeys = new Set(rows.map(keyOf));
  const clientKeys = new Set(items.map(keyOf));
  for (const k of clientKeys) { if (!dbKeys.has(k)) return []; }// new keys → replace/import, not a drop
  const tombstoned = new Set(Array.isArray(removedKeys) ? removedKeys : []);
  const out = [];
  for (const k of dbKeys) { if (!clientKeys.has(k) && !tombstoned.has(k)) out.push(k); }
  return out;
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

// ─── Commission / account attribution ───
// The account OWNER (customer.primary_rep_id) is credited — for earned commission, pipeline,
// promo-cost deductions, and every per-rep rollup. The SO creator (so.created_by) is only a fallback
// for accounts that have no assigned rep. This ordering decides who gets PAID, so it lives here as the
// single source of truth: a reversed `created_by || primary_rep_id` credited whoever happened to write
// the order instead of the account's rep, leaking open invoices on another rep's account into the
// creator's pipeline (the Rancho Buena Vista regression). Route ALL commission attribution through this
// helper so the rule can never drift or get reversed at one of its call sites again.
//
// `inv.rep_id` (invoices.rep_id, migration 20260815120000) outranks both — it is the ONE deliberate,
// per-document override, set from the invoice detail page's Rep pencil. It exists because the only way
// to move a single invoice to another rep used to be rewriting the customer's primary rep, which
// reassigned the whole account and, since attribution stays live rather than frozen at snapshot time,
// retroactively moved already-paid commission lines with it. NULL/absent means "follow the account",
// so every invoice that has never been overridden attributes exactly as it did before.
//
// Pass `inv` at every call site that has an invoice in hand. Call sites that only have a sales order
// (uninvoiced pipeline) correctly pass nothing — an SO with no invoice has no override to honor.
function commissionRepId(customer, so, inv) {
  return (inv && inv.rep_id) || (customer && customer.primary_rep_id) || (so && so.created_by) || null;
}

// Who may be listed as the rep on an account/job and earn commission. Sales reps and admins
// always qualify; any other role (e.g. a CSR) can be opted in per-person via the
// `commission_eligible` flag so they can own accounts and appear in commission reports WITHOUT
// giving up their base role. This is the single source of truth for rep-eligibility — route
// every "is this person a sellable rep" list/filter through it so the rule can't drift across
// its ~20 call sites the way a copy-pasted `role==='rep'||role==='admin'` silently would.
function isCommissionRep(r) {
  return !!r && (r.role === 'rep' || r.role === 'admin' || r.commission_eligible === true);
}

// ── Garment (blank) cost for one SO item — the single PO-aware cost walk ──
// Replaces the hand-synced copies in OrderEditor `totals`, Reports soCalc (App.js), and
// calcGP (CommissionsPage.js), which priced every PO line at ordered qty × unit_cost
// (catalog fallback) and never read the supplier bill — so once a vendor bill landed at a
// different price or quantity than ordered (SO-1271: hats billed at $5.63 against an $8.71
// catalog cost), the header margin, Reports pipeline, and commission GP all kept the stale
// expected number while the Costs tab showed the real one. Rules:
//  • Billed PO line (_bill_cost > 0): the bill is the cost of record for the billed units;
//    a still-open ordered remainder stays at expected (unit_cost, catalog fallback). A bill
//    with no billed size breakdown is treated as covering the whole line (matches the Costs
//    tab's Actual column) so it can't double-count.
//  • Un-billed PO line: ordered qty × unit_cost (catalog fallback) — unchanged.
//  • Ordered qty short of the item's sold qty: remainder at catalog (_sizeCosts-aware).
// PO-line size keys are found by the same meta-key blocklist the per-PO modal uses.
const _PO_LINE_META = new Set(['status','po_id','received','shipments','cancelled','po_type','deco_vendor','deco_type','created_at','memo','notes','expected_date','billed','tracking_numbers','unit_cost','vendor','drop_ship','batch_queue_id','batch_po_number','preexisting','email_history','shipping','api_order_id','api_ordered_at','vendor_keys']);
const _catalogUnitAvg = (it, sq) => {
  if (it._sizeCosts && sq > 0) {
    const tot = Object.entries(safeSizes(it)).reduce((a, [sz, v]) => { const n = safeNum(v); return n > 0 ? a + n * (it._sizeCosts[sz] || safeNum(it.nsa_cost)) : a; }, 0);
    return sq > 0 ? tot / sq : safeNum(it.nsa_cost);
  }
  return safeNum(it.nsa_cost);
};
function garmentCost(it) {
  const sq = Object.values(safeSizes(it)).reduce((a, v) => a + safeNum(v), 0);
  const q = sq > 0 ? sq : safeNum(it.est_qty);
  // A line with no quantity left normally costs nothing — EXCEPT when a PO already received or
  // billed units against it. That is the write-off an absorb leaves behind (planSizeCut): the
  // goods were bought, so the order keeps carrying them until a credit or a return, and the walk
  // below prices them off the po_lines. Without this the cost silently vanished the moment the
  // last size was zeroed, which is exactly the loss the absorb is supposed to make visible.
  const _lockedUnits = safePOs(it).reduce((a, pl) => a + [...new Set([...Object.keys(pl.received || {}), ...Object.keys(pl.billed || {})])]
    .reduce((b, sz) => b + Math.max(safeNum((pl.received || {})[sz]), safeNum((pl.billed || {})[sz])), 0), 0);
  if (!q && !_lockedUnits) return { cost: 0, poQty: 0, q: 0 };
  let poQty = 0, poCost = 0;
  safePOs(it).forEach(pl => {
    if (!pl) return;
    const u = pl.unit_cost != null ? safeNum(pl.unit_cost) : safeNum(it.nsa_cost);
    let lineQty = 0;
    Object.entries(pl).forEach(([k, v]) => { if (k.startsWith('_') || _PO_LINE_META.has(k)) return; if (typeof v !== 'number' || v <= 0) return; lineQty += v; });
    const bc = safeNum(pl._bill_cost);
    if (bc > 0) {
      const billedQty = Object.values(pl.billed || {}).reduce((a, v) => a + (typeof v === 'number' && v > 0 ? v : 0), 0);
      if (billedQty > lineQty && lineQty > 0) {
        // The bill covers more units than this line holds — a doc-level supplier bill whose
        // billed sizes were reconciled to the FULL document, spanning other orders' garments
        // (SO-1396: 50 shirts carrying a $1,815 bill for 250). Charge this line only its own
        // share at the billed unit price; the rest of the doc belongs to other lines/orders.
        poCost += bc * lineQty / billedQty;
      } else {
        const openQty = billedQty > 0 ? Math.max(0, lineQty - billedQty) : 0;
        poCost += bc + openQty * u;
      }
    } else {
      poCost += lineQty * u;
    }
    poQty += lineQty;
  });
  let cost;
  if (poQty > 0) {
    cost = poCost;
    const uncov = Math.max(0, q - poQty);
    if (uncov > 0) cost += uncov * _catalogUnitAvg(it, sq);
  } else if (it._sizeCosts && sq > 0) {
    cost = Object.entries(safeSizes(it)).reduce((a, [sz, v]) => { const n = safeNum(v); return n > 0 ? a + n * (it._sizeCosts[sz] || safeNum(it.nsa_cost)) : a; }, 0);
  } else {
    cost = q * safeNum(it.nsa_cost);
  }
  return { cost, poQty, q };
}

// ── Portal Assistant write helpers ──
// Single source of truth for the assistant's confirmed record mutations. Used by BOTH
// editors' 'nsa:assistant-*' window-event listeners (OrderEditor.js / OrderEditorClassic.js
// — the listeners must stay identical, see CLAUDE.md) AND by App.js's handleAssistant*
// handlers, which run the same functions to build the ConfirmCard preview. One copy of the
// math means the preview the user confirms and the change that lands can't drift.

// Map a user-worded size onto the record's REAL size bucket, so "set the xl to 12" edits
// XL instead of minting a phantom lowercase 'xl' bucket that inflates totals. Order:
// exact key, case-insensitive match against the item's existing sizes/available_sizes,
// canonical alias (large->L, xxl->2XL, one size->OSFA…), else uppercase short tokens.
const _ASN_SIZE_ALIAS = { xs: 'XS', s: 'S', small: 'S', m: 'M', med: 'M', medium: 'M', l: 'L', lg: 'L', large: 'L', xl: 'XL', xlarge: 'XL', 'x-large': 'XL', 'x large': 'XL', xxl: '2XL', '2x': '2XL', '2xl': '2XL', xxxl: '3XL', '3x': '3XL', '3xl': '3XL', '4x': '4XL', '4xl': '4XL', osfa: 'OSFA', 'one size': 'OSFA', 'one-size': 'OSFA', os: 'OSFA', ys: 'YS', ym: 'YM', yl: 'YL', yxl: 'YXL' };
function assistantNormSize(item, raw) {
  const s = safeStr(raw).trim();
  if (!s) return '';
  const keys = [...new Set([...Object.keys(safeSizes(item)), ...safeArr(item && item.available_sizes).map(safeStr)])];
  if (keys.includes(s)) return s;
  const low = s.toLowerCase();
  const ci = keys.find(k => k.toLowerCase() === low);
  if (ci) return ci;
  const alias = _ASN_SIZE_ALIAS[low];
  if (alias) { const ci2 = keys.find(k => k.toLowerCase() === alias.toLowerCase()); return ci2 || alias; }
  return s.length <= 4 ? s.toUpperCase() : s;
}

// Resolve which line the user means from a SKU or free-text description. Exact SKU first,
// then SKU-contains, then all-words-in sku+name+color, then a unique any-word match.
// Returns {idx, item} | {error:'not_found'} | {error:'ambiguous', matches:[...]}.
function assistantFindLine(order, query) {
  const items = safeItems(order).map((it, i) => ({ it, i }));
  const q = safeStr(query).trim().toLowerCase();
  if (!q) return { error: 'not_found' };
  const hay = (it) => (safeStr(it.sku) + ' ' + safeStr(it.name) + ' ' + safeStr(it.color)).toLowerCase();
  let m = items.filter(({ it }) => safeStr(it.sku).toLowerCase() === q);
  if (!m.length && q.length >= 3) m = items.filter(({ it }) => safeStr(it.sku).toLowerCase().includes(q));
  if (!m.length) {
    const words = q.split(/\s+/).filter(w => w.length > 1);
    if (words.length) m = items.filter(({ it }) => words.every(w => hay(it).includes(w)));
  }
  if (!m.length) {
    const words = q.split(/\s+/).filter(w => w.length > 2);
    const any = items.filter(({ it }) => words.some(w => hay(it).includes(w)));
    if (any.length === 1) m = any;
  }
  if (!m.length) return { error: 'not_found' };
  if (m.length > 1) return { error: 'ambiguous', matches: m.slice(0, 4).map(({ it, i }) => ({ idx: i, sku: it.sku, name: it.name, color: it.color })) };
  return { idx: m[0].i, item: m[0].it };
}

// Plan/apply an edit to one line: size quantities (absolute), a bare qty (est_qty lines),
// sell price, or a target margin. Pure — returns the next order plus human-readable
// change rows for the ConfirmCard, or {error}. Size reductions that dip into PO-committed
// units run through planSizeCut exactly like the editor's uSz does; 'blocked'/'absorb'
// outcomes are refused (those need the editor's own modals), open-unit cuts are applied
// with a note. Sell edits mirror the editor's per-size-sell rescale (OrderEditor.js
// "Sell" $In onChange) so upcharge items keep their blended price.
function assistantLineEdit(order, idx, edit, opts) {
  const items = safeItems(order);
  let item = items[idx];
  if (!item) return { error: 'That line is no longer on the order.' };
  item = Object.assign({}, item);
  const changes = [], notes = [];
  const by = safeStr(opts && opts.by);
  // Normalize every requested size key onto the line's real buckets first (see
  // assistantNormSize) — later duplicates win so "xl" and "XL" can't both land.
  const _szMap = new Map();
  Object.entries(safeObj(edit && edit.sizes)).forEach(([k, v]) => { const sz = assistantNormSize(item, k); if (sz) _szMap.set(sz, v); });
  // Removing a size = setting it to 0 (the committed-units guards below still apply);
  // the size bucket stays visible at 0, which is the reversible, honest form of "off".
  safeArr(edit && edit.remove_sizes).forEach(s => { const sz = assistantNormSize(item, s); if (sz && !_szMap.has(sz)) _szMap.set(sz, 0); });
  const setSizes = [..._szMap.entries()];
  for (const [szRaw, vRaw] of setSizes) {
    const sz = safeStr(szRaw).trim();
    const n = Math.max(0, Math.floor(safeNum(Number(vRaw))));
    if (!sz) continue;
    const cur = safeNum(safeSizes(item)[sz]);
    if (n === cur) continue;
    const picked = safePicks(item).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
    const committed = picked + poCommitted(safePOs(item), sz);
    if (n < committed && committed > 0) {
      const plan = planSizeCut(item, sz, n, { by });
      if (plan.kind === 'blocked') return { error: 'Cannot reduce ' + sz + ' below ' + plan.picked + ' — those units are already pulled for this order. Return the pick to stock in the editor first.' };
      if (plan.kind === 'absorb') return { error: sz + ' has units already received/billed on ' + plan.absorbPoIds.join(', ') + ' — that write-off needs to be confirmed in the editor, not from chat.' };
      if (plan.kind === 'cut' && plan.po_lines) { item.po_lines = plan.po_lines; notes.push(plan.poIds.join(', ') + ' lowered by ' + plan.cut + ' open unit' + (plan.cut !== 1 ? 's' : '') + ' to match'); }
    }
    item.sizes = Object.assign({}, safeSizes(item)); item.sizes[sz] = n;
    if (!safeArr(item.available_sizes).includes(sz)) item.available_sizes = [...safeArr(item.available_sizes), sz];
    changes.push({ label: 'Size ' + sz, before: String(cur), after: String(n) });
  }
  if (Object.values(safeSizes(item)).reduce((a, v) => a + safeNum(v), 0) > 0 && safeNum(item.est_qty) > 0) item.est_qty = 0; // mirrors uSz
  if (edit && edit.qty != null) {
    const n = Math.max(0, Math.floor(safeNum(Number(edit.qty))));
    const szTotal = Object.values(safeSizes(item)).reduce((a, v) => a + safeNum(v), 0);
    if (szTotal > 0) return { error: 'That line has per-size quantities — tell me the size(s) to change (e.g. "set L to 12").' };
    changes.push({ label: 'Quantity', before: String(safeNum(item.est_qty)), after: String(n) });
    item.est_qty = n;
    // est_qty is only visible/editable through the editor's qty-only UI (the "Custom —
    // No Sizes / Qty Only" mode); without the flag the quantity prices invisibly.
    if (!item.qty_only) item.qty_only = true;
  }
  let targetSell = null;
  if (edit && edit.margin_pct != null) {
    const m = Number(edit.margin_pct);
    if (!(m > 0 && m < 100)) return { error: 'Margin must be between 0 and 100.' };
    const cost = safeNum(item.nsa_cost);
    if (!(cost > 0)) return { error: 'No cost on file for ' + (item.sku || 'that line') + ' — set the sell price directly instead.' };
    targetSell = Math.round((cost / (1 - m / 100)) * 100) / 100;
  }
  if (edit && edit.unit_sell != null) {
    const v = Number(edit.unit_sell);
    if (!(v >= 0 && isFinite(v))) return { error: 'That sell price doesn\'t look right.' };
    targetSell = Math.round(v * 100) / 100;
  }
  if (targetSell != null) {
    // Mirror of the editor's Sell $In onChange: rescale per-size sells to the entered
    // per-each (cent precision) before setting unit_sell, so upcharge lines stay blended.
    if (item._sizeSells && item._sizeCosts) {
      const mk = safeNum(order && order.default_markup) || 1.65;
      const szQty = Object.values(safeSizes(item)).reduce((a, v) => a + safeNum(v), 0);
      const pCost = Object.entries(safeSizes(item)).reduce((a, [sz, v]) => a + safeNum(v) * safeNum(item._sizeCosts[sz] != null ? item._sizeCosts[sz] : item.nsa_cost), 0);
      const avgCost = szQty > 0 ? pCost / szQty : safeNum(item.nsa_cost);
      const ratio = avgCost > 0 ? targetSell / (avgCost * mk) : 1;
      const ns = {};
      Object.entries(item._sizeCosts).forEach(([sz, c]) => { ns[sz] = Math.round(safeNum(c) * mk * ratio * 100) / 100; });
      item._sizeSells = ns;
    }
    changes.push({ label: edit.margin_pct != null && edit.unit_sell == null ? 'Sell (at ' + Number(edit.margin_pct) + '% margin)' : 'Sell price', before: '$' + safeNum(item.unit_sell).toFixed(2), after: '$' + targetSell.toFixed(2) });
    item.unit_sell = targetSell;
  }
  if (!changes.length) return { error: 'Nothing to change — tell me the sizes, quantity, sell price, or margin.' };
  const next = Object.assign({}, order, { items: items.map((it, x) => x === idx ? item : it), updated_at: new Date().toLocaleString() });
  return { next, item, changes, notes };
}

// Guard + apply for deleting a whole line — the exact rules of the editors' rmI (kept in
// lockstep with rmI in OrderEditor.js / OrderEditorClassic.js; if rmI's guards change,
// change these too). Guard returns {error} (received/billed/PO'd items) or
// {frozenJobIds:[...]} — frozen refs are a warning the ConfirmCard shows instead of
// rmI's window.confirm. Apply returns the next order: tombstone, item dropped, and
// job/deco-PO item_idx remapped exactly like rmI.
function assistantRemoveLineGuard(order, idx, isSO) {
  const item = safeItems(order)[idx];
  if (!item) return { error: 'That line is no longer on the order.' };
  if (isSO) {
    const pos = safePOs(item);
    if (pos.length > 0) {
      const hasReceived = pos.some(po => Object.values(po.received || {}).some(v => v > 0));
      const hasBilled = pos.some(po => Object.values(po.billed || {}).some(v => v > 0));
      if (hasReceived || hasBilled) return { error: 'Cannot delete — this item has ' + (hasReceived ? 'received' : '') + (hasReceived && hasBilled ? ' and ' : '') + (hasBilled ? 'billed' : '') + ' PO quantities. Remove billing/receiving first.' };
      return { error: 'Cannot delete — this item has PO(s). Delete the PO(s) first (I can remove a PO line for you), then remove the item.' };
    }
  }
  const frozenJobIds = safeJobs(order).filter(j => (j._released || (j.key || '').startsWith('released_') || j._merged || j.split_from) && (j.items || []).some(gi => gi.item_idx === idx)).map(j => j.id);
  return { frozenJobIds };
}
function assistantRemoveLineApply(order, idx, itemKey) {
  const item = safeItems(order)[idx];
  const _ri = ii => ii > idx ? ii - 1 : ii;
  return Object.assign({}, order, {
    _deletedItemKeys: (item && itemKey) ? [...safeArr(order._deletedItemKeys), itemKey] : safeArr(order._deletedItemKeys),
    items: safeItems(order).filter((_, x) => x !== idx),
    jobs: safeJobs(order).map(j => Object.assign({}, j, { items: (j.items || []).filter(gi => gi.item_idx !== idx).map(gi => Object.assign({}, gi, { item_idx: _ri(gi.item_idx) })) })),
    deco_pos: safeArr(order.deco_pos).map(dp => Object.assign({}, dp, { item_idxs: (dp.item_idxs || []).filter(ii => ii !== idx).map(_ri) })),
    updated_at: new Date().toLocaleString(),
  });
}

// PO-line removal. Find the target line(s) on one order by PO number and/or SKU (+size),
// then apply the same transformation the human paths use: size-level → cancel the open
// units on that size (the full-page PO view's cancel tool); whole line → drop the
// item's po_line for that PO (the edit-PO modal's Delete PO), stamping the
// _deletedPoIds session tombstone when no other line still carries the PO. Received or
// billed units always refuse. Job/SO status needs no explicit recompute — it derives
// live from po_lines (deriveJobItemStatus), same as after a human Delete PO.
const _asnPoIdMatch = (poId, ref) => {
  const norm = s => safeStr(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const a = norm(poId), b = norm(ref);
  return !!a && !!b && (a === b || a === 'po' + b || 'po' + a === b);
};
function assistantFindPoLine(order, { poRef, sku, size }) {
  const out = [];
  safeItems(order).forEach((it, itemIdx) => {
    if (sku) {
      const s = safeStr(sku).toLowerCase(), have = safeStr(it.sku).toLowerCase();
      if (!(have === s || (s.length >= 3 && have.includes(s)))) return;
    }
    safePOs(it).forEach((pl, plIdx) => {
      if (poRef && !_asnPoIdMatch(pl.po_id, poRef)) return;
      if (size && !(safeNum(pl[size]) > 0)) return;
      out.push({ itemIdx, plIdx, poId: pl.po_id, item: it, pl });
    });
  });
  return out;
}
function assistantRemovePoLine(order, { itemIdx, plIdx, size }) {
  const items = safeItems(order);
  const item = items[itemIdx];
  const pl = item && safePOs(item)[plIdx];
  if (!pl) return { error: 'That PO line is no longer there.' };
  const poId = pl.po_id;
  const sizeKeys = _poLineSizeKeys(pl);
  const lockedSizes = sizeKeys.filter(sz => (size ? sz === size : true) && (safeNum((pl.received || {})[sz]) > 0 || safeNum((pl.billed || {})[sz]) > 0));
  if (lockedSizes.length) return { error: 'Cannot remove — ' + poId + ' already has received/billed units' + (size ? ' for ' + size : '') + ' (' + lockedSizes.join(', ') + '). Handle receiving/billing in the editor first.' };
  if (pl.status === 'queued' || pl.po_type === 'outside_deco') return { error: poId + ' is ' + (pl.po_type === 'outside_deco' ? 'an outside-decoration PO' : 'batch-queued') + ' — manage it from its own screen, not from chat.' };
  let nextItems, removedWholePo = false, summary;
  if (size) {
    const open = Math.max(0, safeNum(pl[size]) - safeNum((pl.cancelled || {})[size]));
    if (!(open > 0)) return { error: 'No open ' + size + ' units on ' + poId + ' for that line.' };
    const cancelled = Object.assign({}, pl.cancelled, { [size]: safeNum((pl.cancelled || {})[size]) + open });
    const totR = sizeKeys.reduce((a, s2) => a + safeNum((pl.received || {})[s2]), 0);
    const totOpen = sizeKeys.reduce((a, s2) => a + Math.max(0, safeNum(pl[s2]) - safeNum((pl.received || {})[s2]) - safeNum(cancelled[s2])), 0);
    const status = totOpen <= 0 && totR > 0 ? 'received' : totR > 0 ? 'partial' : pl.status;
    const nextPl = Object.assign({}, pl, { cancelled, status });
    nextItems = items.map((it, x) => x === itemIdx ? Object.assign({}, it, { po_lines: safePOs(it).map((p, pi) => pi === plIdx ? nextPl : p) }) : it);
    summary = 'Cancelled ' + open + ' open ' + size + ' unit' + (open !== 1 ? 's' : '') + ' on ' + poId;
  } else {
    nextItems = items.map((it, x) => x === itemIdx ? Object.assign({}, it, { po_lines: safePOs(it).filter((_, pi) => pi !== plIdx) }) : it);
    removedWholePo = !nextItems.some(it => safePOs(it).some(p => p.po_id === poId));
    summary = 'Removed the ' + safeStr(item.sku) + ' line from ' + poId + ' — those sizes go back to open';
  }
  // Object.assign, not object spread — a single {...x} in this file breaks the CJS->ESM
  // transform and wipes every named export from the production build (see NOTE above planSizeCut).
  const extra = removedWholePo ? { _deletedPoIds: [...new Set([...safeArr(order._deletedPoIds), poId])].filter(Boolean) } : {};
  const next = Object.assign({}, order, { items: nextItems, updated_at: new Date().toLocaleString() }, extra);
  return { next, poId, summary, removedWholePo };
}

module.exports = {
  // Safe accessors
  safe, safeArr, safeObj, safeNum, safeStr, safeSizes, safePicks, safePOs, safeDecos, safeItems, safeArt, safeJobs,
  // Attribution
  commissionRepId,
  isCommissionRep,
  // Pricing
  rQ, rT, spP, spFlatShare, spRunBlend, decoSplitRuns, emP, npP, twaP, twnP, dP, DTF, SP, EM, NP, TWA, TWN,
  // Business logic
  poCommitted, unfulfilledSizes, poOverCommit, billOverageQty, billLineNeed, calcSOStatus, buildJobs, outsourcedDecoTypes, decoIsOutsourced, decoConcreteType, isDecoOutsourced, jobAllRoutedOutside, pickCwAsset, normalizeWebLogos, garmentNeedsUnderbase, garmentCost, isJobReady, allocateJobFulfillment, isOpenSplitSlice, recalcJobFulfillment, deriveJobItemStatus, jobsNowReadyForDeco, jobReceivedAt, jobLiveArtIds, jobScreenKey, jobGroupKey, calcTotals, createInvoice,
  // Size reductions that run into POs / picks
  planSizeCut, absorbedSizes,
  // Portal Assistant confirmed writes (shared by both editors + App.js previews)
  assistantNormSize, assistantFindLine, assistantLineEdit, assistantRemoveLineGuard, assistantRemoveLineApply, assistantFindPoLine, assistantRemovePoLine,
  // Booking orders
  isBookingOrder, bookingDaysUntilShip, isBookingActive,
  // Promo dollars
  PROMO_DECO_MULT, PROMO_SHIP_MULT, calcPromoItemSell, calcPromoTotals, calcPromoSpendAllocation, calcQualifyingSpend, getCurrentPromoPeriod, getPreviousPromoPeriod,
  // QB sync
  buildQBSalesOrder, buildQBInvoice,
  // Inventory
  checkInventoryConflicts,
  // Data-loss guards
  itemEditReconciles, itemsWithWipedQty, unaccountedDroppedItems,
};
