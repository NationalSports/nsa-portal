import { rotatingBatch } from '../qbSyncEngine';

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
