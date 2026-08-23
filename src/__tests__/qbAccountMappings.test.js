import {
  QB_ACCOUNT_MAPPING_DEFAULTS,
  QB_STATE_TAX_ACCOUNT_KEYS,
  aggregateBillItemsBySku,
  buildVendorBillLines,
  calculateCustomerShipping,
  indexQBNonInventoryItems,
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
  account('purchases', '51300', 'Purchases', 'Cost of Goods Sold'),
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

const itemRefs = {
  A: { value: 'item-a', name: 'A' },
  B: { value: 'item-b', name: 'B' },
};

describe('QuickBooks account resolution', () => {
  test('uses account number even when another account has a similar name', () => {
    const list = [account('wrong', '99999', 'Purchases', 'Cost of Goods Sold'), ...accounts];
    expect(resolveQBAccount(list, QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account').value).toBe('purchases');
  });

  test('migrates every legacy production mapping to the approved number', () => {
    expect(migrateQBAccountMapping({
      income_account: 'Sales',
      deco_account: 'Subcontractor - Decoration', ar_account: 'Accounts Receivable',
      ap_account: 'Accounts Payable', tax_account: 'Sales Tax Payable',
    })).toMatchObject({
      income_account: '40000', purchases_account: '51300', deco_account: '52000',
      freight_account: '51000', sports_inc_fee_account: '58000',
      ar_account: '11000', ap_account: '21100', tax_parent_account: '25201',
    });
    expect(QB_STATE_TAX_ACCOUNT_KEYS).toEqual({
      CA: 'tax_ca_account', AZ: 'tax_az_account', CO: 'tax_co_account',
      NV: 'tax_nv_account', TX: 'tax_tx_account', WA: 'tax_wa_account',
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
      account('wrong-type', '51300', 'Purchases', 'Expense'),
    ], QB_ACCOUNT_MAPPING_DEFAULTS, 'purchases_account')).toThrow(/expected Cost of Goods Sold/i);
  });

  test('rejects a duplicated account number instead of choosing one', () => {
    expect(() => resolveQBAccount([
      account('one', '51300', 'Purchases A', 'Cost of Goods Sold'),
      account('two', '51300', 'Purchases B', 'Cost of Goods Sold'),
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

  test('aggregates bill sizes into one NonInventory line per SKU and splits freight/SI fee', () => {
    const result = buildVendorBillLines({
      kind: 'goods', po_number: 'PO-1', merchandise_total: 100, freight: 12, si_upcharge: 0.8,
      doc_total: 112.8,
      items: [
        { sku: 'A', size: 'S', qty: 2, unit_price: 20, extension: 40 },
        { sku: 'A', size: 'M', qty: 3, unit_price: 20, extension: 60 },
      ],
    }, refs, itemRefs);
    expect(result.lines[0]).toMatchObject({
      Amount: 100,
      ItemBasedExpenseLineDetail: { ItemRef: itemRefs.A, Qty: 5, UnitPrice: 20 },
    });
    expect(result.lines.slice(1).map(line => [line.Amount, line.AccountBasedExpenseLineDetail.AccountRef.value]))
      .toEqual([[12, 'freight'], [0.8, 'si']]);
  });

  test('uses weighted unit cost when a SKU has size upcharges but preserves the exact bill total', () => {
    const grouped = aggregateBillItemsBySku([
      { sku: 'A', size: 'XL', qty: 2, unit_price: 10, extension: 20 },
      { sku: 'a', size: '2XL', qty: 1, unit_price: 13, extension: 13 },
    ]);
    expect(grouped.skuItems).toEqual([{ sku: 'A', qty: 3, amount: 33, description: '' }]);
    const result = buildVendorBillLines({kind:'goods',merchandise_total:33,doc_total:33,items:[
      {sku:'A',size:'XL',qty:2,unit_price:10,extension:20},
      {sku:'A',size:'2XL',qty:1,unit_price:13,extension:13},
    ]}, refs, itemRefs);
    expect(result.lines[0].ItemBasedExpenseLineDetail).toMatchObject({Qty:3,UnitPrice:11});
  });

  test('indexes exact active NonInventory SKUs and rejects duplicate or wrong-type items', () => {
    expect(indexQBNonInventoryItems([{Id:'1',Name:'A',Sku:'a',Type:'NonInventory',Active:true}]).A.value).toBe('1');
    expect(() => indexQBNonInventoryItems([
      {Id:'1',Name:'A',Sku:'A',Type:'NonInventory',Active:true},
      {Id:'2',Name:'A duplicate',Sku:'a',Type:'NonInventory',Active:true},
    ])).toThrow(/duplicated/i);
    expect(() => indexQBNonInventoryItems([{Id:'1',Name:'A',Sku:'A',Type:'Inventory',Active:true}]))
      .toThrow(/expected NonInventory/i);
    expect(indexQBNonInventoryItems([
      {Id:'1',Name:'A',Sku:'A',Type:'NonInventory',Active:true},
      {Id:'2',Name:'Legacy inventory item',Sku:'OLD',Type:'Inventory',Active:true},
    ], ['A']).A.value).toBe('1');
    expect(() => indexQBNonInventoryItems([], ['MISSING'])).toThrow(/SKU MISSING was not found/i);
  });

  test('blocks a SKU bill when the QBO item is missing or merchandise totals disagree', () => {
    const bill={kind:'goods',merchandise_total:20,doc_total:20,items:[{sku:'A',qty:2,unit_price:10,extension:20}]};
    expect(() => buildVendorBillLines(bill, refs, {})).toThrow(/SKU A was not found/i);
    expect(() => buildVendorBillLines({...bill,merchandise_total:21,doc_total:21}, refs, itemRefs)).toThrow(/SKU lines total/i);
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

describe('customer shipping routing', () => {
  test('calculates percentage and flat shipping and includes a carried shipping charge once', () => {
    expect(calculateCustomerShipping({ shipping_type: 'pct', shipping_value: 5 }, 1000)).toBe(50);
    expect(calculateCustomerShipping({ shipping_type: 'flat', shipping_value: 25 }, 1000)).toBe(25);
    expect(calculateCustomerShipping({
      shipping_type: 'pct', shipping_value: 5, pending_ship_applied: true, pending_ship_amount: 12.34,
    }, 1000)).toBe(62.34);
  });

  test('blocks negative shipping instead of silently reducing sales', () => {
    expect(() => calculateCustomerShipping({ shipping_type: 'flat', shipping_value: -1 }, 100)).toThrow(/cannot be negative/i);
    expect(() => calculateCustomerShipping({ pending_ship_applied: true, pending_ship_amount: -1 }, 100)).toThrow(/cannot be negative/i);
  });
});
