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
  if (filters.excludeScannedDocuments) p.set('excludeScannedDocuments', 'true');
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
  const warnings = [];
  if (!items.length) warnings.push('No line detail (scanned/OCR document) — size-level billed not available; verify against the PDF');
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
    vendor: '',
    tracking: String(doc.trackingNumber || '').trim(),
    merchandise_total: _siNum(doc.merchandiseTotal),
    freight: freightNet > 0 ? +freightNet.toFixed(2) : _siNum(doc.freightAmount),
    si_upcharge: +(_siNum(doc.siUpcharge) + _siNum(doc.svcHandleCharge)).toFixed(2),
    doc_total: _siNum(doc.docTotal),
    is_credit: !!doc.isCredit,
    has_lines: items.length > 0,
    carrier: String(doc.carrier || '').trim(),
    items,
    kind: 'goods',
    source: 'sportsinc',
    warnings,
    rawText: '',
  };
};
