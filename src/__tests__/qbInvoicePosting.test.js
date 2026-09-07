import { buildQBInvoicePostingLines, buildQBInvoiceTaxPlan, buildQBInvoiceTxnTaxDetail, qbResponseErrorDetail } from '../qbSyncEngine';

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
    expect(plan).toEqual({state:'CA',tax:237.17,taxable:2710.5,shipping:135.53,shippingTaxable:false,taxCodeId:'TC-CA',rateId:'TR-CA',astOverride:false});
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
    expect(()=>buildQBInvoiceTaxPlan({...good,partnerTaxEnabled:true})).toThrow(/Automated Sales Tax/);
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

describe('Automated Sales Tax override plan', () => {
  const CUSTOM={Id:'5',Name:'CustomSalesTax',Taxable:true,Active:true};
  const TAX={Id:'1',Name:'TAX',Taxable:true,Active:true};
  const NON={Id:'2',Name:'NON',Taxable:false,Active:true};
  // 8.75% on 2710.51 = 237.17; total 3083.20 includes tax, shipping 135.53 untaxed.
  const inv={total:3083.20,tax:237.17,tax_rate:0.0875,shipping:135.53};

  test('routes the portal amount through CustomSalesTax when AST is on', () => {
    const plan=buildQBInvoiceTaxPlan({invoice:inv,state:'CA',taxCodes:[TAX,NON,CUSTOM],partnerTaxEnabled:true});
    expect(plan).toMatchObject({state:'CA',tax:237.17,taxCodeId:'5',astOverride:true,rateId:''});
    expect(plan.shippingTaxable).toBe(false);
  });

  test('omits TaxLine on an override — there is no manual rate to reference', () => {
    const plan=buildQBInvoiceTaxPlan({invoice:inv,state:'CA',taxCodes:[TAX,NON,CUSTOM],partnerTaxEnabled:true});
    expect(buildQBInvoiceTxnTaxDetail(plan)).toEqual({TxnTaxCodeRef:{value:'5'},TotalTax:237.17});
  });

  test('still reconciles the amount against the portal rate before posting', () => {
    expect(()=>buildQBInvoiceTaxPlan({
      invoice:{...inv,tax:999.99},state:'CA',taxCodes:[TAX,NON,CUSTOM],partnerTaxEnabled:true,
    })).toThrow(/does not reconcile/);
  });

  test('still refuses a state with no approved sales-tax account', () => {
    expect(()=>buildQBInvoiceTaxPlan({invoice:inv,state:'SD',taxCodes:[CUSTOM],partnerTaxEnabled:true}))
      .toThrow(/no approved sales-tax account/);
  });

  test('fails closed, naming what exists, when no CustomSalesTax code is there', () => {
    expect(()=>buildQBInvoiceTaxPlan({invoice:inv,state:'CA',taxCodes:[TAX,NON],partnerTaxEnabled:true}))
      .toThrow(/no CustomSalesTax code was found.*TAX #1/s);
  });

  test('leaves the manual-rate path untouched when AST is off', () => {
    const manual={Id:'9',Name:'CA Sales Tax',Taxable:true,Active:true,
      SalesTaxRateList:{TaxRateDetail:[{TaxRateRef:{value:'77'}}]}};
    const plan=buildQBInvoiceTaxPlan({invoice:inv,state:'CA',taxRateMap:{CA:'77'},taxCodes:[manual],partnerTaxEnabled:false});
    expect(plan).toMatchObject({taxCodeId:'9',rateId:'77',astOverride:false});
    expect(buildQBInvoiceTxnTaxDetail(plan).TaxLine).toHaveLength(1);
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
