import { buildQBInvoicePostingLines } from '../qbSyncEngine';

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

describe('taxable invoice posting (Automated Sales Tax)', () => {
  const taxCodeRef={value:'7',name:'California'};

  test('carves tax out of the total so 40000 receives only pre-tax revenue', () => {
    // Portal invoice INV-63788: total 681.05 INCLUDES 57.87 tax.
    const lines=buildQBInvoicePostingLines({
      invoice:{total:681.05,tax:57.87},salesItemId:'sales-item',
      discountAccountRef:{value:'discount-40200'},description:'INV-63788',taxCodeRef,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].Amount).toBe(623.18);
    expect(lines[0].SalesItemLineDetail.UnitPrice).toBe(623.18);
    expect(lines[0].SalesItemLineDetail.TaxCodeRef).toEqual(taxCodeRef);
    // Pre-tax revenue plus the tax QBO is told to post must reconstruct the portal total.
    expect(Math.round((lines[0].Amount+57.87)*100)/100).toBe(681.05);
  });

  test('carves tax out before adding the credit back for gross sales', () => {
    const lines=buildQBInvoicePostingLines({
      invoice:{total:110,tax:10,credit_amount:25},salesItemId:'sales-item',
      discountAccountRef:{value:'discount-40200'},description:'INV-3',taxCodeRef,
    });
    expect(lines[0].Amount).toBe(125); // (110 − 10) + 25
    expect(lines[1].Amount).toBe(25);
  });

  test('fails closed when a taxable invoice has no resolved tax code', () => {
    expect(()=>buildQBInvoicePostingLines({
      invoice:{total:681.05,tax:57.87},salesItemId:'sales-item',
      discountAccountRef:{value:'discount-40200'},description:'INV-4',
    })).toThrow(/tax code is required/i);
  });

  test('fails closed when tax would consume the whole invoice', () => {
    expect(()=>buildQBInvoicePostingLines({
      invoice:{total:50,tax:50},salesItemId:'sales-item',description:'INV-5',taxCodeRef,
    })).toThrow(/tax cannot equal or exceed/i);
  });

  test('leaves non-taxable invoices byte-identical to the pre-tax behaviour', () => {
    expect(buildQBInvoicePostingLines({
      invoice:{total:100,tax:0},salesItemId:'sales-item',description:'INV-6',
    })).toEqual([{
      DetailType:'SalesItemLineDetail',Amount:100,Description:'INV-6',
      SalesItemLineDetail:{Qty:1,UnitPrice:100,ItemRef:{value:'sales-item',name:'NSA Portal Sales'}},
    }]);
  });
});
