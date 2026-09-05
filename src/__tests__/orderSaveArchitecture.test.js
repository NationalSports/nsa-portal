import { decorationShrinkConflicts } from '../businessLogic';
import { lineIntentKey } from '../lib/orderLineIdentity';
import { canAcknowledgeSave } from '../lib/saveAcknowledgement';

test('removing six earlier lines never compares undecorated pants to a decorated polo',()=>{
 const skus=['JM5226','KE8824','KB9113','KD5431','IU2837','IQ2957','IP9746','IY8738'];
 const db=skus.map((sku,i)=>({id:i+1,line_id:'line-'+i,item_index:i,sku}));
 const counts=new Map(db.map((r,i)=>[r.id,i<4||i===7?1:0]));
 const pants=db.slice(4,6).map(({line_id,sku})=>({line_id,sku,decorations:[]}));
 expect(decorationShrinkConflicts(pants,db,counts,{})).toEqual([]);
 // Legacy outbox drafts are recoverable when garment identity is unambiguous.
 expect(decorationShrinkConflicts(pants.map(({line_id,...r})=>r),db,counts,{})).toEqual([]);
});

test('a decoration deletion follows its line through reorder, never its old slot',()=>{
 const db=[{id:1,line_id:'a',item_index:0,sku:'A'},{id:2,line_id:'b',item_index:1,sku:'B'}];
 const counts=new Map([[1,1],[2,1]]);
 const client=[{line_id:'b',sku:'B',decorations:[]},{line_id:'a',sku:'A',decorations:[{}]}];
 expect(decorationShrinkConflicts(client,db,counts,{'line:a':{from:1,to:0}})).toHaveLength(1);
 expect(decorationShrinkConflicts(client,db,counts,{'line:b':{from:1,to:0}})).toEqual([]);
 expect(lineIntentKey(client[0],0)).toBe('line:b');
});

test('same SKU/color in two lines remains distinguishable by line ID',()=>{
 const db=[{id:1,line_id:'a',item_index:0,sku:'A'},{id:2,line_id:'b',item_index:1,sku:'A'}];
 const client=[{line_id:'b',sku:'A',decorations:[]},{line_id:'a',sku:'A',decorations:[{}]}];
 expect(decorationShrinkConflicts(client,db,new Map([[1,1],[2,0]]),{})).toEqual([]);
});

test('only the current confirmed edit clears unsaved state',()=>{
 expect(canAcknowledgeSave(true,4,4,2,2)).toBe(true);
 for(const result of [false,undefined,null,'stale',{}])expect(canAcknowledgeSave(result,4,4,2,2)).toBe(false);
 expect(canAcknowledgeSave(true,4,5,2,2)).toBe(false); // typed during save
 expect(canAcknowledgeSave(true,4,4,2,3)).toBe(false); // newer attempt owns acknowledgement
});
