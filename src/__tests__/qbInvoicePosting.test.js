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
