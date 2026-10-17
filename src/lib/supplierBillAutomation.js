import { mapSsOrderToBill } from '../ssOrders';
import { mapSportsLinkDocToBill, siPoOrigin } from '../sportsLink';
import { normalizeVendorName } from '../qbAccountMappings';

const text = value => String(value == null ? '' : value).trim();
const norm = value => text(value).toLowerCase();
const token = value => text(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const money = value => Math.round((Number(value) || 0) * 100) / 100;

export const supplierBillKey = bill => {
  const row = bill || {};
  const doc = norm(row.doc_number);
  const sourceDoc = norm(row.si_doc_number);
  if (!doc && !sourceDoc) return '';
  const vendor = normalizeVendorName(row.vendor || row.supplier) || 'unknown-vendor';
  return `${row.is_credit ? 'credit' : 'invoice'}|vendor:${vendor}|${doc ? `doc:${doc}` : `source:${sourceDoc}`}`;
};

export const supplierBillCoordinationKey = bill => {
  const row = bill || {};
  const doc = norm(row.doc_number);
  const sourceDoc = norm(row.si_doc_number);
  if (!doc && !sourceDoc) return '';
  return `${row.is_credit ? 'credit' : 'invoice'}|${doc ? `doc:${doc}` : `source:${sourceDoc}`}`;
};

const hash32 = (value, seed) => {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
    hash ^= hash >>> 13;
  }
  return hash.toString(16).padStart(8, '0');
};

// Intuit requestid is capped at 50 chars. Four independently-seeded 32-bit
// hashes give browser and server the same compact identity without Node-only
// crypto, so a lost browser response and a cron retry replay one QBO create.
export const qboSupplierBillRequestId = (realmId, bill) => {
  const source = `${text(realmId)}|${supplierBillKey(bill)}`;
  if (!supplierBillKey(bill)) throw new Error('Bill has no stable QBO request identity.');
  const digest = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map(seed => hash32(source, seed)).join('');
  return `NSA-bill-${digest}`;
};

export const mapQueuedSupplierBill = (source, row) => {
  if (source === 'ss_orders') return mapSsOrderToBill(row?.raw || row || {});
  if (source === 'sportsinc') return mapSportsLinkDocToBill(row?.raw || row || {});
  throw new Error(`Unknown supplier bill source: ${source}`);
};

export const canonicalBillSize = value => {
  let size = text(value).toUpperCase();
  const aliases = { OSFM: 'OSFA', 'O/S': 'OSFA', ONE: 'OSFA', MED: 'M', MEDIUM: 'M', SM: 'S', SMALL: 'S', LG: 'L', LARGE: 'L', XXL: '2XL', XXXL: '3XL' };
  if (aliases[size]) return aliases[size];
  const half = size.match(/^(\d{1,2})\s*(?:[-–]|½|1\/2)$/);
  if (half) return `${half[1]}.5`;
  return size.replace('/', '-');
};

const poKey = value => token(value).replace(/^D?PO/, '');
const lineMeta = row => row?.sizes && typeof row.sizes === 'object' ? row.sizes : {};
const orderedQty = (row, size) => Number(lineMeta(row)[size]) || 0;
const billedQty = (row, size) => Number(row?.billed?.[size]) || 0;
const lineUnitCost = row => Number(lineMeta(row).unit_cost) || 0;

const candidateSize = (row, rawSize) => {
  const wanted = canonicalBillSize(rawSize);
  const keys = Object.keys(lineMeta(row)).filter(key => typeof lineMeta(row)[key] === 'number' && !key.startsWith('_') && key !== 'unit_cost');
  const hits = keys.filter(key => canonicalBillSize(key) === wanted);
  return hits.length === 1 ? hits[0] : '';
};

const hold = (bill, code, reason) => ({ action: 'review', code, reason, bill, mappings: [] });

// The server intentionally automates a narrower class than the browser:
// one exact PO, one SO, exact SKU/size/color, unchanged unit cost, no overage.
// Anything less certain is persisted for human review.
export const planSupplierBill = (bill, candidates = []) => {
  if (!bill) return hold(bill, 'invalid_bill', 'The queued supplier document could not be parsed.');
  if (!supplierBillKey(bill)) return hold(bill, 'missing_identity', 'The supplier document has no stable document number.');
  if (bill.is_credit) return hold(bill, 'credit_requires_review', 'Credit memos require a reviewed reversal.');
  if (!bill.has_usable_lines || !(bill.items || []).some(item => Number(item?.qty) > 0 && text(item?.sku))) {
    return hold(bill, 'missing_lines', 'No usable shipped line detail is available.');
  }
  if (siPoOrigin(bill.po_number) === 'old') return hold(bill, 'outside_portal', 'The PO belongs to the pre-portal accounting flow.');
  if (!text(bill.po_number)) return hold(bill, 'missing_po', 'The supplier document has no PO number.');

  const exact = (candidates || []).filter(row => poKey(row.po_id) && poKey(row.po_id) === poKey(bill.po_number));
  const owners = new Set(exact.map(row => JSON.stringify([String(row.so_id), norm(row.po_id)])));
  if (owners.size !== 1) {
    return hold(bill, owners.size ? 'ambiguous_po' : 'po_not_found', owners.size ? 'More than one portal order owns this PO number.' : 'No exact portal PO match was found.');
  }
  const [owner] = owners;
  const [soId, ownerPo] = JSON.parse(owner);
  const targetRows = exact.filter(row => String(row.so_id) === soId && norm(row.po_id) === ownerPo);
  const billVendor = text(bill.vendor || bill.supplier);
  const targetVendors = [...new Set(targetRows.map(row => text(row.vendor)).filter(Boolean))];
  const billVendorKey = normalizeVendorName(billVendor);
  if (!billVendorKey || !targetVendors.length ||
      targetVendors.some(vendor => normalizeVendorName(vendor) !== billVendorKey)) {
    return hold(bill, 'vendor_unverified', 'The supplier does not exactly agree with the saved PO vendor.');
  }
  const mappings = [];

  for (let billIndex = 0; billIndex < (bill.items || []).length; billIndex += 1) {
    const item = bill.items[billIndex];
    const qty = Number(item?.qty) || 0;
    if (qty <= 0) continue;
    const sku = token(item.sku);
    if (!sku) return hold(bill, 'missing_sku', `Bill line ${billIndex + 1} has no SKU.`);
    let hits = targetRows.map(row => ({ row, size: candidateSize(row, item.size) }))
      .filter(hit => hit.size && token(hit.row.sku) === sku);
    const color = token(item.color);
    if (!color) return hold(bill, 'color_unverified', `Bill line ${billIndex + 1} has no color for unattended matching.`);
    const colorHits = hits.filter(hit => token(hit.row.color) === color && token(hit.row.color));
    if (!colorHits.length) return hold(bill, 'color_mismatch', `Bill line ${billIndex + 1} color does not match the saved PO line.`);
    hits = colorHits;
    if (hits.length !== 1) {
      return hold(bill, hits.length ? 'ambiguous_line' : 'line_not_found', `Bill line ${billIndex + 1} (${text(item.sku)} ${text(item.size)}) does not have one exact order-line match.`);
    }
    const { row, size } = hits[0];
    const duplicate = (lineMeta(row)._bill_details || []).some(detail =>
      norm(detail?.doc) === norm(bill.doc_number)
    );
    const unit = Number(item.unit_price) || (Number(item.extension) || 0) / qty;
    const extension = Number(item.extension) || 0;
    const expectedUnit = lineUnitCost(row);
    if (!(unit > 0) || !(expectedUnit > 0) || Math.abs(unit - expectedUnit) > 0.02) {
      return hold(bill, 'price_changed', `Bill line ${billIndex + 1} price does not exactly match the saved PO cost.`);
    }
    if (!(extension > 0) || Math.abs(extension - qty * unit) > 0.02) {
      return hold(bill, 'extension_mismatch', `Bill line ${billIndex + 1} extension does not equal quantity × unit price.`);
    }
    const ordered = orderedQty(row, size);
    const billed = billedQty(row, size);
    if (!duplicate && billed + qty > ordered) {
      return hold(bill, 'over_billed', `Bill line ${billIndex + 1} would bill ${billed + qty} against ${ordered} ordered.`);
    }
    mappings.push({
      bill_idx: billIndex,
      po_line_id: Number(row.id),
      so_id: String(row.so_id),
      po_id: row.po_id,
      sku: row.sku,
      size,
      qty,
      expected_ordered: ordered,
      expected_billed: billed,
      expected_unit_cost: money(expectedUnit),
      bill_unit: money(unit),
      bill_cost: money(extension),
      _already_applied: duplicate,
    });
  }
  if (!mappings.length) return hold(bill, 'nothing_to_apply', 'No positive bill lines can be applied.');
  const duplicateMappings = mappings.filter(row => row._already_applied).length;
  if (duplicateMappings > 0 && duplicateMappings < mappings.length) {
    return hold(bill, 'partial_prior_apply', 'Only part of this document is already on the order; reconcile it before retrying.');
  }
  const targetBuckets = new Set(mappings.map(row => `${row.po_line_id}|${row.size}`));
  if (targetBuckets.size !== mappings.length) {
    return hold(bill, 'duplicate_target', 'More than one bill line maps to the same order size; combine or review the lines manually.');
  }

  const merchandise = money(mappings.reduce((sum, row) => sum + row.bill_cost, 0));
  const freight = money(bill.freight);
  const sportsFee = money(bill.si_upcharge);
  const total = money(bill.doc_total);
  if (!(total > 0) || Math.abs(money(merchandise + freight + sportsFee) - total) > 0.02) {
    return hold(bill, 'total_mismatch', 'Bill line costs, freight, and Sports Inc fee do not reconcile to the document total.');
  }

  return {
    action: 'apply',
    bill: {
      ...bill,
      matchedPOSource: 'so_po',
      matchedPO: { so_id: soId, po_id: targetRows[0].po_id },
      _lineMappings: mappings,
      _auto_pushed: true,
      _server_automated: true,
    },
    mappings,
    soId,
    poId: targetRows[0].po_id,
    merchandise,
    freight,
    sportsFee,
    total,
  };
};
