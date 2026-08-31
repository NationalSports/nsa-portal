// Single source of truth for every QuickBooks account used by the portal.
// Values are account numbers (AcctNum), not display names. Account numbers are
// stable across renamed accounts and let us fail closed instead of guessing.

export const QB_ACCOUNT_SPECS = Object.freeze({
  income_account: Object.freeze({ number: '40000', name: 'Sales', types: ['Income'] }),
  discount_account: Object.freeze({ number: '40200', name: 'Sales:Discounts', types: ['Income'] }),
  purchases_account: Object.freeze({ number: '51300', name: 'Purchases', types: ['Cost of Goods Sold'] }),
  freight_account: Object.freeze({ number: '51000', name: 'Cost of Goods Sold:Freight In', types: ['Cost of Goods Sold'] }),
  outbound_freight_account: Object.freeze({ number: '40100', name: 'Shipping Expense', types: ['Expense'] }),
  sports_inc_fee_account: Object.freeze({ number: '58000', name: 'Sports Inc Fee', types: ['Cost of Goods Sold'] }),
  omg_fee_account: Object.freeze({ number: '57000', name: 'OMG Fee', types: ['Cost of Goods Sold'] }), // OMG vendor invoices and Deposit Statement OMG Fee Withheld
  omg_card_fee_account: Object.freeze({ number: '71400', name: 'Bank Charges', types: ['Expense'] }),
  deco_account: Object.freeze({ number: '52000', name: 'Outside Decoration', types: ['Cost of Goods Sold'] }),
  decoration_account: Object.freeze({ number: '55200', name: 'Decoration:Decoration Labor', types: ['Cost of Goods Sold'] }),
  in_house_art_account: Object.freeze({ number: '55400', name: 'Decoration:In House Art', types: ['Cost of Goods Sold'] }),
  ar_account: Object.freeze({ number: '11000', name: 'Accounts Receivable (A/R)', types: ['Accounts Receivable'] }),
  payment_deposit_account: Object.freeze({ number: '11010', name: 'Undeposited Funds', types: ['Other Current Asset'] }),
  operating_bank_account: Object.freeze({ number: '10100', name: 'First Foundation Checking', types: ['Bank'] }),
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
  'Freight Expenses': '40100',
  'Shipping Expense': '40100',
  'Sports Inc Fee': '58000',
  'OMG Fee': '57000',
  'Bank Charges': '71400',
  'Subcontractor - Decoration': '52000',
  'Outside Decoration': '52000',
  Decoration: '55200',
  'Decoration Labor': '55200',
  'Decoration:Decoration Labor': '55200',
  'In House Art': '55400',
  'Decoration:In House Art': '55400',
  'Accounts Receivable': '11000',
  'Accounts Receivable (A/R)': '11000',
  'Undeposited Funds': '11010',
  'First Foundation Checking': '10100',
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

// Vendor names arrive from PDFs, the portal, and QBO with inconsistent legal
// suffixes and punctuation. Normalize only those harmless differences. Do not
// use substring matching: "ABC Apparel" must never silently match
// "ABC Apparel Decoration" or another similarly named supplier.
const VENDOR_LEGAL_SUFFIXES = new Set([
  'co', 'company', 'corp', 'corporation', 'inc', 'incorporated',
  'llc', 'llp', 'lp', 'ltd', 'limited',
]);

export function normalizeVendorName(value) {
  const tokens = norm(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length > 1 && VENDOR_LEGAL_SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  return tokens.join(' ');
}

export function findUniqueVendorMatch(value, vendors = []) {
  const target = normalizeVendorName(value);
  if (!target) return null;
  const matches = (vendors || []).filter(vendor =>
    vendor && vendor.is_active !== false && normalizeVendorName(vendor.name) === target
  );
  if (matches.length > 1) {
    throw new Error(`Multiple active portal vendors match "${String(value || '').trim()}"; no transaction was sent.`);
  }
  return matches[0] || null;
}

export function parseQBDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  let year, month, day;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:\D|$)/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\D|$)/);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (us) {
    year = Number(us[3].length === 2 ? '20' + us[3] : us[3]);
    month = Number(us[1]); day = Number(us[2]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

export function calculateOmgInvoicePayment(grossCollected, invoiceTotal) {
  const gross = money(grossCollected);
  const total = money(invoiceTotal);
  if (gross < 0 || total < 0) throw new Error('OMG collected and invoice amounts cannot be negative.');
  return gross > 0 ? money(Math.min(gross, total)) : 0;
}

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

// The owner approved 57000 for OMG/webstore fees. That includes both actual OMG
// vendor invoices (store setup, chargebacks, etc.) and the separately identified
// "OMG Fee Withheld" line on an OMG Deposit Statement. Processing/card fees stay
// separate in 71400.
export function getOmgFeeSource(storeOrSalesOrder) {
  const row = storeOrSalesOrder || {};
  const isOmg = row.source === 'omg' || !!row.omg_store_id || !!row._omg_source ||
    String(row.id || '').startsWith('OMG-sale_');
  const amount = money(row._omg_omg_fees);
  return isOmg && amount > 0
    ? {
      sourceType: 'omg_deposit_statement_withheld_fee',
      sourceId: row._omg_deposit_statement_id || row.omg_store_id || row.id,
      amount,
      accountKey: 'omg_fee_account',
      blocked: false,
    }
    : null;
}

const statementAmount = (chunk, labelPattern, label) => {
  const line = String(chunk || '').split(/\r?\n/).find(row => labelPattern.test(row));
  if (!line) throw new Error('OMG Deposit Statement is missing ' + label + '.');
  const match = line.match(/\(?\s*\$\s*([\d,]+\.\d{2})\s*\)?/);
  if (!match) throw new Error('OMG Deposit Statement has an invalid ' + label + '.');
  return money(match[1].replace(/,/g, ''));
};

const isoStatementDate = value => {
  const match = String(value || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) throw new Error('OMG Deposit Statement date is invalid.');
  const year = match[3].length === 2 ? '20' + match[3] : match[3];
  return year + '-' + match[1].padStart(2, '0') + '-' + match[2].padStart(2, '0');
};

// One OMG Deposit Statement represents one actual bank deposit, even though it
// can include many stores and hundreds of payment/refund transactions. Parse
// each statement separately and enforce its header reconciliation before any
// QBO manifest can be built.
export function parseOmgDepositStatements(text) {
  const raw = String(text || '').replace(/\u00a0/g, ' ');
  const heading = /Deposit\s+Statement/gi;
  const matches = [...raw.matchAll(heading)];
  if (!matches.length) throw new Error('No OMG Deposit Statement ID was found.');
  return matches.map((match, index) => {
    const chunk = raw.slice(match.index, matches[index + 1]?.index || raw.length);
    const rows = chunk.split(/\r?\n/);
    const headerText = rows.slice(0, 6).join(' ');
    const statementId = (headerText.match(/\b(?=[A-Z0-9-]{8,16}\b)(?=[A-Z0-9-]*[A-Z])(?=[A-Z0-9-]*\d)[A-Z0-9-]+\b/g) || [])[0];
    if (!statementId) throw new Error('OMG Deposit Statement is missing its unique statement ID.');
    const dateLine = rows.find(line => /Statement\s+Date/i.test(line));
    const dateMatch = dateLine?.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    if (!dateMatch) throw new Error('OMG Deposit Statement ' + statementId + ' is missing its statement date.');
    const statusLine = rows.find(line => /Deposit\s+Status/i.test(line)) || '';
    const statusMatch = statusLine.match(/Deposit\s+Status\s+([A-Za-z]+)/i);
    const bankLine = rows.find(line => /Bank\s+Account/i.test(line)) || '';
    const bankMatch = bankLine.match(/Bank\s+Account\s+(.+?)(?:\s{2,}Processing\s+Fee\s+Withheld|$)/i);
    const storesLine = rows.find(line => /Stores\s+Included/i.test(line)) || '';
    const storesMatch = storesLine.match(/Stores\s+Included\s+(\d+)/i);

    const totalCollected = statementAmount(chunk, /Total\s+Collected/i, 'Total Collected');
    const omgFeeWithheld = statementAmount(chunk, /OMG\s+Fee\s+Withheld/i, 'OMG Fee Withheld');
    const processingFeeWithheld = statementAmount(chunk, /Processing\s+Fee\s+Withheld/i, 'Processing Fee Withheld');
    const netAmount = statementAmount(chunk, /Net\s+Amount/i, 'Net Amount');
    const calculatedNet = money(totalCollected - omgFeeWithheld - processingFeeWithheld);
    if (calculatedNet !== netAmount) {
      throw new Error(
        'OMG Deposit Statement ' + statementId + ' does not reconcile: collected $' +
        totalCollected.toFixed(2) + ' less fees is $' + calculatedNet.toFixed(2) +
        ', but Net Amount is $' + netAmount.toFixed(2) + '.'
      );
    }
    const refundCount = (chunk.match(/\bRefund\b/gi) || []).length;
    return {
      sourceKey: 'NSA-OMG-DEPOSIT:' + statementId,
      statementId,
      statementDate: isoStatementDate(dateMatch[1]),
      depositStatus: String(statusMatch?.[1] || '').toLowerCase(),
      bankAccount: String(bankMatch?.[1] || '').trim(),
      storesIncluded: storesMatch ? Number(storesMatch[1]) : null,
      totalCollected,
      omgFeeWithheld,
      processingFeeWithheld,
      netAmount,
      refundCount,
      hasRefunds: refundCount > 0,
    };
  });
}

// Builds the exact QBO Bank Deposit for an OMG payout. Customer payments are
// first recorded in 11010 at their gross amount. The Deposit then links those
// Payments and subtracts the OMG and card fees so its line total equals the
// amount that actually landed in 10100.
export function buildOmgBankDeposit({
  sourceId, txnDate, payments = [], omgFee = 0, cardFee = 0,
  bankAccountRef, omgWithheldFeeAccountRef, cardFeeAccountRef,
  expectedCollected = null, expectedNet = null, depositStatus = 'completed', refundCount = 0,
} = {}) {
  const sourceKey = String(sourceId || '').trim();
  if (!sourceKey) throw new Error('OMG deposit source ID is required.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(txnDate || ''))) {
    throw new Error('OMG deposit date must be YYYY-MM-DD.');
  }
  const requireRef = (ref, label) => {
    if (!ref?.value) throw new Error(label + ' account reference is required.');
    return ref;
  };
  requireRef(bankAccountRef, 'deposit bank');
  requireRef(omgWithheldFeeAccountRef, 'OMG Fee Withheld');
  requireRef(cardFeeAccountRef, '71400 processing fee');
  if (String(depositStatus || '').toLowerCase() !== 'completed') {
    throw new Error('OMG deposit statement is not completed.');
  }
  if (Number(refundCount) > 0) {
    throw new Error('OMG deposit contains refunds; refund/credit-memo posting must be completed before QBO deposit creation.');
  }

  const seen = new Set();
  const linkedPaymentLines = (payments || []).map((payment, index) => {
    const paymentId = String(payment?.paymentId || payment?.id || '').trim();
    const amount = money(payment?.amount);
    if (!paymentId) throw new Error('OMG deposit payment #' + (index + 1) + ' is missing a QBO Payment ID.');
    if (seen.has(paymentId)) throw new Error('OMG deposit contains duplicate QBO Payment ID ' + paymentId + '.');
    if (!(amount > 0)) throw new Error('OMG deposit payment #' + (index + 1) + ' must be positive.');
    seen.add(paymentId);
    return {
      Amount: amount,
      LinkedTxn: [{ TxnId: paymentId, TxnType: 'Payment', TxnLineId: '0' }],
    };
  });
  if (!linkedPaymentLines.length) throw new Error('OMG deposit requires at least one linked QBO Payment.');

  const rawOmgFee = Number(omgFee);
  const rawCardFee = Number(cardFee);
  if (!Number.isFinite(rawOmgFee) || rawOmgFee < 0) throw new Error('OMG fee cannot be negative or invalid.');
  if (!Number.isFinite(rawCardFee) || rawCardFee < 0) throw new Error('OMG card fee cannot be negative or invalid.');
  const gross = money(linkedPaymentLines.reduce((sum, line) => sum + line.Amount, 0));
  if (expectedCollected != null && gross !== money(expectedCollected)) {
    throw new Error('Linked QBO Payments do not equal the OMG statement Total Collected.');
  }
  const cleanOmgFee = money(rawOmgFee);
  const cleanCardFee = money(rawCardFee);
  const totalFees = money(cleanOmgFee + cleanCardFee);
  const net = money(gross - totalFees);
  if (!(net > 0)) throw new Error('OMG payout fees must be less than the gross customer payments.');

  const lines = [...linkedPaymentLines];
  if (cleanOmgFee > 0) {
    lines.push({
      Amount: -cleanOmgFee,
      Description: 'OrderMyGear fee withheld',
      DetailType: 'DepositLineDetail',
      DepositLineDetail: { AccountRef: omgWithheldFeeAccountRef },
    });
  }
  if (cleanCardFee > 0) {
    lines.push({
      Amount: -cleanCardFee,
      Description: 'OrderMyGear processing fee withheld',
      DetailType: 'DepositLineDetail',
      DepositLineDetail: { AccountRef: cardFeeAccountRef },
    });
  }
  const lineTotal = money(lines.reduce((sum, line) => sum + Number(line.Amount || 0), 0));
  if (lineTotal !== net) throw new Error('OMG deposit lines do not reconcile to the net bank deposit.');
  if (expectedNet != null && net !== money(expectedNet)) {
    throw new Error('QBO deposit total does not equal the OMG statement Net Amount.');
  }

  return {
    sourceKey: 'NSA-OMG-DEPOSIT:' + sourceKey,
    gross,
    totalFees,
    net,
    deposit: {
      TxnDate: txnDate,
      DepositToAccountRef: bankAccountRef,
      PrivateNote: 'NSA-OMG-DEPOSIT:' + sourceKey,
      Line: lines,
    },
  };
}

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
    // 55100 was the old generic Decoration parent. Accounting explicitly
    // approved 55200 Decoration Labor for portal in-house labor.
    if (key === 'decoration_account' && clean === '55100') {
      migrated[key] = '55200';
      continue;
    }
    // 67000 Freight Expenses is explicitly retired. Customer-bound UPS/FedEx
    // shipping must route to 40100 Shipping Expense.
    if (key === 'outbound_freight_account' && clean === '67000') {
      migrated[key] = '40100';
      continue;
    }
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
  return !!findUniqueVendorMatch(bill?.supplier, decorationVendors);
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
      // Keep enough precision that Qty x UnitPrice rounds back to Amount. Two
      // decimal rate rounding makes $10 / 3 display as $9.99 in QBO.
      UnitPrice: Math.round((group.amount / group.qty) * 1e6) / 1e6,
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
  { itemType: 'Outbound UPS / FedEx expense', accountKey: 'outbound_freight_account', account: '40100 Shipping Expense', posting: 'Debit', control: 'Not currently created by Connect; 67000 is retired' },
  { itemType: 'Outside decoration vendor bill', accountKey: 'deco_account', account: '52000 Outside Decoration', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Sports Inc fee', accountKey: 'sports_inc_fee_account', account: '58000 Sports Inc Fee', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'OrderMyGear vendor invoice fee', accountKey: 'omg_fee_account', account: '57000 OMG Fee', posting: 'Debit on OMG vendor bill', control: '21100 A/P credit' },
  { itemType: 'OrderMyGear fee withheld from deposit', accountKey: 'omg_fee_account', account: '57000 OMG Fee', posting: 'Debit via negative bank-deposit line', control: 'Deposit Statement “OMG Fee Withheld”' },
  { itemType: 'OrderMyGear processing fee withheld', accountKey: 'omg_card_fee_account', account: '71400 Bank Charges', posting: 'Debit via negative deposit line', control: 'Deposit Statement “Processing Fee Withheld”' },
  { itemType: 'In-house decoration labor', accountKey: 'decoration_account', account: '55200 Decoration Labor', posting: 'Debit / payroll reclass', control: 'Source: production time logs × labor rate; offset/cadence pending' },
  { itemType: 'In-house art labor', accountKey: 'in_house_art_account', account: '55400 In House Art', posting: 'Debit / payroll reclass', control: 'Source: art time logs × labor rate; offset/cadence pending' },
  { itemType: 'Customer payment received', accountKey: 'payment_deposit_account', account: '11010 Undeposited Funds', posting: 'Debit', control: '11000 A/R credit' },
  { itemType: 'OrderMyGear net bank deposit', accountKey: 'operating_bank_account', account: '10100 First Foundation Checking (configurable)', posting: 'Debit', control: 'One completed statement ID/date; gross less both withheld fees; refunds currently block posting' },
  { itemType: 'Customer discount', accountKey: 'discount_account', account: '40200 Sales:Discounts', posting: 'Debit / negative revenue', control: '11000 A/R' },
  { itemType: 'State sales tax', accountKey: 'state tax mapping', account: '25200–25230 state subaccounts', posting: 'Credit', control: 'Portal amount; QBO TaxCode mapping required' },
  { itemType: 'Quarterly sales-tax payment', accountKey: 'state tax mapping', account: 'Individual state subaccount', posting: 'Debit', control: 'Bank credit — workflow not yet implemented' },
]);
