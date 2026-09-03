import {
  QB_ACCOUNT_MAPPING_DEFAULTS,
  QB_ACCOUNT_POSTING_MATRIX,
  QB_STATE_TAX_ACCOUNT_KEYS,
  aggregateBillItemsBySku,
  buildVendorBillLines,
  calculateOmgInvoicePayment,
  calculateCustomerShipping,
  buildInternalLaborCostManifest,
  buildOmgBankDeposit,
  findUniqueVendorMatch,
  getOmgFeeSource,
  indexQBNonInventoryItems,
  isDecorationVendorBill,
  loadAllQBEntities,
  loadQBAccounts,
  mapBillItemsToPortalSkus,
  manualBillAccountKey,
  migrateQBAccountMapping,
  parseQBDateValue,
  parseOmgDepositStatements,
  qbWriteAccountRef,
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
  test('retries one failed account read instead of treating it as an empty chart', async () => {
    const qbApi=jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({QueryResponse:{Account:accounts}});
    await expect(loadQBAccounts(qbApi)).resolves.toEqual(accounts);
    expect(qbApi).toHaveBeenCalledTimes(2);
  });

  test('reports a repeated QBO timeout instead of claiming an account is missing', async () => {
    const qbApi=jest.fn().mockResolvedValue({__qbTransportError:true,status:504,error:'QBO request timed out.'});
    await expect(loadQBAccounts(qbApi)).rejects.toThrow(/account query failed after one retry.*timed out.*No transaction was sent/i);
    expect(qbApi).toHaveBeenCalledTimes(2);
  });

  test('does not turn a malformed entity response into a legitimate empty page', async () => {
    const qbApi=jest.fn().mockResolvedValue({});
    await expect(loadAllQBEntities(qbApi,'Term','Id, Name',1000))
      .rejects.toThrow(/Term query page 1 failed after one retry.*no usable response/i);
    expect(qbApi).toHaveBeenCalledTimes(2);
  });

  test('accepts a valid empty QBO query response without retrying', async () => {
    const qbApi=jest.fn().mockResolvedValue({QueryResponse:{}});
    await expect(loadAllQBEntities(qbApi,'Term','Id, Name',1000)).resolves.toEqual([]);
    expect(qbApi).toHaveBeenCalledTimes(1);
  });

  test('does not retry a logical QBO fault', async () => {
    const qbApi=jest.fn().mockResolvedValue({Fault:{Error:[{Detail:'Invalid query syntax'}]}});
    await expect(loadQBAccounts(qbApi)).rejects.toThrow('Invalid query syntax');
    expect(qbApi).toHaveBeenCalledTimes(1);
  });

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
      omg_fee_account: '57000', omg_card_fee_account: '71400', operating_bank_account: '10100',
      ar_account: '11000', ap_account: '21100', tax_parent_account: '25201',
    });
    expect(QB_ACCOUNT_MAPPING_DEFAULTS.decoration_account).toBe('55200');
    expect(QB_ACCOUNT_MAPPING_DEFAULTS.outbound_freight_account).toBe('40100');
    expect(migrateQBAccountMapping({decoration_account:'55100'}).decoration_account).toBe('55200');
    expect(migrateQBAccountMapping({outbound_freight_account:'67000'}).outbound_freight_account).toBe('40100');
    expect(QB_STATE_TAX_ACCOUNT_KEYS).toEqual({
      CA: 'tax_ca_account', AZ: 'tax_az_account', CO: 'tax_co_account',
      NV: 'tax_nv_account', TX: 'tax_tx_account', WA: 'tax_wa_account',
    });
  });

  test('keeps in-house labor accounts reference-only', () => {
    const laborRows = QB_ACCOUNT_POSTING_MATRIX.filter(row =>
      ['decoration_account', 'in_house_art_account'].includes(row.accountKey)
    );
    expect(laborRows).toHaveLength(2);
    laborRows.forEach(row => {
      expect(row.posting).toBe('Reference only — not posted');
      expect(row.control).toMatch(/does not post daily labor/i);
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
    expect(isDecorationVendorBill({supplier:'ABC Decoration Services'},vendors)).toBe(false);
  });

  test('matches only one normalized legal vendor name and blocks ambiguity', () => {
    expect(findUniqueVendorMatch('Acme Sports, LLC', [{id:'v1',name:'ACME SPORTS INC.'}]).id).toBe('v1');
    expect(findUniqueVendorMatch('Acme Sports', [{id:'v1',name:'Acme Sportswear'}])).toBeNull();
    expect(()=>findUniqueVendorMatch('Acme Sports', [
      {id:'v1',name:'Acme Sports LLC'},
      {id:'v2',name:'Acme Sports, Inc.'},
    ])).toThrow(/Multiple active portal vendors/i);
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
    expect(result.lines.slice(1).every(line => !('accountNumber' in line.AccountBasedExpenseLineDetail.AccountRef)))
      .toBe(true);
  });

  test('posts a matched SanMar line with the portal SKU instead of the vendor catalog number', () => {
    const rawItems = [{
      sku: '1220314', desc: 'LNEA500. NE Lds French Try Plo', size: 'L', qty: 1,
      unit_price: 25.86, extension: 25.86,
    }];
    const mapped = mapBillItemsToPortalSkus(rawItems, [
      { bill_idx: 0, sku: 'LNEA500', allocated_qty: 1 },
    ]);
    expect(mapped[0]).toMatchObject({ sku: 'LNEA500', qty: 1, extension: 25.86 });

    const result = buildVendorBillLines({
      kind: 'goods', po_number: 'PO 58892 AMAV', merchandise_total: 25.86,
      freight: 19.75, si_upcharge: 0.37, doc_total: 45.98, items: mapped,
    }, refs, { LNEA500: { value: 'qbo-lnea500', name: 'LNEA500' } });
    expect(result.lines[0]).toMatchObject({
      Amount: 25.86,
      ItemBasedExpenseLineDetail: { ItemRef: { value: 'qbo-lnea500', name: 'LNEA500' }, Qty: 1 },
    });
  });

  test('uses the review SKU resolver without a saved tie and blocks conflicting accepted ties', () => {
    expect(mapBillItemsToPortalSkus([
      { sku: '1220314', desc: 'LNEA500. NE Lds French Try Plo' },
    ])[0].sku).toBe('LNEA500');
    expect(() => mapBillItemsToPortalSkus([{ sku: '1220314' }], [
      { bill_idx: 0, sku: 'LNEA500', allocated_qty: 1 },
      { bill_idx: 0, sku: 'PC61', allocated_qty: 1 },
    ])).toThrow(/multiple portal SKUs/i);
  });

  test('removes portal-only account metadata from QBO write references', () => {
    expect(qbWriteAccountRef({value:146,name:'Accounts Payable',accountNumber:'21100'}))
      .toEqual({value:'146'});
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

  test('keeps enough rate precision for a non-even weighted cost to round back to the bill amount', () => {
    const result=buildVendorBillLines({kind:'goods',merchandise_total:10,doc_total:10,items:[
      {sku:'A',qty:3,unit_price:10/3,extension:10},
    ]},refs,itemRefs);
    const detail=result.lines[0].ItemBasedExpenseLineDetail;
    expect(detail.UnitPrice).toBe(3.333333);
    expect(Math.round(detail.Qty*detail.UnitPrice*100)/100).toBe(10);
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

describe('required QBO dates', () => {
  test('converts supported dates and rejects blanks or impossible calendar dates', () => {
    expect(parseQBDateValue('2026-08-23T09:15:00')).toBe('2026-08-23');
    expect(parseQBDateValue('8/23/26')).toBe('2026-08-23');
    expect(parseQBDateValue('')).toBeNull();
    expect(parseQBDateValue('2026-02-30')).toBeNull();
    expect(parseQBDateValue('13/10/2026')).toBeNull();
  });
});

describe('OMG and internal labor source routing', () => {
  const statementText=`
                           National Sports Apparel LLC                                                      Deposit Statement
                           2238 North Glasell Avenue Suite E
                           Orange, CA 92865                                                                     MRBHQRB6G

                                                     Statement Date                     08/18/26     Total Collected                   $8,963.02
                                                     Deposit Status                   completed      OMG Fee Withheld                   ($369.90)
                                                     Bank Account FIRST FOUNDATION BANK - 7609       Processing Fee Withheld            ($288.81)
                                                     Stores Included                          28     Net Amount                     $8,304.31

  08/17/26        Payment          188425518       Store A          $21.75      ($0.83)      ($0.93)      $19.99
  08/17/26        Refund           185660853       Store B        ($114.74)       $4.36        $3.43    ($106.95)
  `;

  test('parses one completed multi-store OMG statement into one reconciled bank-deposit manifest', () => {
    expect(parseOmgDepositStatements(statementText)).toEqual([{
      sourceKey:'NSA-OMG-DEPOSIT:MRBHQRB6G',
      statementId:'MRBHQRB6G',
      statementDate:'2026-08-18',
      depositStatus:'completed',
      bankAccount:'FIRST FOUNDATION BANK - 7609',
      storesIncluded:28,
      totalCollected:8963.02,
      omgFeeWithheld:369.9,
      processingFeeWithheld:288.81,
      netAmount:8304.31,
      refundCount:1,
      hasRefunds:true,
    }]);
  });

  test('rejects a statement whose collected amount, fees, and net do not reconcile', () => {
    expect(()=>parseOmgDepositStatements(statementText.replace('$8,304.31','$8,304.30')))
      .toThrow(/does not reconcile/i);
  });

  test('routes Deposit Statement OMG Fee Withheld to approved 57000 mapping', () => {
    expect(getOmgFeeSource({source:'omg',id:'store-1',_omg_deposit_statement_id:'MRBHQRB6G',_omg_omg_fees:123.45}))
      .toMatchObject({
        sourceType:'omg_deposit_statement_withheld_fee',sourceId:'MRBHQRB6G',amount:123.45,
        accountKey:'omg_fee_account',blocked:false,
      });
    expect(getOmgFeeSource({source:'webstore',id:'native-1',_omg_omg_fees:123.45})).toBeNull();
    expect(getOmgFeeSource({source:'omg',id:'store-2',_omg_omg_fees:0})).toBeNull();
  });

  test('applies gross OMG collections to the invoice instead of netting fees against A/R', () => {
    expect(calculateOmgInvoicePayment(1000,1000)).toBe(1000);
    expect(calculateOmgInvoicePayment(1000,950)).toBe(950);
    expect(calculateOmgInvoicePayment(900,1000)).toBe(900);
    // Fees of $75 and $25 belong on the deposit; they do not reduce this payment to $900.
    expect(calculateOmgInvoicePayment(1000,1000)).not.toBe(1000-75-25);
    expect(()=>calculateOmgInvoicePayment(-1,1000)).toThrow(/cannot be negative/i);
  });

  test('builds a reconciled OMG deposit with withheld OMG fees in 57000', () => {
    const result=buildOmgBankDeposit({
      sourceId:'OMG-REPORT-42',
      txnDate:'2026-08-23',
      payments:[{paymentId:'pmt-1',amount:600},{paymentId:'pmt-2',amount:400}],
      omgFee:75,
      cardFee:29.5,
      bankAccountRef:{value:'bank-configured'},
      omgWithheldFeeAccountRef:{value:'cogs-57000'},
      cardFeeAccountRef:{value:'expense-71400'},
      expectedCollected:1000,
      expectedNet:895.5,
      depositStatus:'completed',
    });
    expect(result).toMatchObject({
      sourceKey:'NSA-OMG-DEPOSIT:OMG-REPORT-42',gross:1000,totalFees:104.5,net:895.5,
      deposit:{
        TxnDate:'2026-08-23',
        DepositToAccountRef:{value:'bank-configured'},
        PrivateNote:'NSA-OMG-DEPOSIT:OMG-REPORT-42',
      },
    });
    expect(result.deposit.Line).toEqual([
      {Amount:600,LinkedTxn:[{TxnId:'pmt-1',TxnType:'Payment',TxnLineId:'0'}]},
      {Amount:400,LinkedTxn:[{TxnId:'pmt-2',TxnType:'Payment',TxnLineId:'0'}]},
      {Amount:-75,Description:'OrderMyGear fee withheld',DetailType:'DepositLineDetail',DepositLineDetail:{AccountRef:{value:'cogs-57000'}}},
      {Amount:-29.5,Description:'OrderMyGear processing fee withheld',DetailType:'DepositLineDetail',DepositLineDetail:{AccountRef:{value:'expense-71400'}}},
    ]);
    expect(result.deposit.Line.reduce((sum,line)=>sum+line.Amount,0)).toBe(result.net);
  });

  test('blocks unsafe, incomplete, refunded, or unreconciled OMG deposits before QBO', () => {
    const base={
      sourceId:'OMG-1',txnDate:'2026-08-23',payments:[{paymentId:'pmt-1',amount:100}],
      omgFee:5,cardFee:3,expectedCollected:100,expectedNet:92,depositStatus:'completed',
      bankAccountRef:{value:'bank'},omgWithheldFeeAccountRef:{value:'omg-withheld'},cardFeeAccountRef:{value:'card'},
    };
    expect(()=>buildOmgBankDeposit({...base,payments:[]})).toThrow(/at least one linked/i);
    expect(()=>buildOmgBankDeposit({...base,payments:[{paymentId:'',amount:100}]})).toThrow(/Payment ID/i);
    expect(()=>buildOmgBankDeposit({...base,payments:[{paymentId:'pmt-1',amount:60},{paymentId:'pmt-1',amount:40}]})).toThrow(/duplicate/i);
    expect(()=>buildOmgBankDeposit({...base,omgFee:-1})).toThrow(/cannot be negative/i);
    expect(()=>buildOmgBankDeposit({...base,omgFee:80,cardFee:20,expectedNet:0})).toThrow(/less than the gross/i);
    expect(()=>buildOmgBankDeposit({...base,bankAccountRef:null})).toThrow(/deposit bank/i);
    expect(()=>buildOmgBankDeposit({...base,txnDate:'08/23/2026'})).toThrow(/YYYY-MM-DD/i);
    expect(()=>buildOmgBankDeposit({...base,refundCount:1})).toThrow(/refund/i);
    expect(()=>buildOmgBankDeposit({...base,depositStatus:'pending'})).toThrow(/not completed/i);
    expect(()=>buildOmgBankDeposit({...base,expectedCollected:99})).toThrow(/Total Collected/i);
    expect(()=>buildOmgBankDeposit({...base,expectedNet:91})).toThrow(/Net Amount/i);
  });

  test('sources 55200 and 55400 manifests from their separate clocks and current labor rates', () => {
    const manifest=buildInternalLaborCostManifest({
      decorationLogs:[{person:'Dana',minutes:90,idleMinutes:10}],
      artLogs:[{person:'Alex',minutes:120,idleMinutes:15}],
      laborRates:{Dana:20,Alex:30},
    });
    expect(manifest.decoration).toEqual({sourceType:'job_time_logs',accountKey:'decoration_account',minutes:90,idleMinutes:10,amount:30,logCount:1});
    expect(manifest.inHouseArt).toEqual({sourceType:'art_time_logs',accountKey:'in_house_art_account',minutes:120,idleMinutes:15,amount:60,logCount:1});
  });

  test('does not create negative labor cost from bad minutes or rates', () => {
    const manifest=buildInternalLaborCostManifest({artLogs:[{person:'Alex',minutes:-5}],laborRates:{Alex:-20}});
    expect(manifest.inHouseArt.amount).toBe(0);
  });
});
