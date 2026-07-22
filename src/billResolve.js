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
// Style token from a bill line's description: vendors billing with their OWN per-size
// catalog numbers (SanMar "2649531", S&S "B00708043") usually lead the description with
// the mfr style WE use — "64800L. GLDN Softstyle Wms Piq" → "64800L". Conservative: the
// leading token only, 3-12 chars, must contain a digit (so "YOUTH…"/"MENS…" never match).
export const descStyleToken = (desc) => {
  const m = String(desc || '').trim().toUpperCase().match(/^([A-Z0-9][A-Z0-9-]{2,11})(?=[.\s]|$)/);
  if (!m) return '';
  const tok = m[1].replace(/[^A-Z0-9]/g, '');
  return /[0-9]/.test(tok) && tok.length >= 3 ? tok : '';
};
const _num = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

// Agron (and some Sports Inc feeds) append a single LETTER suffix to the adidas article
// number: "5162436D"/"5161961C" ↔ our "5162436"/"5161961". Returns the numeric base when a
// SKU is 5+ digits followed by exactly one letter, else null. Only fires on a numeric base,
// so real alphanumeric SKUs (JX4499, R25TFM, 1390159-410, B00708043) are never stripped.
export const skuNumBase = (s) => {
  const m = String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').match(/^(\d{5,})[A-Z]$/);
  return m ? m[1] : null;
};

// ── PDF-as-reinforcement cross-check (owner, 2026-07-22: "EDI matches work
// automatically… the PDF upload just reinforces even though we don't need to see it").
// A later PDF upload of a bill EDI already pushed is a silent confirmation — normally
// there is nothing to review. It is worth surfacing ONLY when the PDF's total materially
// disagrees with what we actually applied. true → keep it visible for review; false →
// drop it silently (confirmed). Tolerance mirrors the money engine's posture: ignore
// sub-dollar and sub-2% noise so rounding never raises a false alarm. Returns false when
// either total is missing/zero — no comparison, so no alarm.
export const pdfCrossCheckConflict = (pdfTotal, appliedTotal) => {
  const p = Number(pdfTotal), a = Number(appliedTotal);
  if (!(p > 0) || !(a > 0)) return false;
  return Math.abs(p - a) > Math.max(1, a * 0.02);
};

// ── Vendor gate (owner, 2026-07-21: a Momentec bill proposed rewriting a SanMar item's
// cost by size-coincidence — "should AT LEAST match to the right company's items") ────
// Candidate items now carry the PO line's vendor. Weak tiers refuse items from a clearly
// different supplier, and an unanchored candidate whose known vendors ALL differ from the
// bill's is never proposed. Unknown/empty vendors never block (labels are inconsistent),
// and an exact-PO anchor still overrides (the ORDER is proven right; vendor strings vary).
const _V_STOP = new Set(['SPORTS', 'SPORTING', 'GOODS', 'INC', 'LLC', 'CO', 'COMPANY', 'CORP', 'BRANDS', 'USA', 'THE', 'TEAM', 'SERVICES', 'MFG', 'MANUFACTURING', 'ACTIVEWEAR', 'APPAREL']);
// Internal vendor-record ids ("v1777312659133", "ns_115") appear as po_line vendor values
// on real orders (audit 2026-07-22: 11 of 35 pushed-bill vendor pairs were these). They are
// database keys, not supplier names — comparing them to a bill's vendor string would false-
// block legitimate matches, so they count as UNKNOWN.
const _isVendorPlaceholder = (v) => /^(v\d{6,}|ns[_ ]?\d+)$/i.test(String(v || '').trim());
export const vendorsCompatible = (a, b) => {
  if (_isVendorPlaceholder(a) || _isVendorPlaceholder(b)) return true;
  const norm = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const A = norm(a), B = norm(b);
  if (!A || !B) return true; // unknown never blocks
  if (A === B || A.includes(B) || B.includes(A)) return true;
  const at = A.split(' ').filter((t) => t.length >= 4 && !_V_STOP.has(t));
  const bt = new Set(B.split(' ').filter((t) => t.length >= 4 && !_V_STOP.has(t)));
  return at.some((t) => bt.has(t));
};

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
const tieLine = (bl, items, canon, billVendor) => {
  const sku = _ns(bl.sku); const size = canon(bl.size); const color = _ns(bl.color);
  // _alias_sku: a learned vendor-number → portal-SKU mapping (bill_sku_aliases, written
  // every time a pushed bill taught us the vendor's numbering). Trusted like an exact SKU.
  const asku = _ns(bl._alias_sku);
  const style = _ns(bl._ss_style) || descStyleToken(bl.desc); const price = _num(bl.unit_price);
  const sizeOk = (it) => !size || canon(it.size) === size;
  // Weak tiers (no SKU/style evidence) refuse a target from a clearly different supplier —
  // size/price coincidences across vendors are exactly the Momentec→SanMar wrong-cost class.
  const vendOk = (it) => vendorsCompatible(billVendor, it.vendor);
  const only = (list) => {
    const seen = new Map();
    list.forEach((x) => { const k = (x.it.item_id || _ns(x.it.sku)) + '|' + (x.it.po_id || '') + '|' + canon(x.it.size); if (!seen.has(k)) seen.set(k, x); });
    const u = [...seen.values()];
    return u.length === 1 ? u[0] : null;
  };
  const idx = items.map((it, i) => ({ it, i }));
  const tiers = [
    ['exact', idx.filter(({ it }) => sku && _ns(it.sku) === sku && sizeOk(it))],
    ['alias', asku ? idx.filter(({ it }) => _ns(it.sku) === asku && sizeOk(it)) : []],
    ['variant', idx.filter(({ it }) => { const t = _ns(it.sku); return sku.length >= 5 && t.length >= 5 && t !== sku && (sku.startsWith(t) || t.startsWith(sku) || sku.includes(t) || t.includes(sku)) && sizeOk(it); })],
    ['style', style.length >= 3 ? idx.filter(({ it }) => { const t = _ns(it.sku); return t.length >= 3 && (t === style || t.includes(style) || style.includes(t)) && sizeOk(it) && (!color || !_ns(it.color) || _ns(it.color) === color); }) : []],
    ['color_size', color && size ? idx.filter(({ it }) => vendOk(it) && _ns(it.color) === color && canon(it.size) === size) : []],
    ['size_price', size && price > 0 ? idx.filter(({ it }) => vendOk(it) && canon(it.size) === size && Math.abs(_num(it.unit_cost) - price) <= 0.02) : []],
    // size_only carries a price sanity check: same size but a >50% price gap is almost
    // certainly a DIFFERENT product (a $115.50 Predator cleat is not a $41.25 Supernova
    // in the same size) — leave it for the name/PO tiers or the human instead of guessing.
    ['size_only', size ? idx.filter(({ it }) => { const oc = _num(it.unit_cost); return vendOk(it) && canon(it.size) === size && !(price > 0 && oc > 0 && (price > oc * 1.5 || price < oc * 0.5)); }) : []],
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
  // No-money lines ($0 service memos like "91-T1 Direct Embroidery · 48 @ $0.00") may
  // still tie by SKU EVIDENCE (a real item whose price just didn't parse), but they are
  // never guessed into a bucket: no bulk absorption, no PO-anchored fallback tiers —
  // rolled into a garment bucket they fabricate phantom overage (a 48-cap bill read as
  // 96-vs-16). Untied, they also don't count as "needs a match": there's nothing to pay.
  const noMoney = (bl) => _num(bl.unit_price) <= 0 && _num(bl.extension) <= 0;
  if (!usable.length) return [];
  const billPo = poParts(bill._po_raw || bill.po_number);
  const billVend = String(bill.vendor || bill.supplier || '');
  const out = [];
  (candidates || []).forEach((cand) => {
    if (!cand || !Array.isArray(cand.items) || !cand.items.length) return;
    // Exact-PO anchor decided up front: it both rescues a cross-vendor candidate (the
    // ORDER is proven right, labels vary) and drives the anchored tie tiers below.
    const poAnchored = !!(billPo.flat && cand.items.some((it) => poParts(it.po_id).flat === billPo.flat));
    // Vendor gate: an unanchored candidate whose known item vendors ALL differ from the
    // bill's supplier is never proposed — a Momentec bill must not tie SanMar lines by
    // size coincidence. Unknown vendors (either side) never block.
    const candVendors = [...new Set(cand.items.map((it) => String(it.vendor || '')).filter(Boolean))];
    const vendorCompat = !billVend || !candVendors.length || candVendors.some((v) => vendorsCompatible(billVend, v));
    if (!vendorCompat && !poAnchored) return;
    const used = new Set(); // an order item-size bucket absorbs ONE bill line per proposal
    const ties = [];
    usable.forEach(({ bl, i }) => {
      const avail = cand.items.map((it, ti) => ({ it, ti })).filter(({ ti }) => !used.has(ti));
      const hit = tieLine(bl, avail.map((a) => a.it), canon, billVend);
      if (!hit) return;
      const realIdx = avail[hit.idx].ti;
      used.add(realIdx);
      const open = _num(cand.items[realIdx].qty);
      ties.push({ bill_idx: i, target_idx: realIdx, basis: hit.basis, allocated_qty: _num(bl.qty), open_qty: open, overage: Math.max(0, _num(bl.qty) - open) });
    });
    // Bulk rollup — the "billed by size, bought in bulk" case (custom items, shoes):
    // the bill's PO matched this candidate and that PO has exactly ONE distinct open
    // line (e.g. "CUSTOM Adidas Soccer Cleats F50" with no size breakdown). A human
    // rolls every sized bill line up onto it; so do we — but ONLY under that single-
    // line anchor, so it can never guess between lines. Quantities accumulate.
    const untied = usable.filter(({ i }) => !ties.some((t) => t.bill_idx === i));
    if (untied.length && billPo.core) {
      const poBuckets = cand.items.map((it, ti) => ({ it, ti }))
        .filter(({ it }) => { const pp = poParts(it.po_id); return pp.core && pp.core === billPo.core; });
      const lineKeys = [...new Set(poBuckets.map(({ it }) => (it.item_id || _ns(it.sku)) + '|' + (it.po_id || '')))];
      if (lineKeys.length === 1 && poBuckets.length >= 1) {
        const anchor = poBuckets[0];
        untied.forEach(({ bl, i }) => {
          if (noMoney(bl)) return; // service memos never absorb into a product bucket
          ties.push({ bill_idx: i, target_idx: anchor.ti, basis: 'bulk', allocated_qty: _num(bl.qty), open_qty: _num(anchor.it.qty), overage: 0 });
        });
      }
    }
    // ── PO-anchored linking (owner rule: "if the PO numbers match up, it is incredibly
    // likely the items match even if the numbers don't") ────────────────────────────────
    // An EXACT normalized PO match settles WHICH ORDER this bill belongs to; only line
    // assignment stays open. Inside that anchor we can afford looser, still unambiguous-
    // only tiers over the PO's own buckets — worst case is a line landing on a sibling
    // line of the RIGHT order, and every tie remains human-reviewed before Accept.
    // (poAnchored computed above, before the vendor gate.)
    if (poAnchored) {
      const remainingBuckets = () => cand.items.map((it, ti) => ({ it, ti }))
        .filter(({ it, ti }) => poParts(it.po_id).flat === billPo.flat && !ties.some((t) => t.target_idx === ti && t.basis !== 'bulk'));
      const still = () => usable.filter(({ bl, i }) => !ties.some((t) => t.bill_idx === i) && !noMoney(bl));
      const tieTo = (i, bl, b2, basis) => ties.push({ bill_idx: i, target_idx: b2.ti, basis, allocated_qty: _num(bl.qty), open_qty: _num(b2.it.qty), overage: 0 });
      // NAME FIRST (production lesson: PREDATOR ELITE cleats got qty-coincidence-tied to a
      // Supernova running shoe while "Adidas Soccer Cleats F50 / Predator" sat unmatched —
      // a product-name hit is real evidence; a quantity equality is a coin flip).
      // name-token: a ≥4-char word from the bill line's description appears in exactly one
      // bucket's name. Name ties do NOT consume the bucket for FURTHER name ties — custom/
      // bulk lines legitimately absorb several sized bill lines ("billed by size, bought in
      // bulk"); the bucket-cumulative accounting below keeps the quantities honest.
      const nameBuckets = () => cand.items.map((it, ti) => ({ it, ti }))
        .filter(({ it, ti }) => poParts(it.po_id).flat === billPo.flat && !ties.some((t) => t.target_idx === ti && t.basis !== 'bulk' && t.basis !== 'po_name'));
      still().forEach(({ bl, i }) => {
        const toks = String(bl.desc || '').toUpperCase().split(/[^A-Z0-9]+/).filter((x) => x.length >= 4);
        if (!toks.length) return;
        const hits = nameBuckets().filter(({ it }) => { const nm = String(it.name || '').toUpperCase(); return toks.some((x) => nm.includes(x)); });
        if (hits.length === 1) tieTo(i, bl, hits[0], 'po_name');
      });
      // qty-unique: the line's qty equals exactly one remaining bucket's open qty.
      // qty >= 2 only — "1 billed, one bucket happens to have 1 open" is pure coincidence.
      still().forEach(({ bl, i }) => {
        if (_num(bl.qty) < 2) return;
        const hits = remainingBuckets().filter(({ it }) => _num(it.qty) === _num(bl.qty));
        if (hits.length === 1) tieTo(i, bl, hits[0], 'po_qty');
      });
      // price-unique: exactly one remaining bucket at the billed unit price
      still().forEach(({ bl, i }) => {
        const pr = _num(bl.unit_price); if (pr <= 0) return;
        const hits = remainingBuckets().filter(({ it }) => Math.abs(_num(it.unit_cost) - pr) <= 0.02);
        if (hits.length === 1) tieTo(i, bl, hits[0], 'po_price');
      });
      // pigeonhole: one line left, one bucket left → they're each other's
      const lastL = still(); const lastB = remainingBuckets();
      if (lastL.length === 1 && lastB.length === 1) tieTo(lastL[0].i, lastL[0].bl, lastB[0], 'po_last_pair');
    }
    // PO-anchored proposals ALWAYS surface — even with zero auto-ties the panel must show
    // the order and its open items for click-linking. Unanchored candidates keep the floor.
    if (!ties.length && !poAnchored) return;
    // Coverage counts PAYABLE lines: an untied no-money memo line owes nothing, so it
    // neither drags coverage nor shows up as "still needs a match".
    const payable = usable.filter(({ bl, i }) => !noMoney(bl) || ties.some((t) => t.bill_idx === i));
    const coverage = payable.length ? ties.length / payable.length : 0;
    if (coverage < 0.5 && !poAnchored) return;
    // Quantity accounting is BUCKET-CUMULATIVE (bulk ties share a bucket): overage and the
    // qty-mirror both compare each distinct bucket's summed allocation to its open qty.
    const _bk = {};
    ties.forEach((t) => { const k = t.target_idx; (_bk[k] = _bk[k] || { open: t.open_qty, alloc: 0 }).alloc += t.allocated_qty; });
    const bucketOver = Object.values(_bk).reduce((a, b) => a + Math.max(0, b.alloc - b.open), 0);
    const qtyMirror = ties.length > 1 && Object.values(_bk).every((b) => b.alloc === b.open);
    const candPo = poParts(((ties.length ? cand.items[ties[0].target_idx] : cand.items.find((it) => poParts(it.po_id).flat === billPo.flat)) || {}).po_id || (cand.raw && cand.raw.po_number) || cand.label);
    const tagMatch = !!(billPo.tag && candPo.tag && billPo.tag === candPo.tag);
    const strongBasesEarly = ties.filter((t) => /^(exact|alias|variant|style|bulk)/.test(t.basis)).length;
    // ── Negative-evidence gates (owner, 2026-07-22) ─────────────────────────────
    // TAG MISMATCH: the PO tag is the CUSTOMER (school code). A bill tagged for one
    // school weak-tying to another school's order is the wrong-school class (3132 TUH
    // → 3132 STOV). Weak-only + different tag + no PO anchor → never proposed; with
    // strong ties it survives (the mined tag-differs retarget class) but demoted below.
    const tagMismatch = !!(billPo.tag && candPo.tag && billPo.tag !== candPo.tag);
    if (tagMismatch && !poAnchored && strongBasesEarly === 0) return;
    // DATE SANITY: a bill shipped/issued before the order existed cannot be that order.
    // Only fires when both dates parse; 2-day grace absorbs timezone/entry slop.
    const _pd = (v) => { const d = new Date(String(v || '')); return isNaN(d.getTime()) ? null : d.getTime(); };
    const billDate = _pd(bill.ship_date) || _pd(bill.doc_date);
    const orderCreated = _pd(cand.raw && (cand.raw.created_at || cand.raw.created));
    const billPredatesOrder = !!(billDate && orderCreated && billDate + 2 * 86400000 < orderCreated);
    if (billPredatesOrder && !poAnchored && strongBasesEarly === 0) return;
    const coreDistance = billPo.core && candPo.core ? editDistance(billPo.core, candPo.core) : 9;
    const strongBases = ties.filter((t) => /^(exact|alias|variant|style|bulk)/.test(t.basis)).length;
    const overageUnits = bucketOver;
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
    let confidence =
      coverage === 1 && (qtyMirror || strongBases === ties.length || (tagMatch && coreDistance <= 1) || poAnchored) ? 'high'
      : poAnchored ? 'medium'
      : coverage >= 0.7 || (coverage >= 0.5 && tagMatch) ? 'medium' : 'low';
    // Negative-evidence demotions: a surviving tag-mismatch or bill-predates-order
    // proposal is never "high" — real conflicting evidence needs a human.
    if ((tagMismatch || billPredatesOrder) && confidence === 'high') confidence = 'medium';
    // Money honesty: a "sure" match that would rewrite an order cost by >25% needs eyes —
    // the right ORDER can still have the wrong LINES tied (weak-basis tie + big price gap,
    // e.g. $111.37 F50s landing on a $41.25 sibling line by size alone).
    const sharpPrice = priceChanges.some((pc) => Math.abs(pc.to - pc.from) > Math.max(0.02, 0.25 * Math.max(pc.from, 0.01)));
    if (sharpPrice && confidence === 'high') confidence = 'medium';
    // Weak-guess demotion (owner case: a $30 adidas pullover "tied" to a $3.48 tee by
    // color+size — +762% — yet offered as an acceptable Best answer). When EVERY tie rests
    // on a weak guess tier (color_size / size_only — no SKU, alias, variant, style, bulk,
    // name, qty or price anchor anywhere) AND some tied line's billed unit price is >50%
    // off the order cost (the same 1.5×/0.5× ratio the size_only tier already enforces),
    // this is a coin flip, not a match: flag it so the panel refuses one-click Accept and
    // presents it as a "nearest guess" instead. An exact-PO anchor exempts (owner rule:
    // PO match ⇒ right order; the money check still flags the price). weakGapPct is the
    // largest tied-line gap, for the panel's wording.
    const weakBasesOnly = ties.length > 0 && ties.every((t) => t.basis === 'color_size' || t.basis === 'size_only');
    let weakGapPct = 0;
    ties.forEach((t) => {
      const bl = bill.items[t.bill_idx] || {}; const it = cand.items[t.target_idx] || {};
      const bp = _num(bl.unit_price); const oc = _num(it.unit_cost);
      if (bp > 0 && oc > 0) weakGapPct = Math.max(weakGapPct, Math.abs(bp - oc) / oc * 100);
    });
    const weakGuess = weakBasesOnly && weakGapPct > 50 && !poAnchored;
    if (weakGuess) confidence = 'low';
    const evidence = [];
    if (poAnchored) evidence.push('PO number matches this order EXACTLY — near-certain this is the right order (owner rule)');
    if (!vendorCompat) evidence.push('⚠ supplier differs — bill from ' + billVend + ', order lines from ' + candVendors.join('/') + ' (kept only because the PO matches)');
    evidence.push(ties.length + ' of ' + payable.length + ' bill line(s) tie to this order' + (poAnchored && ties.length < usable.length ? ' — link the rest below' : ''));
    if (qtyMirror) evidence.push('quantities mirror the order’s open amounts exactly');
    if (strongBases) evidence.push(strongBases + ' line(s) tie by SKU/style, not guesswork');
    const aliasTies = ties.filter((t) => t.basis.startsWith('alias')).length;
    if (aliasTies) evidence.push(aliasTies + ' line(s) tie by a learned vendor-number alias (from your past accepts)');
    if (sharpPrice) evidence.push('billed price differs sharply from the order cost — confirm the tied lines before accepting');
    if (tagMatch) evidence.push('the bill’s tag “' + billPo.tag + '” matches this order');
    if (coreDistance === 1) evidence.push('the PO number is one digit off (' + billPo.core + ' → ' + candPo.core + ')');
    if (coreDistance === 0 && billPo.tag !== candPo.tag) evidence.push('same PO number, different tag');
    if (tagMismatch) evidence.push('⚠ the bill’s tag “' + billPo.tag + '” names a DIFFERENT customer than this order (“' + candPo.tag + '”) — confirm the school before accepting');
    if (billPredatesOrder) evidence.push('⚠ the bill is dated before this order was created — it may belong to an earlier order');
    const bulkTies = ties.filter((t) => t.basis === 'bulk').length;
    if (bulkTies) evidence.push(bulkTies + ' sized bill line(s) roll up to the PO’s single bulk line — bought in bulk, billed by size');
    if (overageUnits) evidence.push('⚠ ' + overageUnits + ' unit(s) exceed the order’s open quantity — accept to approve them; push then corrects the order (audit kept)');
    if (priceChanges.length) evidence.push('accepting updates ' + priceChanges.length + ' order cost(s) to the billed price (audit kept)');
    if (weakGuess) evidence.push('every tie is a color/size-only guess and the billed price is ' + Math.round(weakGapPct) + '% off the order cost — treat this as a hint, not a match');
    const score = coverage * 60 + (poAnchored ? 30 : 0) + (qtyMirror ? 20 : 0) + (tagMatch ? 10 : 0) + (coreDistance <= 1 ? 8 : 0) + strongBases * 2 - (overageUnits ? 4 : 0);
    const unresolved = payable.filter(({ i }) => !ties.some((t) => t.bill_idx === i)).map(({ i }) => i);
    out.push({ target: cand, coverage, ties, unresolved, poAnchored, qtyMirror, tagMatch, coreDistance, priceChanges, overageUnits, weakGuess, weakGapPct, confidence, evidence, score });
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

// ── Auto-accept gate ─────────────────────────────────────────────────────────
// The class the owner named ("PO matches and the cost matches perfectly — go to match
// automatically"): true only when NOTHING is left to judge. Exact-PO anchor, every bill
// line tied, no ambiguity demotion (confidence stayed high), no overage, no price sync,
// and every tie's billed unit price equals the order's cost within 2¢. Push — the actual
// money write — stays a human action; this only stages what Accept would stage.
// Wider gate (owner, 2026-07-21: "widen to full high-confidence"): exact-PO anchor,
// every payable line tied, nothing unresolved, no overage — but price changes are
// ALLOWED (they sync onto the order with audit, and a >25% gap already demoted
// confidence to medium upstream, so nothing "sharp" can pass). This is what stages
// ⚡ auto-match AND qualifies for auto-push; the daily anomaly email + resolution
// flags are the after-the-fact review net.
// ── Direct-path auto-push safety (Fable audit, 2026-07-22) ───────────────────
// The staged/proposal route is price- and vendor-gated (sharpPrice demotion + vendor
// gate above), but a bill that PO-matches at PARSE time auto-pushes through
// _validateBillForPush, which checks neither price nor vendor — and at $0 freight its
// auto-mappings can silently REWRITE order unit_cost with no cap (App.js priceSync).
// Audit found a reachable, unguarded path (47 auto-pushes in prod; worst mapping gap
// +103%, though no >25% cost REWRITE had fired yet). This gate closes it for the
// UNATTENDED path only — the human push button keeps today's behavior (the money-check
// UI is their gate, and intentional price syncs are a feature).
// Returns [] when safe, else dedup'd blocker reasons.
export const autoPushSafety = ({ poExact, pricePairs, billVendor, targetVendors, docTotal }) => {
  const reasons = new Set();
  // Only an EXACT normalized PO match may push unattended. Parse-time matching also
  // accepts prefix and memo-substring hits (first-match-wins, no _core_match flag) —
  // fine for staging a human review, not for an unattended money write.
  if (!poExact) reasons.add('PO match is not exact (prefix/memo) — needs a person');
  // Credit-shaped totals: PDF-parsed bills never set is_credit, so the is_credit
  // filter alone can't be trusted. A negative total is credit-like regardless of source.
  if (_num(docTotal) < 0) reasons.add('negative document total (credit-like) — needs a person');
  // Mirror of the staged path's sharpPrice rule: any line billed >25% off the order's
  // cost (or >2¢ where the order has no cost — an unattended first-cost write) waits.
  (pricePairs || []).forEach((m) => {
    const bu = _num(m && m.bill_unit); const oc = _num(m && m.unit_cost);
    if (bu > 0 && Math.abs(bu - oc) > Math.max(0.02, 0.25 * Math.max(oc, 0.01))) {
      reasons.add('billed price differs sharply from the order cost (' + oc.toFixed(2) + ' → ' + bu.toFixed(2) + ')');
    }
  });
  // Vendor gate for the direct path (the staged path already has one). Placeholder
  // vendor ids count as unknown via vendorsCompatible.
  const tv = (targetVendors || []).filter(Boolean);
  if (billVendor && tv.length && !tv.some((v) => vendorsCompatible(billVendor, v))) {
    reasons.add('supplier differs — bill from ' + billVendor + ', order lines from ' + tv.join('/'));
  }
  return [...reasons];
};

export const highConfidenceAutoAccept = (prop) => {
  if (!prop || prop.weakGuess || prop.confidence !== 'high' || !prop.poAnchored) return false;
  if (!(prop.ties || []).length || (prop.unresolved || []).length) return false;
  if (prop.coverage < 1 || prop.overageUnits) return false;
  return true;
};

export const cleanAutoAccept = (prop, billItems) => {
  if (!prop || prop.weakGuess || prop.confidence !== 'high' || !prop.poAnchored) return false;
  if (!(prop.ties || []).length || (prop.unresolved || []).length) return false;
  if (prop.coverage < 1 || prop.overageUnits) return false;
  if ((prop.priceChanges || []).length) return false;
  return prop.ties.every((t) => {
    const bl = (billItems || [])[t.bill_idx] || {};
    const it = ((prop.target || {}).items || [])[t.target_idx] || {};
    const bp = _num(bl.unit_price); const oc = _num(it.unit_cost);
    return bp > 0 && Math.abs(bp - oc) <= 0.02;
  });
};
