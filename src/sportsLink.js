// Pure (dependency-free) helpers for the Sports Inc "SportsLink" dealer API.
//
// Kept separate from vendorApis.js so the document→bill adapter is unit-testable
// without pulling in the Supabase/auth stack. The networked callers live in
// vendorApis.js (sportsLinkGetDocuments / sportsLinkSetStatus); this module only
// shapes data.
//
// Docs: https://api.sportsinc.com/  (REST/JSON, auth via X-API-KEY header)

export const _siNum = (v) => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

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
    si_upcharge: +(_siNum(doc.siUpcharge) + _siNum(doc.svcHandleCharge)).toFixed(2),
    doc_total: _siNum(doc.docTotal),
    is_credit: !!doc.isCredit,
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
