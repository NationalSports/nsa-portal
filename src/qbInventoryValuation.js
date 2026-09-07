import {queryQBReadOnly} from './qbAccountMappings';

// The portal is the inventory record; QuickBooks only needs the balance-sheet
// number. Rather than tracking quantity per item in QBO (which would need every
// sale and purchase to flow through items, and the invoice sync posts totals),
// the portal values what it holds and posts one journal entry that trues up
// Inventory Asset to that value against Cost of Goods Sold. This module holds
// the arithmetic and the payload; the engine holds the writes and read-backs.

const cents = value => Math.round((Number(value) || 0) * 100) / 100;
const normalizeSKU = value => String(value || '').trim().toUpperCase();

// Value every product_inventory quantity at the product's cost: the size cost
// when one is recorded, otherwise the catalog cost. A row with no cost cannot be
// valued and is reported instead of guessed; a negative quantity is data damage
// and is reported and counted as zero. Inactive and archived products still
// hold stock, so they are valued like any other.
export function buildQBInventoryValuation(products = [], {asOf} = {}) {
  const rows = [];
  const unpriced = [];
  const negative = [];
  (products || []).forEach(product => {
    if (!product || product.deleted_at) return;
    const inv = product._inv || {};
    const sizeCosts = product._sizeCosts || product.size_costs || {};
    let units = 0, value = 0, missing = 0;
    Object.entries(inv).forEach(([size, qty]) => {
      const quantity = Number(qty) || 0;
      if (quantity < 0) { negative.push({sku: normalizeSKU(product.sku), size, quantity}); return; }
      if (quantity === 0) return;
      const cost = cents(sizeCosts[size] != null && sizeCosts[size] !== '' ? sizeCosts[size] : product.nsa_cost);
      if (!(cost > 0)) { missing += quantity; return; }
      units += quantity;
      value += quantity * cost;
    });
    if (missing > 0) unpriced.push({productId: String(product.id), sku: normalizeSKU(product.sku), name: String(product.name || ''), units: missing});
    if (units > 0) rows.push({productId: String(product.id), sku: normalizeSKU(product.sku), name: String(product.name || ''), units, value: cents(value)});
  });
  rows.sort((a, b) => b.value - a.value);
  return {
    asOf: String(asOf || new Date().toISOString().slice(0, 10)),
    rows,
    products: rows.length,
    units: rows.reduce((sum, row) => sum + row.units, 0),
    value: cents(rows.reduce((sum, row) => sum + row.value, 0)),
    unpriced,
    unpricedUnits: unpriced.reduce((sum, row) => sum + row.units, 0),
    negative,
  };
}

export const qbInventoryValuationDocNumber = asOf => 'INV-VAL-' + String(asOf).slice(0, 10);

// One balanced entry that moves Inventory Asset from its current QBO balance to
// the portal's value. Growth debits the asset and credits COGS (goods bought but
// still on the shelf are not yet a cost); shrinkage does the reverse.
export function buildQBInventoryValuationEntry({valuation, currentBalance, inventoryAssetRef, cogsRef}) {
  if (!valuation || !(valuation.value >= 0)) throw new Error('Inventory valuation is required.');
  if (!inventoryAssetRef?.value || !cogsRef?.value) throw new Error('Inventory Asset and Cost of Goods Sold accounts are required.');
  const target = cents(valuation.value), balance = cents(currentBalance);
  const delta = cents(target - balance);
  if (Math.abs(delta) < 0.005) return null;
  const amount = Math.abs(delta);
  const description = 'Portal inventory on hand ' + valuation.asOf + ': ' + valuation.units + ' units across ' + valuation.products
    + ' products valued at $' + target.toFixed(2) + ' (QBO balance before: $' + balance.toFixed(2) + ')'
    + (valuation.unpricedUnits ? '; ' + valuation.unpricedUnits + ' units excluded for missing cost' : '');
  const line = (postingType, ref) => ({DetailType: 'JournalEntryLineDetail', Amount: amount, Description: description,
    JournalEntryLineDetail: {PostingType: postingType, AccountRef: {value: String(ref.value)}}});
  return {
    DocNumber: qbInventoryValuationDocNumber(valuation.asOf),
    TxnDate: String(valuation.asOf).slice(0, 10),
    PrivateNote: 'NSA Portal inventory valuation ' + valuation.asOf,
    Line: delta > 0 ? [line('Debit', inventoryAssetRef), line('Credit', cogsRef)] : [line('Debit', cogsRef), line('Credit', inventoryAssetRef)],
    _delta: delta,
  };
}

// Compare a read-back JournalEntry to the payload that was sent. QBO echoes the
// lines in order but the check is order-independent so a reordering never
// passes a wrong entry or fails a right one.
export function verifyQBInventoryValuationReadback(entry, payload) {
  if (!entry?.Id) throw new Error('JournalEntry was not returned by API read-back.');
  if (String(entry.DocNumber || '') !== String(payload.DocNumber)) throw new Error('JournalEntry document number did not match on API read-back.');
  if (String(entry.TxnDate || '').slice(0, 10) !== payload.TxnDate) throw new Error('JournalEntry date did not match on API read-back.');
  const key = line => [line.JournalEntryLineDetail?.PostingType, String(line.JournalEntryLineDetail?.AccountRef?.value || ''), cents(line.Amount).toFixed(2)].join('|');
  const expected = payload.Line.map(key).sort();
  const actual = (entry.Line || []).filter(line => line.DetailType === 'JournalEntryLineDetail').map(key).sort();
  if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) {
    throw new Error('JournalEntry lines, accounts, or amounts differ from the reviewed entry.');
  }
  return entry;
}

export async function loadQBInventoryAssetBalance(qbApi, accountId) {
  const response = await queryQBReadOnly(qbApi, "SELECT * FROM Account WHERE Id = '" + String(accountId).replace(/'/g, "\\'") + "' MAXRESULTS 1", 'inventory asset balance');
  const account = response?.QueryResponse?.Account?.[0];
  if (!account || String(account.Id) !== String(accountId)) throw new Error('Inventory Asset account was not returned by QBO.');
  if (account.Active === false) throw new Error('Inventory Asset account is inactive in QBO.');
  return cents(account.CurrentBalance);
}

export async function findQBInventoryValuationEntries(qbApi, docNumber) {
  const response = await queryQBReadOnly(qbApi, "SELECT * FROM JournalEntry WHERE DocNumber = '" + String(docNumber).replace(/'/g, "\\'") + "' MAXRESULTS 10", 'inventory valuation duplicate preflight');
  return response?.QueryResponse?.JournalEntry || [];
}

export async function loadQBJournalEntry(qbApi, id) {
  const response = await queryQBReadOnly(qbApi, "SELECT * FROM JournalEntry WHERE Id = '" + String(id).replace(/'/g, "\\'") + "' MAXRESULTS 1", 'journal entry API read-back');
  return response?.QueryResponse?.JournalEntry?.[0] || null;
}
