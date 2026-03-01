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
const SP = { bk: [{ min: 1, max: 11 }, { min: 12, max: 23 }, { min: 24, max: 35 }, { min: 36, max: 47 }, { min: 48, max: 71 }, { min: 72, max: 107 }, { min: 108, max: 143 }, { min: 144, max: 215 }, { min: 216, max: 499 }, { min: 500, max: 99999 }], pr: { 0: [50, 60, 70, null, null], 1: [5, 6.5, 8, 9, null], 2: [3.5, 4.5, 6, 7, 8], 3: [3.2, 4.25, 4.75, 6, 7.5], 4: [2.95, 3.85, 4.25, 5, 6], 5: [2.75, 3.5, 3.95, 4.5, 5.25], 6: [2.5, 3.2, 3.7, 4, 4.75], 7: [2.25, 3, 3.5, 3.75, 4.25], 8: [2.1, 2.85, 3.1, 3.3, 4], 9: [1.9, 2.75, 2.9, 3.1, 3.75] }, mk: 1.5, ub: 0.15 };
const EM = { sb: [10000, 15000, 20000, 999999], qb: [6, 24, 48, 99999], pr: [[8, 8.5, 8, 7.5], [9, 8.5, 8, 8], [10, 9.5, 9, 9], [12, 12.5, 12, 10]], mk: 1.6 };
const NP = { bk: [10, 50, 99999], co: [4, 3, 3], se: [7, 6, 5], tc: 3 };
const DTF = [{ label: '4" Sq & Under', cost: 2.5, sell: 4.5 }, { label: 'Front Chest (12"x4")', cost: 4.5, sell: 7.5 }];

function spP(q, c, s = true) { const bi = SP.bk.findIndex(b => q >= b.min && q <= b.max); if (bi < 0 || c < 1 || c > 5) return 0; const v = SP.pr[bi]?.[c - 1]; if (v == null) return 0; return s ? v : rQ(v / SP.mk) }
function emP(st, q, s = true) { const si = EM.sb.findIndex(b => st <= b); const qi = EM.qb.findIndex(b => q <= b); if (si < 0 || qi < 0) return 0; const v = EM.pr[si][qi]; return s ? v : rQ(v / EM.mk) }
function npP(q, tw = false, s = true) { const bi = NP.bk.findIndex(b => q <= b); if (bi < 0) return 0; return s ? (NP.se[bi] + (tw ? rQ(NP.tc * 1.65) : 0)) : (NP.co[bi] + (tw ? NP.tc : 0)) }

function dP(d, q, artFiles, cq) {
  const pq = cq || q;
  if (d.kind === 'art' && d.art_file_id && artFiles) {
    if (d.art_file_id === '__tbd') { const tType = d.art_tbd_type || 'screen_print';
      if (tType === 'screen_print') { const nc = d.tbd_colors || 1; const u = d.underbase ? 1 + SP.ub : 1; return { sell: d.sell_override || rQ(spP(pq, nc, true) * u), cost: rQ(spP(pq, nc, false) * u) } }
      if (tType === 'embroidery') return { sell: d.sell_override || emP(d.tbd_stitches || 8000, pq, true), cost: emP(d.tbd_stitches || 8000, pq, false) };
      if (tType === 'heat_press' || tType === 'dtf') { const t = DTF[d.tbd_dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } };
      return { sell: d.sell_override || 0, cost: 0 } }
    const art = artFiles.find(a => a.id === d.art_file_id); if (art) {
      if (art.deco_type === 'screen_print') { const nc = art.ink_colors ? art.ink_colors.split('\n').filter(l => l.trim()).length : 1; const u = d.underbase ? 1 + SP.ub : 1; return { sell: d.sell_override || rQ(spP(pq, nc, true) * u), cost: rQ(spP(pq, nc, false) * u) } }
      if (art.deco_type === 'embroidery') return { sell: d.sell_override || emP(art.stitches || 8000, pq, true), cost: emP(art.stitches || 8000, pq, false) };
      if (art.deco_type === 'dtf') { const t = DTF[art.dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } } } }
  if (d.type === 'screen_print') { const u = d.underbase ? 1 + SP.ub : 1; return { sell: d.sell_override || rQ(spP(q, d.colors || 1, true) * u), cost: rQ(spP(q, d.colors || 1, false) * u) } }
  if (d.type === 'embroidery') return { sell: d.sell_override || emP(d.stitches || 8000, q, true), cost: emP(d.stitches || 8000, q, false) };
  if (d.kind === 'numbers' || d.type === 'number_press') { const nq = d.roster ? Object.values(d.roster).flat().filter(v => v && v.trim()).length : 0; return { sell: d.sell_override || npP(nq || 1, d.two_color, true), cost: npP(nq || 1, d.two_color, false), _nq: nq } };
  if (d.kind === 'names') { const nc = d.names ? Object.values(d.names).flat().filter(v => v && v.trim()).length : 0; const se = safeNum(d.sell_override || d.sell_each || 6); const co = safeNum(d.cost_each || 3); return { sell: nc > 0 ? rQ(nc * se / q) : se, cost: nc > 0 ? rQ(nc * co / q) : co } };
  if (d.type === 'dtf') { const t = DTF[d.dtf_size || 0]; return { sell: d.sell_override || t.sell, cost: t.cost } }
  if (d.kind === 'outside_deco') return { sell: d.sell_override || safeNum(d.sell_each), cost: safeNum(d.cost_each) };
  return { sell: 0, cost: 0 }
}

// ── PO Committed ──
const poCommitted = (poLines, sz) => (poLines || []).reduce((a, pk) => { const ordered = pk[sz] || 0; const cancelled = (pk.cancelled || {})[sz] || 0; return a + (ordered - cancelled) }, 0);

// ── SO Status Calculation ──
function calcSOStatus(ord) {
  let totalSz = 0, coveredSz = 0, fulfilledSz = 0;
  safeItems(ord).forEach(it => {
    Object.entries(safeSizes(it)).filter(([, v]) => safeNum(v) > 0).forEach(([sz, v]) => {
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
  if (!hasAnyDeco && !hasJobs && fulfilledSz >= totalSz) return ord.status === 'complete' ? 'complete' : 'ready_to_invoice';
  if (allJobsDone) return 'ready_to_invoice';
  if (anyJobActive) return 'in_production';
  if (fulfilledSz >= totalSz) return 'items_received';
  if (coveredSz >= totalSz) return 'waiting_receive';
  return 'need_order';
}

// ── Job Building ──
const buildJobs = (o) => {
  if (o?.jobs && o.jobs.length > 0) return o.jobs;
  const artMap = {};
  safeItems(o).forEach((it, idx) => {
    if (it.no_deco) return;
    safeDecos(it).forEach((d, di) => {
      if (d.kind !== 'art' || !d.art_file_id) return;
      const key = 'art_' + d.art_file_id + '_' + d.position;
      if (!artMap[key]) artMap[key] = { art_file_id: d.art_file_id, position: d.position, deco_type: null, items: [] };
      artMap[key].items.push({ item_idx: idx, deco_idx: di, sku: it.sku, name: safeStr(it.name), color: it.color || '', units: Object.values(safeSizes(it)).reduce((a, v) => a + v, 0), fulfilled: 0 });
      const af = safeArr(o?.art_files).find(f => f.id === d.art_file_id);
      if (af) { artMap[key].deco_type = af.deco_type; artMap[key].art_name = af.name; artMap[key].art_status = af.status === 'approved' ? (af.prod_files?.length ? 'art_complete' : 'production_files_needed') : af.status === 'needs_approval' ? 'waiting_approval' : af.status === 'uploaded' ? 'waiting_approval' : 'needs_art' }
    });
  });
  return Object.entries(artMap).map(([key, v], idx) => {
    const totalUnits = v.items.reduce((a, it) => a + it.units, 0);
    return { id: o.id.replace('SO-', 'JOB-') + '-' + (idx + 1 < 10 ? '0' : '') + (idx + 1), key, art_file_id: v.art_file_id,
      art_name: v.art_name || 'Unnamed', deco_type: v.deco_type || 'screen_print',
      art_status: v.art_status || 'needs_art', item_status: 'need_to_order', prod_status: 'hold',
      total_units: totalUnits, fulfilled_units: 0, split_from: null, items: v.items, _auto: true };
  });
};

// ── Job Readiness Check ──
const isJobReady = (j, o) => {
  if (j.art_status !== 'art_complete') return false;
  const af = safeArr(o?.art_files).find(f => f.id === j.art_file_id);
  if (af && (af.prod_files || []).length === 0) return false;
  let totalSz = 0, fulfilledSz = 0;
  (j.items || []).forEach(gi => {
    const it = safeItems(o)[gi.item_idx]; if (!it) return;
    Object.entries(safeSizes(it)).filter(([, v]) => v > 0).forEach(([sz, v]) => {
      totalSz += v;
      const picked = safePicks(it).filter(pk => pk.status === 'pulled').reduce((a, pk) => a + safeNum(pk[sz]), 0);
      const rcvd = safePOs(it).reduce((a, pk) => a + safeNum((pk.received || {})[sz]), 0);
      fulfilledSz += Math.min(v, picked + rcvd);
    });
  });
  return totalSz > 0 && fulfilledSz >= totalSz;
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
      const eq = dp._nq != null ? dp._nq : q;
      rev += eq * dp.sell;
      cost += eq * dp.cost;
    });
    (it.po_lines || []).filter(pl => pl.po_type === 'outside_deco').forEach(pl => {
      const poQty = Object.entries(pl).filter(([k, v]) => typeof v === 'number' && !['unit_cost'].includes(k)).reduce((a, [, v]) => a + v, 0);
      cost += poQty * safeNum(pl.unit_cost);
    });
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
    safeDecos(it2).forEach(d2 => { if (d2.kind === 'art' && d2.art_file_id) { _aq[d2.art_file_id] = (_aq[d2.art_file_id] || 0) + q2 } });
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
      if (sell > 0) lines.push({ type: 'SalesItemLine', desc: 'Decoration: ' + (d.position || d.deco_type || d.kind || 'Art'), qty, rate: sell, amount: qty * sell, account: qbMapping.income_account });
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

module.exports = {
  // Safe accessors
  safe, safeArr, safeObj, safeNum, safeStr, safeSizes, safePicks, safePOs, safeDecos, safeItems, safeArt, safeJobs,
  // Pricing
  rQ, spP, emP, npP, dP, DTF, SP, EM, NP,
  // Business logic
  poCommitted, calcSOStatus, buildJobs, isJobReady, calcTotals, createInvoice,
  // QB sync
  buildQBSalesOrder, buildQBInvoice,
  // Inventory
  checkInventoryConflicts,
};
