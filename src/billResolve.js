/* eslint-disable */
// Pure resolution-proposal engine for supplier bills that don't match cleanly.
//
// Flips reconciliation from "construct the match" to "judge a proposed match": given a
// parsed bill and the wizard's candidate orders, produce ranked, COMPLETE proposals —
// target + per-line ties + evidence strings — so the UI can show "here's what we think
// happened, and here's the proof" with one Accept button.
//
// Grounded in the real failure population (mined from production 2026-07-16):
//   · tag-differs core matches (49 docs / $37k)  → retarget with tag+core evidence
//   · wrong/missing PO number (Trinity: bill "PO 3132 TUH" ↔ order "PO 3131 TUH")
//     → line-fingerprint retarget: 8/8 lines tied, qty vector identical, tag matched
//   · matched but lines won't tie (S&S B-numbers, Agron "5162436D"↔"5162436")
//   · prefix-less old-system POs ("8379SAVFBJH") polluting review as fake work
//
// Dependency-free and unit-tested (billResolve.test.js) — same discipline as ssOrders.js.
// NOTHING here writes; callers apply an accepted proposal through the existing wizard-
// confirm shape, so the money path stays single.

const _ns = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// ── PO string anatomy ────────────────────────────────────────────────────────
// Portal POs look like "PO 3131 TUH" (number + customer alpha tag). Bills mangle
// them every way we've seen: spacing dropped, "PO" prefix dropped, tag glued on,
// digits typo'd. Decompose once so evidence can talk about number and tag separately.
export const poParts = (po) => {
  const flat = _ns(po);
  if (!flat) return { core: '', tag: '', flat };
  const m = flat.replace(/^D?P[O0](?=[A-Z0-9])/, '').match(/^([0-9]{3,})([A-Z0-9]*)$/);
  if (!m) return { core: '', tag: '', flat };
  return { core: m[1], tag: m[2] || '', flat };
};

// Levenshtein distance, small-string use (PO cores are 3-5 digits).
export const editDistance = (a, b) => {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
};

// Old-system detector for the prefix-less class the no-space rule misses:
// "8379SAVFBJH" = 4-digit core glued straight to an alpha tag, no "PO" anywhere,
// and (caller-supplied) the core exists in no live portal PO. Pure string test here;
// the caller layers the portal-core check. Conservative: requires 4+ digit core AND
// glued alpha tail of 2+, so a plain vendor order number ("5866407") stays 'unknown'.
export const looksPrePortalGlued = (po) => {
  const raw = String(po || '').trim();
  if (!raw || /\s/.test(raw)) return false;              // spaced = portal format
  if (/^D?P[O0]/i.test(raw)) return false;               // has a PO prefix → other rules own it
  return /^[0-9]{4,}[A-Z]{2,}[A-Z0-9]*$/i.test(raw);
};

// ── Line-tie ladder ─────────────────────────────────────────────────────────
// Ties ONE bill line to ONE candidate item, unambiguous-only, strongest signal first.
// Returns {idx, basis} or null. `items` are wizard-candidate items
// ({sku,name,color,size,qty(open),unit_cost,...}); qty>0 assumed (builder filters).
const tieLine = (bl, items, canon) => {
  const sku = _ns(bl.sku); const size = canon(bl.size); const color = _ns(bl.color);
  const style = _ns(bl._ss_style); const price = _num(bl.unit_price);
  const sizeOk = (it) => !size || canon(it.size) === size;
  const only = (list) => {
    const seen = new Map();
    list.forEach((x) => { const k = (x.it.item_id || _ns(x.it.sku)) + '|' + (x.it.po_id || '') + '|' + canon(x.it.size); if (!seen.has(k)) seen.set(k, x); });
    const u = [...seen.values()];
    return u.length === 1 ? u[0] : null;
  };
  const idx = items.map((it, i) => ({ it, i }));
  const tiers = [
    ['exact', idx.filter(({ it }) => sku && _ns(it.sku) === sku && sizeOk(it))],
    ['variant', idx.filter(({ it }) => { const t = _ns(it.sku); return sku.length >= 5 && t.length >= 5 && t !== sku && (sku.startsWith(t) || t.startsWith(sku) || sku.includes(t) || t.includes(sku)) && sizeOk(it); })],
    ['style', style.length >= 3 ? idx.filter(({ it }) => { const t = _ns(it.sku); return t.length >= 3 && (t === style || t.includes(style) || style.includes(t)) && sizeOk(it); }) : []],
    ['color_size', color && size ? idx.filter(({ it }) => _ns(it.color) === color && canon(it.size) === size) : []],
    ['size_price', size && price > 0 ? idx.filter(({ it }) => canon(it.size) === size && Math.abs(_num(it.unit_cost) - price) <= 0.02) : []],
    ['size_only', size ? idx.filter(({ it }) => canon(it.size) === size) : []],
  ];
  for (const [basis, list] of tiers) {
    if (!list.length) continue;
    const hit = only(list);
    if (hit) return { idx: hit.i, basis };
    // Within an ambiguous tier, a unique exact-price refinement may settle it.
    if (price > 0 && basis !== 'size_price') {
      const priced = only(list.filter(({ it }) => Math.abs(_num(it.unit_cost) - price) <= 0.02));
      if (priced) return { idx: priced.i, basis: basis + '_price' };
    }
  }
  return null;
};

// ── Proposal builder ────────────────────────────────────────────────────────
// bill:       parsed bill {items[], po_number, _po_raw, supplier}
// candidates: _buildMatchCandidates() output
// opts:       { canonSize?, currentTargetId?, maxProposals? }
// Returns proposals sorted best-first:
// { target, coverage, ties:[{bill_idx,target_idx,basis,allocated_qty,open_qty,overage}],
//   qtyMirror, tagMatch, coreDistance, priceChanges:[{sku,po_id,from,to}],
//   overageUnits, confidence:'high'|'medium'|'low', evidence:[...], score }
export const proposeResolutions = (bill, candidates, opts = {}) => {
  const canon = opts.canonSize || ((s) => String(s || '').toUpperCase().trim());
  const usable = (bill.items || []).map((bl, i) => ({ bl, i })).filter(({ bl }) => bl && _num(bl.qty) > 0);
  if (!usable.length) return [];
  const billPo = poParts(bill._po_raw || bill.po_number);
  const out = [];
  (candidates || []).forEach((cand) => {
    if (!cand || !Array.isArray(cand.items) || !cand.items.length) return;
    const used = new Set(); // an order item-size bucket absorbs ONE bill line per proposal
    const ties = [];
    usable.forEach(({ bl, i }) => {
      const avail = cand.items.map((it, ti) => ({ it, ti })).filter(({ ti }) => !used.has(ti));
      const hit = tieLine(bl, avail.map((a) => a.it), canon);
      if (!hit) return;
      const realIdx = avail[hit.idx].ti;
      used.add(realIdx);
      const open = _num(cand.items[realIdx].qty);
      ties.push({ bill_idx: i, target_idx: realIdx, basis: hit.basis, allocated_qty: _num(bl.qty), open_qty: open, overage: Math.max(0, _num(bl.qty) - open) });
    });
    if (!ties.length) return;
    const coverage = ties.length / usable.length;
    if (coverage < 0.5) return;
    const qtyMirror = ties.length > 1 && ties.every((t) => t.allocated_qty === t.open_qty);
    const candPo = poParts((cand.items[ties[0].target_idx] || {}).po_id || (cand.raw && cand.raw.po_number) || cand.label);
    const tagMatch = !!(billPo.tag && candPo.tag && billPo.tag === candPo.tag);
    const coreDistance = billPo.core && candPo.core ? editDistance(billPo.core, candPo.core) : 9;
    const strongBases = ties.filter((t) => /^(exact|variant|style)/.test(t.basis)).length;
    const overageUnits = ties.reduce((a, t) => a + t.overage, 0);
    // Price changes an accept would sync (per po_line, consistent-only mirrors the apply rule).
    const priceChanges = [];
    const byPo = {};
    ties.forEach((t) => {
      const it = cand.items[t.target_idx]; const bl = bill.items[t.bill_idx];
      const k = (it.po_id || '') + '|' + _ns(it.sku);
      (byPo[k] = byPo[k] || { sku: it.sku, po_id: it.po_id || '', order: _num(it.unit_cost), bills: new Set() }).bills.add(Math.round(_num(bl.unit_price) * 100));
    });
    Object.values(byPo).forEach((g) => {
      if (g.bills.size !== 1) return;
      const to = [...g.bills][0] / 100;
      if (to > 0 && Math.abs(to - g.order) > 0.02) priceChanges.push({ sku: g.sku, po_id: g.po_id, from: g.order, to });
    });
    const confidence =
      coverage === 1 && (qtyMirror || strongBases === ties.length || (tagMatch && coreDistance <= 1)) ? 'high'
      : coverage >= 0.7 || (coverage >= 0.5 && tagMatch) ? 'medium' : 'low';
    const evidence = [];
    evidence.push(ties.length + ' of ' + usable.length + ' bill line(s) tie to this order');
    if (qtyMirror) evidence.push('quantities mirror the order’s open amounts exactly');
    if (strongBases) evidence.push(strongBases + ' line(s) tie by SKU/style, not guesswork');
    if (tagMatch) evidence.push('the bill’s tag “' + billPo.tag + '” matches this order');
    if (coreDistance === 1) evidence.push('the PO number is one digit off (' + billPo.core + ' → ' + candPo.core + ')');
    if (coreDistance === 0 && billPo.tag !== candPo.tag) evidence.push('same PO number, different tag');
    if (overageUnits) evidence.push('⚠ ' + overageUnits + ' unit(s) exceed the order’s open quantity — accepting flags them for a corrected order');
    if (priceChanges.length) evidence.push('accepting updates ' + priceChanges.length + ' order cost(s) to the billed price (audit kept)');
    const score = coverage * 60 + (qtyMirror ? 20 : 0) + (tagMatch ? 10 : 0) + (coreDistance <= 1 ? 8 : 0) + strongBases * 2 - (overageUnits ? 4 : 0);
    out.push({ target: cand, coverage, ties, qtyMirror, tagMatch, coreDistance, priceChanges, overageUnits, confidence, evidence, score });
  });
  out.sort((a, b) => b.score - a.score);
  // Ambiguity honesty: a near-tie between two orders drops both to 'medium' at best —
  // "we're sure" and "two orders fit equally" cannot both be true.
  if (out.length >= 2 && out[0].score - out[1].score < 6) {
    if (out[0].confidence === 'high') out[0].confidence = 'medium';
    out[0].evidence.push('another order fits almost as well (' + (out[1].target.label || '') + ') — compare before accepting');
  }
  return out.slice(0, opts.maxProposals || 3);
};
