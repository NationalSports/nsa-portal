import {
  billVendorMatchName,
  buildVendorBillLines,
  findExistingVendorBill,
  findUniqueVendorMatch,
  normalizeVendorName,
  parseQBDateValue,
  qboAccountOnlyBill,
} from './qbAccountMappings';

const clean = value => String(value == null ? '' : value).trim();
const money = value => Math.round((Number(value) || 0) * 100) / 100;

export const isPendingQboBillLedgerRow = row => !!row
  && row.status === 'pushed'
  && row.portal_status === 'success'
  && !row.is_credit
  && !(row.qb_status === 'success' && clean(row.qb_bill_id));

export const buildQboBillReadinessRows = ledgerRows => (ledgerRows || [])
  .filter(isPendingQboBillLedgerRow)
  .map(row => {
    const raw = row.raw_meta && typeof row.raw_meta === 'object' ? row.raw_meta : {};
    const bill = {
      ...raw,
      doc_number: clean(row.doc_number || raw.doc_number || row.doc_norm),
      vendor: clean(row.vendor || raw.vendor || raw.supplier),
      supplier: clean(raw.supplier || row.vendor || raw.vendor),
      doc_total: money(row.doc_total == null ? raw.doc_total : row.doc_total),
    };
    return {
      ledgerId: clean(row.id),
      bill,
      documentNumber: bill.doc_number,
      vendor: billVendorMatchName(bill),
      date: parseQBDateValue(bill.doc_date),
      total: money(bill.doc_total),
      source: clean(row.source || bill.source),
    };
  });

const uniqueLiveVendor = (name, qboVendors) => {
  const key = normalizeVendorName(name);
  const matches = (qboVendors || []).filter(vendor => vendor?.Active !== false
    && [vendor?.DisplayName, vendor?.CompanyName].some(value => normalizeVendorName(value) === key));
  return matches.length === 1 ? matches[0] : null;
};

const resolveBillVendor = (row, portalVendors, qboVendors, vendorLinks) => {
  const portalVendor = findUniqueVendorMatch(row.vendor, portalVendors || []);
  const savedId = portalVendor && clean(vendorLinks?.[portalVendor.id] || portalVendor.qb_vendor_id);
  if (savedId) {
    const savedMatches = (qboVendors || []).filter(vendor => vendor?.Active !== false
      && clean(vendor.Id) === savedId);
    if (savedMatches.length === 1) return savedMatches[0];
  }
  return uniqueLiveVendor(row.vendor, qboVendors);
};

export const qboBillReadinessFingerprint = row => ({
  ledgerId: clean(row?.ledgerId),
  documentNumber: clean(row?.documentNumber),
  vendor: clean(row?.vendor),
  date: clean(row?.date),
  total: money(row?.total),
});

export const applyQboBillLiveReadiness = ({
  rows = [], qboVendors = [], qboBills = [], portalVendors = [], vendorLinks = {}, accountRefs = {},
} = {}) => rows.map(row => {
  const block = reason => ({ ...row, action: 'blocked', reason });
  if (!row.ledgerId) return block('Bill ledger row is missing its immutable ID');
  if (!row.documentNumber) return block('Vendor document number is missing');
  if (!row.vendor) return block('Canonical portal vendor is missing');
  if (!row.date) return block('Bill date is missing or invalid');
  if (!(row.total > 0)) return block('Bill total must be positive');
  let qboVendor;
  try { qboVendor = resolveBillVendor(row, portalVendors, qboVendors, vendorLinks); }
  catch (error) { return block(error.message); }
  if (!qboVendor) return block(`Vendor "${row.vendor}" is not linked or uniquely present in QBO`);

  let linePlan;
  try { linePlan = buildVendorBillLines(qboAccountOnlyBill(row.bill), accountRefs); }
  catch (error) { return block(error.message); }

  try {
    const existing = findExistingVendorBill(qboBills, {
      docNumber: row.documentNumber,
      vendorId: qboVendor.Id,
      total: linePlan.total,
      txnDate: row.date,
    });
    if (existing) return { ...row, action: 'already_exists', reason: `Exact QBO Bill #${existing.Id}`, qboBillId: clean(existing.Id), qboVendorId: clean(qboVendor.Id), linePlan };
  } catch (error) { return { ...row, action: 'conflict', reason: error.message, qboVendorId: clean(qboVendor.Id), linePlan }; }

  return { ...row, action: 'ready', reason: '', qboVendorId: clean(qboVendor.Id), linePlan };
});

export const summarizeQboBillReadiness = rows => (rows || []).reduce((counts, row) => {
  const key = row?.action || 'unknown';
  counts[key] = (counts[key] || 0) + 1;
  return counts;
}, {});
