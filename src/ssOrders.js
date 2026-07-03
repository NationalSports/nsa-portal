/* eslint-disable */
// Pure (dependency-free) helpers for the S&S Activewear V2 "Orders" API.
//
// Sibling to sportsLink.js: same idea, different source. Sports Inc delivers S&S only as
// scanned/header-only PDFs (no usable lines), so instead of waiting on that OCR we pull the
// bill straight from S&S's own structured Orders feed. The killer field is `yourSku` — S&S
// echoes OUR OWN SKU back on every line, so the bill matches our Sales Orders exactly with
// no size/color normalization. Freight, totals, and the invoice number all come through clean.
//
// Kept dependency-free (only the date/number helpers from sportsLink.js) so the
// order→bill adapter is unit-testable without the Supabase/auth stack. The networked
// caller (ssGetOrders) lives in vendorApis.js; this module only shapes data.
//
// Docs: https://api.ssactivewear.com/V2/Orders.aspx  (REST/JSON, Basic auth)

import { _siNum, _siDate, siPoOrigin } from './sportsLink';

// S&S sometimes returns camelCase and sometimes PascalCase for the same field
// (ssSubmitOrder already guards orderNumber||OrderNumber). Read defensively.
const _pick = (o, ...keys) => {
  if (!o) return undefined;
  for (const k of keys) if (o[k] != null && o[k] !== '') return o[k];
  return undefined;
};

// Build the GET /Orders endpoint (path + query) from a filters object.
// Default (no filter) → ?All=True, which S&S documents as "all orders placed in the last
// 3 months" — exactly what the manual "Pull from S&S" button wants. `lines=true` is always
// set so each order carries its per-size line detail (without it we can't fill Billed
// tracking). Optional filters: an identifier (PO/Order/Invoice #, path segment) or an
// invoice date range (invoicestartdate + invoiceenddate, both required by S&S).
export const buildSsOrdersQuery = (filter = {}) => {
  let path = '/Orders/';
  const id = filter.identifier || filter.poNumber || filter.orderNumber || filter.invoiceNumber;
  if (id) path += encodeURIComponent(String(id).trim());
  const p = new URLSearchParams();
  if (filter.startDate && filter.endDate) {
    p.set('invoicestartdate', filter.startDate);
    p.set('invoiceenddate', filter.endDate);
  } else if (filter.invoiceDate) {
    p.set('invoicedate', filter.invoiceDate);
  } else if (!id) {
    p.set('All', 'True'); // last 3 months of orders
  }
  p.set('lines', 'true');
  return `${path}?${p.toString()}`;
};

// Adapter: an S&S Orders document → the Portal's parsed-supplier-bill object.
//
// Emits the SAME shape mapSportsLinkDocToBill / parseSingleInvoice produce, so the existing
// pipeline — duplicate detection, PO matching (rematchBill), the review screen, and the
// Push-to-Portal write into Billed tracking — consumes it unchanged.
//
// Dedup keys mirror the SportsLink mapping so the two-key check in pullFromSS catches an
// order whether it was applied before or after S&S assigned its invoice number:
//   doc_number          = invoiceNumber || orderNumber   (human-facing key; what apply writes)
//   supplier_doc_number = invoiceNumber                  (the S&S invoice #)
//   si_doc_number       = orderNumber                    (stable key — never changes)
export const mapSsOrderToBill = (order) => {
  const rawLines = _pick(order, 'lines', 'Lines', 'OrderLines') || [];
  const lines = Array.isArray(rawLines) ? rawLines : [];
  const items = lines.map((ln) => {
    // Bill STRICTLY the shipped qty (NOT a qtyOrdered fallback): ?All=True returns orders
    // that haven't shipped/invoiced yet, and you're billed for what ships, not what's ordered.
    // A 0-shipped line falls out via the .filter below so a pending order doesn't get billed.
    const qty = _siNum(_pick(ln, 'qtyShipped', 'QtyShipped'));
    const unit = _siNum(_pick(ln, 'price', 'Price', 'customerPrice', 'CustomerPrice'));
    const ext = +(unit * qty).toFixed(2);
    // yourSku echoes our own SKU back → exact match against so_items.sku, no normalization.
    // Fall back to the S&S Sku for orders placed directly on ssactivewear.com (no yourSku).
    const sku = String(_pick(ln, 'yourSku', 'YourSku') || _pick(ln, 'sku', 'Sku') || '').trim();
    return {
      sku,
      upc: String(_pick(ln, 'gtin', 'Gtin') || '').trim(),
      size: String(_pick(ln, 'sizeName', 'SizeName', 'size', 'Size') || '').trim(),
      color: String(_pick(ln, 'colorName', 'ColorName', 'color', 'Color') || '').trim(),
      qty,
      unit_price: unit,
      extension: ext,
      desc: String(_pick(ln, 'title', 'Title', 'styleName', 'StyleName') || '').trim(),
    };
  }).filter((it) => it.qty > 0); // unshipped/backordered lines aren't billed — drop them

  const orderNumber = String(_pick(order, 'orderNumber', 'OrderNumber') || '').trim();
  const invoiceNumber = String(_pick(order, 'invoiceNumber', 'InvoiceNumber') || '').trim();
  const poNumber = String(_pick(order, 'poNumber', 'PoNumber', 'PONumber') || '').trim();
  const freight = _siNum(_pick(order, 'shipping', 'Shipping', 'freight', 'Freight'));
  const docTotal = _siNum(_pick(order, 'total', 'Total'));
  const merchandise = +items.reduce((a, it) => a + it.extension, 0).toFixed(2);
  // Usable = at least one shipped line with a real SKU (same rule as the SportsLink mapping).
  const hasUsableLines = items.some((it) => it.sku && it.qty > 0);
  const isCredit = docTotal < 0;

  const warnings = [];
  if (!hasUsableLines) warnings.push('No shipped line detail on this S&S order — nothing to bill yet (likely backordered or not yet shipped)');
  if (isCredit) warnings.push('Negative total (return/credit) — applies as a negative; review before pushing');

  return {
    po_number: poNumber,
    doc_number: invoiceNumber || orderNumber,
    si_doc_number: orderNumber || null,
    supplier_doc_number: invoiceNumber,
    doc_date: _siDate(_pick(order, 'invoiceDate', 'InvoiceDate', 'orderDate', 'OrderDate')),
    due_date: '',
    ship_date: _siDate(_pick(order, 'shipDate', 'ShipDate')),
    supplier: 'S&S Activewear',
    supplier_method: 'EDI',                       // structured lines — approve flow, not manual
    po_origin: siPoOrigin(poNumber),              // 'portal' | 'old' | 'unknown' (space-after-PO rule)
    source_type: hasUsableLines ? 'edi' : 'scanned',
    vendor: '',
    tracking: String(_pick(order, 'trackingNumber', 'TrackingNumber') || '').trim(),
    merchandise_total: merchandise,
    freight: freight > 0 ? +freight.toFixed(2) : 0,
    si_upcharge: 0,                               // no Sports Inc middleman on this path
    doc_total: docTotal,
    is_credit: isCredit,
    has_lines: items.length > 0,
    has_usable_lines: hasUsableLines,
    carrier: String(_pick(order, 'shipMethod', 'ShipMethod', 'carrier', 'Carrier') || '').trim(),
    items,
    kind: 'goods',
    source: 'ss_orders',
    warnings,
    rawText: '',
  };
};

// Resolve each S&S bill line to a line on the matched SO/batch, so a bill whose lines carry
// S&S's own per-size part number (e.g. "B18008335", not our style "3023CL") still maps to the
// right SO item. S&S echoes our SKU back only when CrossRef is configured in the account, so we
// can't rely on it; but colorName + sizeName always come through clean, and the PO has already
// pinned the SO — so within that SO, color + size uniquely identify the line.
//
// Tiered so an exact SKU still wins when it IS our SKU: (1) SKU + size, (2) color + size,
// (3) size alone when only one candidate has it — each with an exact-price (±$0.02) tie-break
// when the tier alone is ambiguous. Each tier only accepts an UNAMBIGUOUS hit (exactly one
// distinct target line) — anything still ambiguous returns null so the caller leaves it for
// the manual match wizard rather than guessing where money lands.
//
//   billItems:  [{ sku, size, color, qty, ... }]                          (the parsed bill lines)
//   candidates: [{ sku, size, color, so_id, item_id, po_id, unit_cost }]  (open SO/batch size buckets)
//   opts.canonSize: optional size canonicalizer (App passes _canonBillSize) so "Medium"↔"M" align
// Returns an array aligned to billItems: { cand | null, via }.
export const resolveSsBillLines = (billItems, candidates, opts = {}) => {
  const canon = opts.canonSize || ((s) => String(s || '').toUpperCase().trim());
  const nSku = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nColor = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const cands = Array.isArray(candidates) ? candidates : [];
  // Collapse candidates that point at the SAME target line (same item + po_line + size) so a
  // style split across identical buckets doesn't read as ambiguous.
  const lineKey = (c) => (c.item_id || nSku(c.sku)) + '|' + (c.po_id || '') + '|' + canon(c.size);
  const only = (list) => {
    const seen = new Map();
    list.forEach((c) => { const k = lineKey(c); if (!seen.has(k)) seen.set(k, c); });
    const u = [...seen.values()];
    return u.length === 1 ? u[0] : null;
  };
  return (billItems || []).map((li) => {
    const size = canon(li.size);
    const color = nColor(li.color);
    const sku = nSku(li.sku);
    const price = (() => { const p = parseFloat(li.unit_price); return isNaN(p) ? 0 : p; })();
    // Tie-breaker for same size+color across two styles (e.g. a batch holding a $15.44 bra
    // AND a $7.14 tee in "L Black"): the order's unit cost round-trips on API-ordered S&S
    // bills, so an exact-price hit (±$0.02) disambiguates — still unambiguous-only.
    const byPrice = (list) => price > 0 ? list.filter((c) => Math.abs((parseFloat(c.unit_cost) || 0) - price) <= 0.02) : [];
    const tiers = [
      sku ? { list: cands.filter((c) => nSku(c.sku) === sku && canon(c.size) === size), via: 'sku_size' } : null,
      color ? { list: cands.filter((c) => canon(c.size) === size && nColor(c.color) === color), via: 'color_size' } : null,
      { list: cands.filter((c) => canon(c.size) === size), via: 'size_only' },
    ].filter(Boolean);
    for (const t of tiers) {
      let hit = only(t.list);
      if (hit) return { cand: hit, via: t.via };
      hit = only(byPrice(t.list));
      if (hit) return { cand: hit, via: t.via + '_price' };
    }
    return { cand: null, via: 'none' };
  });
};
