import {
  QB_ACCOUNT_MAPPING_DEFAULTS,
  buildVendorBillLines,
  isDecorationVendorBill,
  manualBillAccountKey,
  migrateQBAccountMapping,
  resolveQBAccount,
} from '../qbAccountMappings';

const account = (Id, AcctNum, Name, AccountType, extra = {}) => ({
  Id, AcctNum, Name, FullyQualifiedName: Name, AccountType, Active: true, ...extra,
});

const accounts = [
  account('sales', '40000', 'Sales', 'Income'),
  account('cogs', '50000', 'Cost of Goods Sold', 'Cost of Goods Sold'),
  account('purchases', '51300', 'Purchases', 'Expense'),
  account('freight', '51000', 'Cost of Goods Sold:Freight In', 'Cost of Goods Sold'),
  account('deco', '52000', 'Outside Decoration', 'Cost of Goods Sold'),
  account('si', '58000', 'Sports Inc Fee', 'Cost of Goods Sold'),
];

const refs = {
  purchases_account: { value: 'purchases' },
  freight_account: { value: 'freight' },
  deco_account: { value: 'deco' },
  sports_inc_fee_account: { value: 'si' },
};

describe('QuickBooks account resolution', () => {
  test('uses account number even when another account has a similar name', () => {
    const list = [account('wrong', '99999', 'Purchases', 'Cost of Goods Sold'), ...accounts];
    expect(resolveQBAccount(list, QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account').value).toBe('purchases');
  });

  test('migrates every legacy production mapping to the approved number', () => {
    expect(migrateQBAccountMapping({
      income_account: 'Sales', cogs_account: 'Cost of Goods Sold',
      deco_account: 'Subcontractor - Decoration', ar_account: 'Accounts Receivable',
      ap_account: 'Accounts Payable', tax_account: 'Sales Tax Payable',
    })).toMatchObject({
      income_account: '40000', cogs_account: '50000', purchases_account: '51300', deco_account: '52000',
      freight_account: '51000', sports_inc_fee_account: '58000',
      ar_account: '11000', ap_account: '21100', tax_account: '25201',
    });
  });

  test('never falls back to the first account when the configured account is missing', () => {
    expect(() => resolveQBAccount(accounts, { purchases_account: '59999' }, 'purchases_account'))
      .toThrow(/was not found.*No transaction was sent/i);
  });

  test('rejects an inactive account and a wrong account type', () => {
    expect(() => resolveQBAccount([
      account('inactive', '51300', 'Purchases', 'Expense', { Active: false }),
    ], QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account')).toThrow(/was not found/i);
    expect(() => resolveQBAccount([
      account('wrong-type', '51300', 'Purchases', 'Cost of Goods Sold'),
    ], QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account')).toThrow(/expected Expense/i);
  });

  test('rejects a duplicated account number instead of choosing one', () => {
    expect(() => resolveQBAccount([
      account('one', '51300', 'Purchases A', 'Expense'),
      account('two', '51300', 'Purchases B', 'Expense'),
    ], QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account')).toThrow(/is duplicated/i);
  });
});

describe('vendor bill adversarial routing', () => {
  test('classifies every active decoration-category vendor as 52000, with no inactive or substring false positives', () => {
    const vendors=[{id:'d1',name:'ABC Decoration',is_active:true},{id:'d2',name:'Old Decorator',is_active:false}];
    expect(manualBillAccountKey('deco:d1')).toBe('deco_account');
    expect(manualBillAccountKey('vendor:v1')).toBe('purchases_account');
    expect(isDecorationVendorBill({supplier:'ABC Decoration LLC'},vendors)).toBe(true);
    expect(isDecorationVendorBill({supplier:'Old Decorator'},vendors)).toBe(false);
    expect(isDecorationVendorBill({supplier:'ABC Apparel'},vendors)).toBe(false);
  });

  test('splits merchandise, freight, and Sports Inc fee to 51300/51000/58000', () => {
    const result = buildVendorBillLines({
      kind: 'goods', po_number: 'PO-1', merchandise_total: 100, freight: 12, si_upcharge: 0.8,
      doc_total: 112.8, items: [{ sku: 'A' }],
    }, refs);
    expect(result.lines.map(line => [line.Amount, line.AccountBasedExpenseLineDetail.AccountRef.value]))
      .toEqual([[100, 'purchases'], [12, 'freight'], [0.8, 'si']]);
  });

  test('routes a decoration-category vendor bill to 52000 and its freight to 51000', () => {
    const result = buildVendorBillLines({ kind: 'decoration', po_number: 'DPO-1', doc_total: 125, freight: 10 }, refs);
    expect(result.lines.map(line => [line.Amount, line.AccountBasedExpenseLineDetail.AccountRef.value]))
      .toEqual([[115, 'deco'], [10, 'freight']]);
  });

  test('derives missing merchandise only when the document total reconciles', () => {
    const result = buildVendorBillLines({ kind: 'goods', doc_total: 50, freight: 5, si_upcharge: 0.4 }, refs);
    expect(result.lines.map(line => line.Amount)).toEqual([44.6, 5, 0.4]);
  });

  test('blocks mismatched totals, credits, negative amounts, and zero-dollar bills', () => {
    expect(() => buildVendorBillLines({ kind: 'goods', merchandise_total: 100, freight: 5, doc_total: 120 }, refs)).toThrow(/lines total/i);
    expect(() => buildVendorBillLines({ kind: 'goods', is_credit: true, doc_total: -10 }, refs)).toThrow(/Credit memos/i);
    expect(() => buildVendorBillLines({ kind: 'goods', merchandise_total: 10, freight: -1, doc_total: 9 }, refs)).toThrow(/cannot be negative/i);
    expect(() => buildVendorBillLines({ kind: 'goods', doc_total: 0 }, refs)).toThrow(/no positive merchandise/i);
  });

  test('rounds cent-level floating point values before reconciliation', () => {
    const result = buildVendorBillLines({ kind: 'goods', merchandise_total: 0.1 + 0.2, doc_total: 0.3 }, refs);
    expect(result.total).toBe(0.3);
  });
});
