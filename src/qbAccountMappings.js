// Single source of truth for every QuickBooks account used by the portal.
// Values are account numbers (AcctNum), not display names. Account numbers are
// stable across renamed accounts and let us fail closed instead of guessing.

export const QB_ACCOUNT_SPECS = Object.freeze({
  income_account: Object.freeze({ number: '40000', name: 'Sales', types: ['Income'] }),
  cogs_account: Object.freeze({ number: '50000', name: 'Cost of Goods Sold', types: ['Cost of Goods Sold'] }),
  purchases_account: Object.freeze({ number: '51300', name: 'Purchases', types: ['Expense'] }),
  freight_account: Object.freeze({ number: '51000', name: 'Cost of Goods Sold:Freight In', types: ['Cost of Goods Sold'] }),
  sports_inc_fee_account: Object.freeze({ number: '58000', name: 'Sports Inc Fee', types: ['Cost of Goods Sold'] }),
  deco_account: Object.freeze({ number: '52000', name: 'Outside Decoration', types: ['Cost of Goods Sold'] }),
  inventory_asset_account: Object.freeze({ number: '12000', name: 'Inventory Asset', types: ['Other Current Asset'] }),
  inventory_adjustment_account: Object.freeze({ number: '52400', name: 'Inventory Loss', types: ['Expense'] }),
  ar_account: Object.freeze({ number: '11000', name: 'Accounts Receivable (A/R)', types: ['Accounts Receivable'] }),
  payment_deposit_account: Object.freeze({ number: '11010', name: 'Undeposited Funds', types: ['Other Current Asset'] }),
  ap_account: Object.freeze({ number: '21100', name: 'Accounts Payable (A/P)', types: ['Accounts Payable'] }),
  tax_account: Object.freeze({ number: '25201', name: 'Sales Tax Payables', types: ['Other Current Liability'] }),
});

export const QB_ACCOUNT_MAPPING_DEFAULTS = Object.freeze(
  Object.fromEntries(Object.entries(QB_ACCOUNT_SPECS).map(([key, spec]) => [key, spec.number]))
);

const LEGACY_MAPPING_VALUES = Object.freeze({
  Sales: '40000',
  'Sales of Product Income': '40000',
  'Cost of Goods Sold': '50000',
  Purchases: '51300',
  'Shipping and delivery expense': '51000',
  'Freight In': '51000',
  'Sports Inc Fee': '58000',
  'Subcontractor - Decoration': '52000',
  'Outside Decoration': '52000',
  'Inventory Asset': '12000',
  'Inventory Loss': '52400',
  'Accounts Receivable': '11000',
  'Accounts Receivable (A/R)': '11000',
  'Undeposited Funds': '11010',
  'Accounts Payable': '21100',
  'Accounts Payable (A/P)': '21100',
  'Sales Tax Payable': '25201',
  'Sales Tax Payables': '25201',
});

const norm = value => String(value == null ? '' : value).trim().toLowerCase();
const money = value => Math.round((Number(value) || 0) * 100) / 100;

export function migrateQBAccountMapping(mapping = {}) {
  const migrated = { ...QB_ACCOUNT_MAPPING_DEFAULTS };
  for (const [key, value] of Object.entries(mapping || {})) {
    const clean = String(value == null ? '' : value).trim();
    if (!clean) continue;
    migrated[key] = LEGACY_MAPPING_VALUES[clean] || clean;
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

// Builds posting lines for a parsed supplier bill and asserts that every cent of
// the document total is categorized. A discrepancy blocks the bill.
export function buildVendorBillLines(bill, accountRefs) {
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
    lines.push(expenseLine(
      merchandise,
      `Merchandise — PO ${po}${Array.isArray(bill.items) && bill.items.length ? ` (${bill.items.length} items)` : ''}`,
      accountRefs.purchases_account
    ));
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
  { itemType: 'Vendor merchandise', accountKey: 'purchases_account', account: '51300 Purchases', posting: 'Debit (Expense)', control: '21100 A/P credit' },
  { itemType: 'Vendor freight on a bill', accountKey: 'freight_account', account: '51000 Freight In', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Outside decoration vendor bill', accountKey: 'deco_account', account: '52000 Outside Decoration', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Sports Inc fee', accountKey: 'sports_inc_fee_account', account: '58000 Sports Inc Fee', posting: 'Debit', control: '21100 A/P credit' },
  { itemType: 'Inventory item cost on sale', accountKey: 'cogs_account', account: '50000 Cost of Goods Sold', posting: 'Debit', control: '12000 Inventory Asset credit' },
  { itemType: 'Inventory asset', accountKey: 'inventory_asset_account', account: '12000 Inventory Asset', posting: 'Asset', control: 'Inventory items' },
  { itemType: 'Inventory adjustment / shrinkage', accountKey: 'inventory_adjustment_account', account: '52400 Inventory Loss', posting: 'Debit/Credit', control: '12000 Inventory Asset' },
  { itemType: 'Customer payment deposit', accountKey: 'payment_deposit_account', account: '11010 Undeposited Funds', posting: 'Debit', control: '11000 A/R credit' },
  { itemType: 'Quarterly sales-tax payment', accountKey: 'tax_account', account: '25201 Sales Tax Payables', posting: 'Debit', control: 'Bank credit — workflow not yet implemented' },
]);
