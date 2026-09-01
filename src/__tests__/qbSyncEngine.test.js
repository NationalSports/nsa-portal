import { groupPortalPurchaseOrders, rotatingBatch } from '../qbSyncEngine';

describe('QuickBooks rotating batches', () => {
  test('moves past a permanently blocked first batch', () => {
    const records=Array.from({length:45},(_,i)=>i+1);
    const first=rotatingBatch(records,0,20);
    const second=rotatingBatch(records,first.nextOffset,20);
    const third=rotatingBatch(records,second.nextOffset,20);
    expect(first.items).toEqual(Array.from({length:20},(_,i)=>i+1));
    expect(second.items).toEqual(Array.from({length:20},(_,i)=>i+21));
    expect(third.items.slice(0,5)).toEqual([41,42,43,44,45]);
  });

  test('wraps safely when successful records disappear between runs', () => {
    const first=rotatingBatch(Array.from({length:30},(_,i)=>i+1),0,20);
    const remaining=Array.from({length:10},(_,i)=>i+21);
    const second=rotatingBatch(remaining,first.nextOffset,20);
    expect(second.items).toEqual(remaining);
    expect(second.nextOffset).toBe(0);
  });

  test('handles invalid cursors without dropping records', () => {
    expect(rotatingBatch(['a','b','c'],Number.NaN,2)).toEqual({items:['a','b'],nextOffset:2});
    expect(rotatingBatch([],99,20)).toEqual({items:[],nextOffset:0});
  });
});

describe('QuickBooks purchase-order grouping', () => {
  const so=(id,poLines)=>({id,items:[{sku:'SKU-'+id,name:'Item '+id,brand:'Champro',po_lines:poLines}]});

  test('shows one preview/posting group for a PO spread across several source lines', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO 5550',S:2,created_at:'2026-09-01'}]),
      so('SO-2',[{po_id:'PO 5550',M:3,created_at:'2026-09-01'}]),
    ],{});
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({poId:'PO 5550',vendor:'Champro',accountKey:'purchases_account',invalidReason:''});
    expect(groups[0].entries).toHaveLength(2);
  });

  test('blocks a shared PO number that mixes vendors', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO MIXED',S:1,vendor:'Champro'}]),
      {...so('SO-2',[{po_id:'PO MIXED',M:1,vendor:'Adidas'}]),items:[{sku:'SKU-2',name:'Item 2',brand:'Adidas',po_lines:[{po_id:'PO MIXED',M:1}]}]},
    ],{});
    expect(groups[0].invalidReason).toBe('mixed vendors share this PO number');
  });

  test('blocks a shared PO number that mixes product and decoration routing', () => {
    const groups=groupPortalPurchaseOrders([
      so('SO-1',[{po_id:'PO MIXED',S:1}]),
      so('SO-2',[{po_id:'PO MIXED',M:1,po_type:'outside_deco',deco_vendor:'Champro'}]),
    ],{});
    expect(groups[0].invalidReason).toBe('merchandise and outside-decoration lines share this PO number');
  });
});
