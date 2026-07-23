// Pure (dependency-free) helpers for the Sports Inc "SportsLink" dealer API.
//
// Kept separate from vendorApis.js so the document→bill adapter is unit-testable
// without pulling in the Supabase/auth stack. The networked callers live in
// vendorApis.js (sportsLinkGetDocuments / sportsLinkSetStatus); this module only
// shapes data.
//
// Docs: https://api.sportsinc.com/  (REST/JSON, auth via X-API-KEY header)

// Tolerates formatted currency strings ("$1,234.56", "(100.50)" = negative) — a raw
// parseFloat silently zeroed those, an under-billing path.
export const _siNum = (v) => {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v == null ? '' : v).trim();
  const neg = /^\(.*\)$/.test(s);
  const n = parseFloat(s.replace(/[($,)\s]/g, ''));
  return isNaN(n) ? 0 : (neg ? -n : n);
};

// Format an API datetime to the MM/DD/YYYY the PDF parser emits. We take the literal
// Y-M-D off the front of the ISO string rather than constructing a Date, so a
// UTC-midnight value never shifts a day in a western timezone.
export const _siDate = (iso) => {
  if (!iso) return '';
  const s = String(iso);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
};

// The suppliers Sports Inc delivers to us over EDI — real, structured line items we
// can auto-bill. Everything else is OCR-scanned: the API returns only header totals
// (no usable lines) and never the PDF, so those are handled manually. Source: National
// Sports' "Athletic Suppliers" EDI/OCR list. Names are normalized (uppercase, alnum +
// single spaces) before lookup so the API's free-text `supplier` field matches
// regardless of punctuation/casing. (Mike's Test Store is on the sheet but omitted — a
// test account.)
export const SI_EDI_SUPPLIERS = new Set([
  'AGRON INC', 'ALL STAR SPTG GOODS PRODUCTS', 'ASICS AMERICA CORPORATION',
  'AUGUSTA SPORTSWEAR ASI', 'BADGER SPORTSWEAR', 'BADGER FOR UNDER ARMOUR', 'BOWNET',
  'CHAMPION SPORTS', 'MIKEN', 'MIZUNO USA INC', 'MUELLER SPORTS MEDICINE INC',
  'OUTDOOR CAP CO INC A', 'POWERS MANUFACTURING CO', 'POWERS MANUFACTURING UA',
  'RAWLINGS SPORTING GOODS CO INC', 'RICHARDSON CAP CO', 'SANMAR', 'SCHUTT SPORTS',
  'ADIDAS US TEAM SERVICES', 'TWIN CITY KNITTING CO', 'WILSON SPORTING GOODS CO',
]);

export const _siSupplierKey = (name) => String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// 'EDI' | 'OCR' — the supplier's expected delivery method per the National Sports list.
// Unknown suppliers default to 'OCR' (treat as manual until a real line comes through).
export const siSupplierMethod = (name) => (SI_EDI_SUPPLIERS.has(_siSupplierKey(name)) ? 'EDI' : 'OCR');

// ── PO matching (Sports Inc bills) ───────────────────────────────────────────
// Sports Inc PO strings are free-text: a numeric core plus a customer alpha tag and
// noise — "PO 3332 CIVB", "DPO 3239 TLL", "NSA 4519", "PO8635EXPRESSMM", "3177 OLUSPL".
// The alpha tag is the customer's alpha_tag (CIVB → Civica HS Basketball), so decoding
// core + tags lets the matcher triangulate a portal PO on several signals — robust to
// the typo'd/blank PO numbers salespeople leave. The bill is presumed source of truth,
// so a strong customer + supplier + line match wins even when the PO number is off.

// PO prefixes / common noise that are never a customer alpha tag.
const _SI_PO_STOPWORDS = new Set(['PO', 'DPO', 'NSA', 'REP', 'EXP', 'EXPRESS', 'RUSH', 'RE', 'REORDER', 'SO', 'MM']);

export const parseSiPoString = (poNumber) => {
  const raw = String(poNumber || '').trim();
  const upper = raw.toUpperCase();
  const coreMatch = upper.match(/\d{3,6}/);           // the actual PO number
  const core = coreMatch ? coreMatch[0] : '';
  const tokens = upper.replace(/\d+/g, ' ').split(/[^A-Z]+/).filter(Boolean);
  const tags = tokens.filter((t) => t.length >= 2 && !_SI_PO_STOPWORDS.has(t));
  return { raw, core, tags };
};

// Portal vs. old-system discriminator. Every portal PO puts a SPACE after the "PO"
// prefix ("PO 3545"); the legacy NetSuite system runs them together ("PO3454"). A
// no-space PO is therefore pre-portal — it belongs in NetSuite → QuickBooks, not the
// portal Billed tracking. Verified against live data: "PO + space" bills hit a portal
// PO 97% of the time, while "PO no-space" only collide coincidentally (a different
// customer's PO #), so we route those straight to Outside-of-Portal and never try to
// apply them. Returns 'portal' | 'old' | 'unknown' (non-PO-prefixed → let the matcher decide).
export const siPoOrigin = (poNumber) => {
  const raw = String(poNumber || '').trim();
  if (/^D?PO\s+\d/i.test(raw)) return 'portal';
  if (/^D?PO\d/i.test(raw)) return 'old';
  return 'unknown';
};

const _skuKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Score a bill against one portal PO candidate. Higher = better.
// candidate: { po_id, po_core, vendor, customer_alpha_tag, customer_name, skus:[], so_id }
// Returns { score, confidence, method, reasons:[] }.
export const scoreSiPoMatch = (parsedBill, candidate) => {
  const reasons = [];
  let score = 0;
  const { core, tags } = parseSiPoString(parsedBill.po_number);
  const candCore = String(candidate.po_core || '').replace(/\D/g, '');
  const coreHit = !!(core && candCore && core === candCore);
  if (coreHit) { score += 50; reasons.push('PO #' + core); }

  const candTag = _skuKey(candidate.customer_alpha_tag);
  const tagHit = !!(candTag && tags.some((t) => _skuKey(t) === candTag));
  if (tagHit) { score += 35; reasons.push('customer ' + candTag); }

  const supKey = _siSupplierKey(parsedBill.supplier);
  const venKey = _siSupplierKey(candidate.vendor);
  if (supKey && venKey && (supKey === venKey || supKey.includes(venKey) || venKey.includes(supKey))) {
    score += 15; reasons.push('supplier');
  }

  const candSkus = new Set((candidate.skus || []).map(_skuKey).filter(Boolean));
  const billSkus = [...new Set((parsedBill.items || []).map((it) => _skuKey(it.sku)).filter(Boolean))];
  let skuHits = 0;
  if (candSkus.size && billSkus.length) {
    skuHits = billSkus.filter((s) => candSkus.has(s)).length;
    if (skuHits) { score += Math.min(30, skuHits * 10); reasons.push(skuHits + ' SKU' + (skuHits > 1 ? 's' : '')); }
  }

  let confidence = 'none';
  if (score >= 70) confidence = 'high';
  else if (score >= 45) confidence = 'medium';
  else if (score > 0) confidence = 'low';
  const method = coreHit ? 'po_core' : tagHit ? 'alpha_tag' : skuHits ? 'lines' : 'none';
  return { score, confidence, method, reasons };
};

// Auto-push PO confirmation (owner 2026-07-23). The auto-push gate requires the bill's PO to
// match the order it tied to. Reps write that PO sloppily — "PO.3182.LAF", "3094 CLHSSP"
// (no prefix), "3126 GC 3119 SE" (extra tokens) — so a strict string compare rejects certain
// matches and they sit waiting for a manual push. This confirms a match when the numeric CORE
// is identical AND a customer TAG is shared: two independent signals agreeing (the PO number
// and the customer), which uniquely identifies the order. It only WIDENS the gate — the
// price-within-25%, vendor-compatible, and full high-confidence checks all still run alongside.
// Requires a tag on both sides, so a tag-less "PO 3323 REP" never core-only-matches a different
// customer's PO 3323.
export const poCoreTagMatch = (billPo, orderPo) => {
  const a = parseSiPoString(billPo), b = parseSiPoString(orderPo);
  if (!a.core || a.core !== b.core) return false;
  if (!a.tags.length || !b.tags.length) return false;
  const bset = new Set(b.tags);
  return a.tags.some((t) => bset.has(t));
};

// Rank portal PO candidates for a bill, best first (only positive-scoring ones).
export const rankSiPoCandidates = (parsedBill, candidates) =>
  (candidates || [])
    .map((c) => ({ candidate: c, ...scoreSiPoMatch(parsedBill, c) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);

// Build the dealers/documents query string from a filters object. `lines` defaults
// to true so EDI documents bring their per-size line items (scanned/OCR documents
// carry none — see has_lines on the mapped bill).
export const buildSportsLinkDocsQuery = (filters = {}) => {
  const p = new URLSearchParams();
  if (filters.active) p.set('active', 'true');
  if (filters.lines !== false) p.set('lines', 'true');
  if (filters.poNumber) p.set('poNumber', filters.poNumber);
  if (filters.siDocNumber) p.set('siDocNumber', String(filters.siDocNumber));
  if (filters.supplierDocNumber) p.set('supplierDocNumber', filters.supplierDocNumber);
  if (filters.siDocStartDate) p.set('siDocStartDate', filters.siDocStartDate);
  if (filters.siDocEndDate) p.set('siDocEndDate', filters.siDocEndDate);
  if (filters.supplierDocStartDate) p.set('supplierDocStartDate', filters.supplierDocStartDate);
  if (filters.supplierDocEndDate) p.set('supplierDocEndDate', filters.supplierDocEndDate);
  if (filters.orderBy) p.set('orderBy', filters.orderBy);
  if (filters.orderByDescending) p.set('orderByDescending', 'true');
  return p;
};

// Document-level dealer discount (owner report 2026-07-22). Sports Inc applies vendor
// dealer discounts — Agron's blanket 25% off list is the loud case — as a DOCUMENT
// adjustment, not a line one: every line carries LIST price (netPrice === listPrice ===
// list), and only merchandiseTotal reflects the discount. So sum(line extensions) is the
// GROSS and our true per-line COST is list × (merchandiseTotal / grossExtensions).
// Example (real bill 100984970): 8 × Stadium 4 Backpack @ 32.50 list = 260 gross, but
// merchandiseTotal 195 → factor 0.75 → true cost 24.375/ea. Without this, every Agron
// line reads as a phantom +33% price gap: it won't tie (price tiers want ±2¢), the
// auto-push safety gate holds it, and if pushed priceSync overwrites our correct net cost
// with the inflated list. Derived from the bill's OWN numbers, so it self-corrects for
// any discount vendor, not just Agron. Returns 1 (no adjustment) unless a real, sane
// document discount is present.
export const siDiscountFactor = (grossExt, merchTotal) => {
  const g = _siNum(grossExt), m = _siNum(merchTotal);
  if (g <= 0 || m <= 0 || m >= g - 0.01) return 1;         // no document-level discount
  const f = m / g;
  return f >= 0.5 && f < 1 ? Math.round(f * 1e6) / 1e6 : 1; // sane band; else leave list (bill just flags for review)
};

// Push a document-level dealer discount down onto line costs — the ONE implementation,
// shared by the EDI adapter (mapSportsLinkDocToBill) and the PDF-parse path so the line
// rewrite (_list_unit preservation, rounding, _doc_discount_pct) never drifts between
// them. Mutates items in place when a discount is present; no-op (factor 1) when
// gross ≈ net. Returns { discFactor, docDiscountPct }.
export const applySiDocumentDiscount = (items, merchandiseTotal) => {
  const grossExt = (items || []).reduce((a, it) => a + _siNum(it && it.extension), 0);
  const discFactor = siDiscountFactor(grossExt, merchandiseTotal);
  const docDiscountPct = discFactor !== 1 ? Math.round((1 - discFactor) * 1000) / 10 : 0;
  if (discFactor !== 1) {
    items.forEach((it) => {
      it._list_unit = it.unit_price;
      it._list_extension = it.extension;
      it.unit_price = Math.round(it.unit_price * discFactor * 100) / 100;
      it.extension = Math.round(it.extension * discFactor * 100) / 100;
    });
  }
  return { discFactor, docDiscountPct };
};

// SI service upcharge (owner, 2026-07-22: "0.008 of the subtotal excluding shipping —
// all Sports Inc invoices"). Verified against 1,000+ live si_documents: the charge is
// 0.8% of the GROSS (pre-dealer-discount) merchandise subtotal, no flat minimum — which
// is why discounted vendors (Agron) read ~1.03% of NET while UA/Rawlings/A4 sit at
// 0.80% on the nose. Used as a FILL when a Sports Inc bill is missing the printed
// upcharge (PDF/vision parses); never overwrites a printed or EDI-supplied value —
// the invoice of record wins.
export const siExpectedUpcharge = (grossMerch) => {
  const g = _siNum(grossMerch);
  return g > 0 ? Math.round(g * 0.008 * 100) / 100 : 0;
};

// Early-pay freight waiver (owner, 2026-07-22): Rawlings and TCK sometimes waive
// shipping if the bill is paid on/before an early date printed on it. Rare. This
// DETECTS the situation — waiver-capable supplier, real freight, an early-pay signal
// in the document text — and returns it for a human decision; it never waives on its
// own (payment timing lives outside the portal).
const _SI_WAIVER_SUPPLIERS = new Set(['RAWLINGS SPORTING GOODS CO INC', 'TWIN CITY KNITTING CO']);
export const earlyPayFreightWaiver = (bill) => {
  if (!bill) return { eligible: false };
  const supKey = _siSupplierKey(bill.supplier || bill.vendor);
  const waiverSupplier = [..._SI_WAIVER_SUPPLIERS].some((s) => supKey === s || (supKey && (s.includes(supKey) || supKey.includes(s))));
  const freightAmount = _siNum(bill.freight);
  if (!waiverSupplier || freightAmount <= 0) return { eligible: false };
  const text = String(bill.rawText || '');
  const m = text.match(/(?:DISCOUNT\s+DATE|FREIGHT\s+ALLOW\w*|TERMS\s+DISCOUNT)[^\d]{0,40}(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
  // EDI docs carry no rawText; a freightAllowance field on the raw doc is the same signal.
  const ediSignal = _siNum(bill._freight_allowance) > 0;
  if (!m && !ediSignal) return { eligible: false };
  return { eligible: true, payByDate: m ? m[1] : '', freightAmount };
};

// Adapter: a SportsLink document → the Portal's parsed-supplier-bill object.
//
// Emits the exact shape App.js's parseSingleInvoice() produces, so the existing
// pipeline — duplicate detection, PO matching (rematchBill), the review screen, the
// AI size/SKU reconcile pass, and the Push-to-Portal write into the Billed tracking
// (so_item_po_lines.billed / _bill_cost / _bill_details) — consumes it unchanged.
export const mapSportsLinkDocToBill = (doc) => {
  const lines = Array.isArray(doc?.lines) ? doc.lines : [];
  const items = lines.map((ln) => {
    const qty = _siNum(ln.quantityShipped) || _siNum(ln.quantityOrdered) || 0;
    const unit = _siNum(ln.netPrice) || _siNum(ln.listPrice) || 0;
    const ext = _siNum(ln.extension) || +(unit * qty).toFixed(2);
    return {
      sku: String(ln.supplierItemNumber || '').trim(),
      upc: String(ln.upc || '').trim(),
      size: String(ln.size || '').trim(),
      color: String(ln.color || '').trim(),
      qty,
      unit_price: unit,
      extension: ext,
      desc: String(ln.description || '').trim(),
    };
  });
  // Push the document-level dealer discount down onto the line costs so each unit_price
  // equals our true net cost (see siDiscountFactor / applySiDocumentDiscount — shared
  // with the PDF-parse path). merchandise_total already carries the net.
  const { docDiscountPct } = applySiDocumentDiscount(items, doc?.merchandiseTotal);
  // Net inbound freight = freight charge less any freight allowance.
  const freightNet = _siNum(doc.freightAmount) - _siNum(doc.freightAllowance);
  // doc_number is the dedup key against bills already on the Portal. We mirror the value
  // the PDF parser stored (the supplier's invoice number) so the PDF→API cutover never
  // re-bills an invoice. siDocNumber is kept separately as SI's stable document key.
  const supplierDocNumber = String(doc.supplierDocNumber || '').trim();
  const supplierMethod = siSupplierMethod(doc.supplier); // 'EDI' | 'OCR' — expected, from the list
  // "Usable" = at least one line with a real SKU and a shipped qty. This (not the supplier
  // list) is what actually routes the doc, so a supplier that starts sending real EDI lines
  // — e.g. S&S Activewear when it flips on — auto-promotes to the approve flow with no code
  // change. Scanned/OCR docs come through with a single zero-qty "SEE VENDOR INVOICE FOR
  // DETAIL" placeholder that can't fill the Billed tracking, so they go to the manual worklist.
  const hasUsableLines = items.some((it) => it.sku && it.qty > 0);
  const warnings = [];
  if (!hasUsableLines) warnings.push('No usable line detail (OCR/scanned) — grab the PDF from Sports Inc and run it through the parser');
  if (supplierMethod === 'EDI' && !hasUsableLines && !doc.isCredit) warnings.push('Expected an EDI supplier but no line detail came through — verify in the SI Invoice Center');
  if (doc.isCredit) warnings.push('Credit memo (isCredit) — applies as a negative; review before pushing');
  return {
    po_number: String(doc.poNumber || '').trim(),
    doc_number: supplierDocNumber || String(doc.siDocNumber || ''),
    si_doc_number: doc.siDocNumber || null,
    supplier_doc_number: supplierDocNumber,
    doc_date: _siDate(doc.supplierDocDate || doc.siDocDate),
    due_date: _siDate(doc.dueDate),
    ship_date: _siDate(doc.shipDate),
    supplier: String(doc.supplier || '').trim(),
    supplier_method: supplierMethod,                  // 'EDI' | 'OCR' — expected method (context/flagging)
    po_origin: siPoOrigin(doc.poNumber),              // 'portal' | 'old' | 'unknown' (space-after-PO rule)
    source_type: hasUsableLines ? 'edi' : 'scanned',  // actual route: approve-flow vs manual worklist
    vendor: '',
    tracking: String(doc.trackingNumber || '').trim(),
    merchandise_total: _siNum(doc.merchandiseTotal),
    freight: freightNet > 0 ? +freightNet.toFixed(2) : _siNum(doc.freightAmount),
    _freight_allowance: _siNum(doc.freightAllowance), // early-pay waiver signal (earlyPayFreightWaiver)
    si_upcharge: +(_siNum(doc.siUpcharge) + _siNum(doc.svcHandleCharge)).toFixed(2),
    doc_total: _siNum(doc.docTotal),
    is_credit: !!doc.isCredit,
    _doc_discount_pct: docDiscountPct,                // >0 when a dealer discount was pushed onto line costs (Agron 25% etc.)
    has_lines: items.length > 0,
    has_usable_lines: hasUsableLines,
    carrier: String(doc.carrier || '').trim(),
    items,
    kind: 'goods',
    source: 'sportsinc',
    warnings,
    rawText: '',
  };
};
