// Single source of truth for every QuickBooks account used by the portal.
// Values are account numbers (AcctNum), not display names. Account numbers are
// stable across renamed accounts and let us fail closed instead of guessing.

export const QB_ACCOUNT_SPECS = Object.freeze({
  income_account: Object.freeze({ number: '40000', name: 'Sales', types: ['Income'] }),
  discount_account: Object.freeze({ number: '40200', name: 'Sales:Discounts', types: ['Income'] }),
  purchases_account: Object.freeze({ number: '51300', name: 'Purchases', types: ['Cost of Goods Sold'] }),
  freight_account: Object.freeze({ number: '51000', name: 'Cost of Goods Sold:Freight In', types: ['Cost of Goods Sold'] }),
  outbound_freight_account: Object.freeze({ number: '67000', name: 'Freight Expenses', types: ['Expense'] }),
  sports_inc_fee_account: Object.freeze({ number: '58000', name: 'Sports Inc Fee', types: ['Cost of Goods Sold'] }),
  omg_fee_account: Object.freeze({ number: '57000', name: 'OMG Fee', types: ['Cost of Goods Sold'] }),
  deco_account: Object.freeze({ number: '52000', name: 'Outside Decoration', types: ['Cost of Goods Sold'] }),
  decoration_account: Object.freeze({ number: '55100', name: 'Decoration', types: ['Cost of Goods Sold'] }),
  in_house_art_account: Object.freeze({ number: '55400', name: 'Decoration:In House Art', types: ['Cost of Goods Sold'] }),
  ar_account: Object.freeze({ number: '11000', name: 'Accounts Receivable (A/R)', types: ['Accounts Receivable'] }),
  payment_deposit_account: Object.freeze({ number: '11010', name: 'Undeposited Funds', types: ['Other Current Asset'] }),
  ap_account: Object.freeze({ number: '21100', name: 'Accounts Payable (A/P)', types: ['Accounts Payable'] }),
  tax_parent_account: Object.freeze({ number: '25201', name: 'Sales Tax Payables', types: ['Other Current Liability'] }),
  tax_ca_account: Object.freeze({ number: '25200', name: 'Sales Tax Payables:CA', types: ['Other Current Liability'] }),
  tax_az_account: Object.freeze({ number: '25205', name: 'Sales Tax Payables:AZ', types: ['Other Current Liability'] }),
  tax_co_account: Object.freeze({ number: '25215', name: 'Sales Tax Payables:CO', types: ['Other Current Liability'] }),
  tax_nv_account: Object.freeze({ number: '25220', name: 'Sales Tax Payables:NV', types: ['Other Current Liability'] }),
  tax_tx_account: Object.freeze({ number: '25225', name: 'Sales Tax Payables:TX', types: ['Other Current Liability'] }),
  tax_wa_account: Object.freeze({ number: '25230', name: 'Sales Tax Payables:WA', types: ['Other Current Liability'] }),
});

export const QB_STATE_TAX_ACCOUNT_KEYS = Object.freeze({
  CA: 'tax_ca_account', AZ: 'tax_az_account', CO: 'tax_co_account',
  NV: 'tax_nv_account', TX: 'tax_tx_account', WA: 'tax_wa_account',
});

export const QB_REQUIRED_ACCOUNT_KEYS = Object.freeze(Object.keys(QB_ACCOUNT_SPECS));

export const QB_ACCOUNT_MAPPING_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(QB_ACCOUNT_SPECS).map(([key, spec]) => [key, spec.number]))
);

const LEGACY_MAPPING_VALUES = Object.freeze({
  Sales: '40000',
  'Sales of Product Income': '40000',
  Discounts: '40200',
  Purchases: '51300',
  'Shipping and delivery expense': '51000',
  'Freight In': '51000',
  'Freight Expenses': '67000',
  'Sports Inc Fee': '58000',
  'OMG Fee': '57000',
  'Subcontractor - Decoration': '52000',
  'Outside Decoration': '52000',
  Decoration: '55100',
  'In House Art': '55400',
  'Decoration:In House Art': '55400',
  'Accounts Receivable': '11000',
  'Accounts Receivable (A/R)': '11000',
  'Undeposited Funds': '11010',
  'Accounts Payable': '21100',
  'Accounts Payable (A/P)': '21100',
  'Sales Tax Payable': '25201',
  'Sales Tax Payables': '25201',
  'Sales Tax Payables:CA': '25200',
  'Sales Tax Payables:AZ': '25205',
  'Sales Tax Payables:CO': '25215',
  'Sales Tax Payables:NV': '25220',
  'Sales Tax Payables:TX': '25225',
  'Sales Tax Payables:WA': '25230',
});

const norm = value => String(value == null ? '' : value).trim().toLowerCase();
const money = value => Math.round((Number(value) || 0) * 100) / 100;

// Matches the portal's order-total calculation: percentage shipping is based
// on merchandise + decoration revenue, flat shipping is used as-is, and an
// explicitly carried prior shipping charge is added once. Customer shipping
// is sales revenue and therefore uses the same 40000 item as other sales.
export function calculateCustomerShipping(order, salesSubtotal) {
  const subtotal = Math.max(0, Number(salesSubtotal) || 0);
  const value = Number(order?.shipping_value) || 0;
  if (value < 0) throw new Error('Customer shipping cannot be negative.');
  const current = order?.shipping_type === 'pct' ? subtotal * value / 100 : value;
  const prior = order?.pending_ship_applied ? Number(order?.pending_ship_amount) || 0 : 0;
  if (prior < 0) throw new Error('Prior customer shipping cannot be negative.');
  return money(current + prior);
}

// OMG is a distinct hosted-store source. A native Portal webstore may have a
// Stripe/card fee, but that is not an OrderMyGear fee and must never hit 57000.
export function getOmgFeeSource(storeOrSalesOrder) {
  const row = storeOrSalesOrder || {};
  const isOmg = row.source === 'omg' || !!row.omg_store_id || !!row._omg_source ||
    String(row.id || '').startsWith('OMG-sale_');
  const amount = money(row._omg_omg_fees);
  return isOmg && amount > 0
    ? { sourceType: 'omg_accounting_report', sourceId: row.omg_store_id || row.id, amount, accountKey: 'omg_fee_account' }
    : null;
}

// Produces a read-only labor-cost manifest from the portal's two clocks. It is
// deliberately not a QBO write builder: internal labor needs an accountant-
// approved offset/reclassification account, stable source IDs, and a posting
// cadence before it can be journaled without duplicating payroll expense.
export function buildInternalLaborCostManifest({ artLogs = [], decorationLogs = [], laborRates = {} } = {}) {
  const summarize = (logs, accountKey, sourceType) => {
    let minutes = 0;
    let idleMinutes = 0;
    let cost = 0;
    for (const log of logs || []) {
      const mins = Math.max(0, Number(log?.minutes) || 0);
      const idle = Math.min(mins, Math.max(0, Number(log?.idleMinutes) || 0));
      const rate = Math.max(0, Number(laborRates?.[log?.person]) || 0);
      minutes += mins;
      idleMinutes += idle;
      cost += mins / 60 * rate;
    }
    return { sourceType, accountKey, minutes, idleMinutes, amount: money(cost), logCount: (logs || []).length };
  };
  return {
    decoration: summarize(decorationLogs, 'decoration_account', 'job_time_logs'),
    inHouseArt: summarize(artLogs, 'in_house_art_account', 'art_time_logs'),
  };
}

export function migrateQBAccountMapping(mapping = {}) {
  const migrated = { ...QB_ACCOUNT_MAPPING_DEFAULTS };
  for (const [key, value] of Object.entries(mapping || {})) {
    const clean = String(value == null ? '' : value).trim();
    if (!clean) continue;
    migrated[key] = LEGACY_MAPPING_VALUES[clean] || clean;
  }
  if (mapping?.tax_account && !mapping?.tax_parent_account) {
    const clean = String(mapping.tax_account).trim();
    migrated.tax_parent_account = LEGACY_MAPPING_VALUES[clean] || clean;
  }
  return migrated;
}

export const QB_ACCOUNT_QUERY =
  'SELECT Id, Name, FullyQualifiedName, AcctNum, AccountType, AccountSubType, Active FROM Account MAXRESULTS 1000';

export async function loadQBAccounts(qbApi) {
  const response = await qbApi('query', { query: QB_ACCOUNT_QUERY });
  const fault = response?.Fault?.Error?.[0];
  if (fault) throw new Error(fault.Detail || fault.Message || 'QuickBooks account query failed');
  return response?.QueryResponse?.Account || [];
}

export async function loadAllQBEntities(qbApi, entity, fields = '*', pageSize = 500) {
  if (!/^[A-Za-z]+$/.test(String(entity || ''))) throw new Error('Invalid QuickBooks entity name.');
  const size = Math.max(1, Math.min(1000, Number(pageSize) || 500));
  const rows = [];
  for (let start = 1; start <= 100000; start += size) {
    const response = await qbApi('query', {
      query: `SELECT ${fields} FROM ${entity} STARTPOSITION ${start} MAXRESULTS ${size}`,
    });
    const fault = response?.Fault?.Error?.[0];
    if (fault) throw new Error(fault.Detail || fault.Message || `QuickBooks ${entity} query failed`);
    const page = response?.QueryResponse?.[entity] || [];
    rows.push(...page);
    if (page.length < size) return rows;
  }
  throw new Error(`QuickBooks ${entity} query exceeded the 100,000-record safety limit.`);
}

function typeMatches(accountType, expectedTypes) {
  const actual = norm(accountType).replace(/\s*\(.*\)$/, '');
  return expectedTypes.some(type => {
    const expected = norm(type).replace(/\s*\(.*\)$/, '');
    return actual === expected || actual === expected + 's' || actual + 's' === expected;
  });
}

export function resolveQBAccount(accounts, mapping, key) {
  const spec = QB_ACCOUNT_SPECS[key];
  if (!spec) throw new Error('Unknown QuickBooks account mapping key: ' + key);
  const configured = String(mapping?.[key] || spec.number).trim();
  const active = (accounts || []).filter(account => account && account.Active !== false);
  const numberMatches = active.filter(account => String(account.AcctNum || '').trim() === configured);
  const nameMatches = active.filter(account =>
    norm(account.Name) === norm(configured) || norm(account.FullyQualifiedName) === norm(configured)
  );
  const candidates = numberMatches.length ? numberMatches : nameMatches;
  if (candidates.length !== 1) {
    const reason = candidates.length > 1 ? 'is duplicated' : 'was not found';
    throw new Error(
      `QB account ${configured} for ${key} ${reason}. Expected ${spec.number} ${spec.name}; no transaction was sent.`
    );
  }
  const account = candidates[0];
  if (!typeMatches(account.AccountType, spec.types)) {
    throw new Error(
      `QB account ${configured} for ${key} has type "${account.AccountType || 'unknown'}"; expected ${spec.types.join(' or ')}. No transaction was sent.`
    );
  }
  return { value: String(account.Id), name: account.Name, accountNumber: String(account.AcctNum || configured) };
}

export function resolveQBAccountRefs(accounts, mapping, keys) {
  return Object.fromEntries(keys.map(key => [key, resolveQBAccount(accounts, mapping, key)]));
}

export function manualBillAccountKey(vendorSelection) {
  return String(vendorSelection || '').startsWith('deco:') ? 'deco_account' : 'purchases_account';
}

export function isDecorationVendorBill(bill, decorationVendors = []) {
  if (bill?.kind === 'decoration') return true;
  const supplier = norm(bill?.supplier).replace(/[^a-z0-9]/g, '');
  if (supplier.length < 4) return false;
  return (decorationVendors || []).some(vendor => {
    if (!vendor || vendor.is_active === false) return false;
    const vendorName = norm(vendor.name).replace(/[^a-z0-9]/g, '');
    return vendorName.length >= 4 &&
      (supplier === vendorName || supplier.includes(vendorName) || vendorName.includes(supplier));
  });
}

function expenseLine(amount, description, accountRef) {
  return {
    DetailType: 'AccountBasedExpenseLineDetail',
    Amount: money(amount),
    Description: description,
    AccountBasedExpenseLineDetail: { AccountRef: accountRef },
  };
}

const skuKey = value => String(value == null ? '' : value).trim().toUpperCase();

export function indexQBNonInventoryItems(items = [], requiredSkus = []) {
  const required = new Set((requiredSkus || []).map(skuKey).filter(Boolean));
  const grouped = new Map();
  for (const item of items || []) {
    if (!item || item.Active === false) continue;
    const key = skuKey(item.Sku || (/^[^\s]+$/.test(String(item.Name || '').trim()) ? item.Name : ''));
    if (!key) continue;
    if (required.size && !required.has(key)) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  }
  const refs = {};
  for (const [key, matches] of grouped) {
    if (matches.length !== 1) throw new Error(`QBO SKU ${key} is duplicated; no bill was sent.`);
    const item = matches[0];
    if (String(item.Type || '').toLowerCase() !== 'noninventory') {
      throw new Error(`QBO SKU ${key} has item type "${item.Type || 'unknown'}"; expected NonInventory. No bill was sent.`);
    }
    refs[key] = { value: String(item.Id), name: item.Name };
  }
  for (const key of required) {
    if (!refs[key]) throw new Error(`QBO NonInventory item for SKU ${key} was not found. No bill was sent.`);
  }
  return refs;
}

export function aggregateBillItemsBySku(items = []) {
  const bySku = new Map();
  let noSkuAmount = 0;
  for (const item of items || []) {
    const qty = Number(item?.qty) || 0;
    const unitPrice = Number(item?.unit_price) || 0;
    const amount = money(Number(item?.extension) || qty * unitPrice);
    if (qty < 0 || unitPrice < 0 || amount < 0) throw new Error('Bill item quantities and amounts cannot be negative.');
    if (qty <= 0 && amount <= 0) continue;
    const sku = skuKey(item?.sku);
    if (!sku) {
      noSkuAmount = money(noSkuAmount + amount);
      continue;
    }
    const group = bySku.get(sku) || { sku, qty: 0, amount: 0, descriptions: new Set() };
    group.qty += qty;
    group.amount = money(group.amount + amount);
    if (item?.desc) group.descriptions.add(String(item.desc).trim());
    bySku.set(sku, group);
  }
  return {
    skuItems: [...bySku.values()].map(group => ({
      sku: group.sku,
      qty: group.qty,
      amount: group.amount,
      description: [...group.descriptions].filter(Boolean).join(' / '),
    })),
    noSkuAmount,
  };
}

function itemExpenseLine(group, po, itemRef) {
  if (!itemRef?.value) throw new Error(`QBO NonInventory item for SKU ${group.sku} was not found. No bill was sent.`);
  if (!(group.qty > 0)) throw new Error(`Bill SKU ${group.sku} has no positive quantity. No bill was sent.`);
  return {
    DetailType: 'ItemBasedExpenseLineDetail',
    Amount: money(group.amount),
    Description: `${group.sku}${group.description ? ' — ' + group.description : ''} — PO ${po}`,
    ItemBasedExpenseLineDetail: {
      ItemRef: itemRef,
      Qty: group.qty,
      UnitPrice: money(group.amount / group.qty),
    },
  };
}

// Builds posting lines for a parsed supplier bill and asserts that every cent of
// the document total is categorized. A discrepancy blocks the bill.
export function buildVendorBillLines(bill, accountRefs, itemRefsBySku = {}) {
  if (!bill || bill.is_credit) throw new Error('Credit memos cannot use the normal bill push.');
  const freight = money(bill.freight);
  const sportsFee = money(bill.si_upcharge);
  const statedTotal = money(bill.doc_total);
  if (freight < 0 || sportsFee < 0 || statedTotal < 0) throw new Error('Bill amounts cannot be negative.');
  const po = bill.po_number || 'unmatched';
  const supplier = bill.supplier ? ' — ' + bill.supplier : '';
  const lines = [];

  if (bill.kind === 'decoration') {
    const decoration = money(statedTotal - freight);
    if (decoration <= 0) throw new Error('Decoration bill has no positive decoration amount after freight.');
    lines.push(expenseLine(decoration, `Outside decoration — PO ${po}${supplier}`, accountRefs.deco_account));
    if (freight > 0) lines.push(expenseLine(freight, `Freight in — PO ${po}`, accountRefs.freight_account));
  } else {
    let merchandise = money(bill.merchandise_total);
    if (merchandise <= 0 && statedTotal > 0) merchandise = money(statedTotal - freight - sportsFee);
    if (merchandise <= 0) throw new Error('Goods bill has no positive merchandise amount.');
    const grouped = aggregateBillItemsBySku(bill.items);
    const itemAmount = money(grouped.skuItems.reduce((sum, item) => sum + item.amount, 0) + grouped.noSkuAmount);
    if (grouped.skuItems.length && Math.abs(itemAmount - merchandise) > 0.009) {
      throw new Error(`SKU lines total $${itemAmount.toFixed(2)}, but merchandise total is $${merchandise.toFixed(2)}. No bill was sent.`);
    }
    grouped.skuItems.forEach(group => lines.push(itemExpenseLine(group, po, itemRefsBySku[group.sku])));
    if (grouped.noSkuAmount > 0) {
      lines.push(expenseLine(grouped.noSkuAmount, `No-SKU supplies — PO ${po}${supplier}`, accountRefs.purchases_account));
    }
    if (!grouped.skuItems.length && grouped.noSkuAmount <= 0) {
      lines.push(expenseLine(merchandise, `No-SKU supplies / merchandise — PO ${po}${supplier}`, accountRefs.purchases_account));
    }
    if (freight > 0) lines.push(expenseLine(freight, `Freight in — PO ${po}`, accountRefs.freight_account));
    if (sportsFee > 0) lines.push(expenseLine(sportsFee, `Sports Inc fee — PO ${po}`, accountRefs.sports_inc_fee_account));
  }

  const lineTotal = money(lines.reduce((sum, line) => sum + line.Amount, 0));
  const expected = statedTotal > 0 ? statedTotal : lineTotal;
  if (expected <= 0) throw new Error('Bill total must be positive.');
  if (Math.abs(lineTotal - expected) > 0.009) {
    throw new Error(
      `Bill account lines total $${lineTotal.toFixed(2)}, but document total is $${expected.toFixed(2)}. No transaction was sent.`
    );
  }
  return { lines, total: expected };
}

export const QB_ACCOUNT_POSTING_MATRIX = Object.freeze([
  { itemType: 'Customer merchandise / decoration revenue', accountKey: 'income_account', account: '40000 Sales', posting: 'Credit', control: '11000 A/R debit' },
  { itemType: 'Customer-billed shipping', accountKey: 'income_account', account: '40000 Sales', posting: 'Credit', control: '11000 A/R debit' },
  { itemType: 'Vendor apparel / equipment by SKU', accountKey: 'purchases_account', account: '51300 Purchases', posting: 'Debit (COGS via NonInventory item)', control: '21100 A/P credit' },
  { itemType: 'No-SKU supplies', accountKey: 'purchases_account', account: '51300 Purchases', posting: 'Debit (COGS)', control: '21100 A/P credit' },
  { itemType: 'Vendor freight on a bill', accountKey: 'freight_account', account: '51000 Freight In', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Outbound UPS / FedEx expense', accountKey: 'outbound_freight_account', account: '67000 Freight Expenses', posting: 'Debit', control: 'Not currently created by Connect' },
  { itemType: 'Outside decoration vendor bill', accountKey: 'deco_account', account: '52000 Outside Decoration', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Sports Inc fee', accountKey: 'sports_inc_fee_account', account: '58000 Sports Inc Fee', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'OrderMyGear hosted-store fee', accountKey: 'omg_fee_account', account: '57000 OMG Fee', posting: 'Debit', control: 'Source: OMG Accounting Report; settlement posting method pending' },
  { itemType: 'In-house decoration labor', accountKey: 'decoration_account', account: '55100 Decoration', posting: 'Debit / payroll reclass', control: 'Source: production time logs × labor rate; offset/cadence pending' },
  { itemType: 'In-house art labor', accountKey: 'in_house_art_account', account: '55400 In House Art', posting: 'Debit / payroll reclass', control: 'Source: art time logs × labor rate; offset/cadence pending' },
  { itemType: 'Customer payment deposit', accountKey: 'payment_deposit_account', account: '11010 Undeposited Funds', posting: 'Debit', control: '11000 A/R credit' },
  { itemType: 'Customer discount', accountKey: 'discount_account', account: '40200 Sales:Discounts', posting: 'Debit / negative revenue', control: '11000 A/R' },
  { itemType: 'State sales tax', accountKey: 'state tax mapping', account: '25200–25230 state subaccounts', posting: 'Credit', control: 'Portal amount; QBO TaxCode mapping required' },
  { itemType: 'Quarterly sales-tax payment', accountKey: 'state tax mapping', account: 'Individual state subaccount', posting: 'Debit', control: 'Bank credit — workflow not yet implemented' },
]);
