import { buildQBInvoicePostingLines, buildQBInvoiceTaxPlan, buildQBInvoiceTxnTaxDetail, portalSalesTaxItemName, qbResponseErrorDetail } from '../qbSyncEngine';

describe('QuickBooks invoice account routing', () => {
  test('posts ordinary sales entirely to the 40000-linked item', () => {
    expect(buildQBInvoicePostingLines({
      invoice:{total:100},salesItemId:'sales-item',discountAccountRef:{value:'discount-40200'},description:'INV-1',
    })).toEqual([{
      DetailType:'SalesItemLineDetail',Amount:100,Description:'INV-1',
      SalesItemLineDetail:{Qty:1,UnitPrice:100,ItemRef:{value:'sales-item',name:'NSA Portal Sales'}},
    }]);
  });

  test('posts the gross sale to 40000 and the customer credit to 40200', () => {
    const lines=buildQBInvoicePostingLines({
      invoice:{total:90,credit_amount:10},salesItemId:'sales-item',discountAccountRef:{value:'discount-40200'},description:'INV-2',
    });
    expect(lines).toEqual([
      {DetailType:'SalesItemLineDetail',Amount:100,Description:'INV-2',SalesItemLineDetail:{Qty:1,UnitPrice:100,ItemRef:{value:'sales-item',name:'NSA Portal Sales'}}},
      {DetailType:'DiscountLineDetail',Amount:10,Description:'Customer discount / credit — 40200',DiscountLineDetail:{PercentBased:false,DiscountAccountRef:{value:'discount-40200'}}},
    ]);
  });

  test('fails closed when a discount lacks the approved account', () => {
    expect(()=>buildQBInvoicePostingLines({invoice:{total:90,credit_amount:10},salesItemId:'sales-item'}))
      .toThrow(/40200 Discounts account is required/i);
  });
});

// Live shape: INV-63848 — total 3083.20 = 2710.50 taxable + 237.17 tax (8.75%) + 135.53 untaxed shipping.
const taxCodes=[{Id:'TC-CA',Name:'CA Sales Tax',Active:true,SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'TR-CA'}}]}},
  {Id:'TC-OLD',Name:'Old CA',Active:false,SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'TR-CA-OLD'}}]}}];
const taxRateMap={CA:'TR-CA'};

describe('QuickBooks invoice sales tax plan', () => {
  test('reconciles the portal tax against the rate with shipping untaxed', () => {
    const plan=buildQBInvoiceTaxPlan({invoice:{total:3083.2,tax:237.17,tax_rate:0.0875,shipping:135.53},state:'ca',taxRateMap,taxCodes});
    expect(plan).toEqual({state:'CA',tax:237.17,taxable:2710.5,shipping:135.53,shippingTaxable:false,taxCodeId:'TC-CA',rateId:'TR-CA',taxLine:false,taxAccountKey:'',reconciled:true,expectedTax:237.17,ratePct:'8.75'});
    expect(buildQBInvoiceTxnTaxDetail(plan)).toEqual({TxnTaxCodeRef:{value:'TC-CA'},TotalTax:237.17,
      TaxLine:[{Amount:237.17,DetailType:'TaxLineDetail',TaxLineDetail:{TaxRateRef:{value:'TR-CA'},PercentBased:false,NetAmountTaxable:2710.5}}]});
  });

  test('detects taxed shipping when only that base reconciles', () => {
    // 100 goods + 10 shipping, taxed at 7.75% on both = 8.53
    const plan=buildQBInvoiceTaxPlan({invoice:{total:118.53,tax:8.53,tax_rate:0.0775,shipping:10},state:'CA',taxRateMap,taxCodes});
    expect(plan).toEqual(expect.objectContaining({taxable:110,shippingTaxable:true}));
  });

  test('returns null for untaxed invoices and fails closed on every mismatch', () => {
    expect(buildQBInvoiceTaxPlan({invoice:{total:100,tax:0},state:'CA',taxRateMap,taxCodes})).toBeNull();
    const good={invoice:{total:107.75,tax:7.75,tax_rate:0.0775,shipping:0},state:'CA',taxRateMap,taxCodes};
    expect(buildQBInvoiceTaxPlan(good)).toEqual(expect.objectContaining({taxable:100}));
    // Under AST the plan no longer refuses: the tax posts as a line against the
    // state's liability account, with no QBO tax code or manual rate involved.
    expect(buildQBInvoiceTaxPlan({...good,partnerTaxEnabled:true})).toEqual(expect.objectContaining({taxable:100,taxLine:true,taxAccountKey:'tax_ca_account',taxCodeId:'',rateId:''}));
    expect(()=>buildQBInvoiceTaxPlan({...good,state:'OR'})).toThrow(/no approved sales-tax account/);
    expect(()=>buildQBInvoiceTaxPlan({...good,state:'WA'})).toThrow(/no verified QuickBooks tax rate for WA/);
    expect(()=>buildQBInvoiceTaxPlan({...good,taxCodes:[]})).toThrow(/was not found or is inactive/);
    expect(()=>buildQBInvoiceTaxPlan({...good,taxCodes:[...taxCodes,{...taxCodes[0],Id:'TC-DUP'}]})).toThrow(/more than one/);
    expect(()=>buildQBInvoiceTaxPlan({...good,invoice:{...good.invoice,tax_rate:null}})).toThrow(/no tax rate/);
    expect(()=>buildQBInvoiceTaxPlan({...good,invoice:{...good.invoice,tax:9}})).toThrow(/does not reconcile/);
  });

  test('posts total minus tax to 40000, shipping on its own untaxed line, and tax through TxnTaxDetail', () => {
    const invoice={total:3083.2,tax:237.17,tax_rate:0.0875,shipping:135.53};
    const taxPlan=buildQBInvoiceTaxPlan({invoice,state:'CA',taxRateMap,taxCodes});
    const lines=buildQBInvoicePostingLines({invoice,salesItemId:'sales-item',discountAccountRef:{value:'discount-40200'},description:'INV-63848',taxPlan});
    expect(lines).toEqual([
      {DetailType:'SalesItemLineDetail',Amount:2710.5,Description:'INV-63848',SalesItemLineDetail:{Qty:1,UnitPrice:2710.5,ItemRef:{value:'sales-item',name:'NSA Portal Sales'},TaxCodeRef:{value:'TAX'}}},
      {DetailType:'SalesItemLineDetail',Amount:135.53,Description:'Customer shipping',SalesItemLineDetail:{Qty:1,UnitPrice:135.53,ItemRef:{value:'sales-item',name:'NSA Portal Sales'},TaxCodeRef:{value:'NON'}}},
    ]);
    expect(lines.reduce((sum,line)=>sum+line.Amount,0)+taxPlan.tax).toBeCloseTo(3083.2,2);
  });

  test('leaves untaxed invoices in their one-line shape', () => {
    expect(buildQBInvoicePostingLines({invoice:{total:100,shipping:10},salesItemId:'sales-item',description:'INV-9'})).toHaveLength(1);
  });
});

describe('Automated Sales Tax — tax as a liability line', () => {
  // 8.75% on 2710.51 = 237.17; total 3083.20 includes tax, shipping 135.53 untaxed.
  const inv={total:3083.20,tax:237.17,tax_rate:0.0875,shipping:135.53};
  const plan=()=>buildQBInvoiceTaxPlan({invoice:inv,state:'CA',partnerTaxEnabled:true});

  test('plans a tax line against the state liability account, no tax code', () => {
    expect(plan()).toMatchObject({state:'CA',tax:237.17,taxable:2710.5,shippingTaxable:false,taxLine:true,taxAccountKey:'tax_ca_account',taxCodeId:'',rateId:''});
  });

  test('sends no TxnTaxDetail — the tax is a line, QBO must add nothing', () => {
    expect(buildQBInvoiceTxnTaxDetail(plan())).toBeNull();
  });

  test('posts every line NON plus a tax line on the state item, summing to the portal total', () => {
    const lines=buildQBInvoicePostingLines({invoice:inv,salesItemId:'sales',description:'INV-63848',taxPlan:plan(),taxItemId:'tax-ca'});
    expect(lines.map(l=>l.SalesItemLineDetail.TaxCodeRef.value)).toEqual(['NON','NON','NON']);
    expect(lines[0]).toMatchObject({Amount:2710.5,SalesItemLineDetail:{ItemRef:{value:'sales'}}});
    expect(lines[1]).toMatchObject({Amount:135.53,Description:'Customer shipping'});
    expect(lines[2]).toMatchObject({Amount:237.17,SalesItemLineDetail:{ItemRef:{value:'tax-ca',name:'NSA Portal Sales Tax — CA'}}});
    expect(lines[2].Description).toBe('Sales tax — CA 8.75% on $2710.50');
    const sum=Math.round(lines.reduce((a,l)=>a+l.Amount,0)*100)/100;
    expect(sum).toBe(3083.20);
  });

  test('refuses to post a tax line without the state item', () => {
    expect(()=>buildQBInvoicePostingLines({invoice:inv,salesItemId:'sales',description:'x',taxPlan:plan()}))
      .toThrow(/sales-tax item for CA is required/);
  });

  test('posts a non-reconciling tax as collected and flags it, instead of refusing', () => {
    // INV-1029 shape: stored tax does not equal rate × base. What was collected is what is owed.
    const drifted={total:1000,tax:29.51,tax_rate:0.0975,shipping:0};
    const p=buildQBInvoiceTaxPlan({invoice:drifted,state:'CA',partnerTaxEnabled:true});
    expect(p).toMatchObject({tax:29.51,taxLine:true,reconciled:false,ratePct:'9.75'});
    expect(p.expectedTax).toBe(94.62); // 9.75% of 970.49
    const lines=buildQBInvoicePostingLines({invoice:drifted,salesItemId:'sales',description:'INV-1029',taxPlan:p,taxItemId:'tax-ca'});
    expect(lines[1].Amount).toBe(29.51);
    expect(lines[1].Description).toBe('Sales tax — CA (as collected)');
    expect(Math.round(lines.reduce((a,l)=>a+l.Amount,0)*100)/100).toBe(1000);
  });

  test('a reconciling line-mode tax still carries the rate × base description', () => {
    expect(plan()).toMatchObject({reconciled:true,ratePct:'8.75'});
  });

  test('manual mode still refuses a tax that does not reconcile', () => {
    const manual={Id:'9',Name:'CA Sales Tax',Taxable:true,Active:true,SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'77'}}]}};
    expect(()=>buildQBInvoiceTaxPlan({invoice:{...inv,tax:999.99},state:'CA',taxRateMap:{CA:'77'},taxCodes:[manual],partnerTaxEnabled:false}))
      .toThrow(/does not reconcile/);
  });

  test('still refuses a state with no approved sales-tax account', () => {
    expect(()=>buildQBInvoiceTaxPlan({invoice:inv,state:'SD',partnerTaxEnabled:true})).toThrow(/no approved sales-tax account/);
  });

  test('leaves the manual-rate path untouched when AST is off', () => {
    const manual={Id:'9',Name:'CA Sales Tax',Taxable:true,Active:true,SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'77'}}]}};
    const p=buildQBInvoiceTaxPlan({invoice:inv,state:'CA',taxRateMap:{CA:'77'},taxCodes:[manual],partnerTaxEnabled:false});
    expect(p).toMatchObject({taxCodeId:'9',rateId:'77',taxLine:false});
    expect(buildQBInvoiceTxnTaxDetail(p).TaxLine).toHaveLength(1);
    const lines=buildQBInvoicePostingLines({invoice:inv,salesItemId:'sales',description:'x',taxPlan:p});
    expect(lines).toHaveLength(2);
    expect(lines[0].SalesItemLineDetail.TaxCodeRef.value).toBe('TAX');
  });

  test('names the item per state', () => {
    expect(portalSalesTaxItemName('ca')).toBe('NSA Portal Sales Tax — CA');
    expect(portalSalesTaxItemName(' wa ')).toBe('NSA Portal Sales Tax — WA');
  });
});

describe('QBO error surfacing', () => {
  test('prefers Detail, and names the fault code', () => {
    expect(qbResponseErrorDetail({Fault:{Error:[{Detail:'Tax code invalid',Message:'Business Validation Error',code:'6000'}]}}))
      .toBe('Tax code invalid [code 6000]');
  });

  test('falls back to Message when Detail is absent', () => {
    expect(qbResponseErrorDetail({Fault:{Error:[{Message:'Business Validation Error',code:'6000'}]}}))
      .toBe('Business Validation Error [code 6000]');
  });

  test('hands back the raw response rather than a bare "unknown"', () => {
    const out=qbResponseErrorDetail({Invoice:null,warnings:['AST override rejected']});
    expect(out).toMatch(/^unknown — QBO returned: /);
    expect(out).toContain('AST override rejected');
  });

  test('still returns the plain fallback when there is nothing to report', () => {
    expect(qbResponseErrorDetail({})).toBe('unknown');
    expect(qbResponseErrorDetail(null)).toBe('unknown');
  });
});
