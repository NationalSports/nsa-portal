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


test('EST-2434 reordered plain jerseys do not inherit the decorated 462900 line count',()=>{
 const db=['R095ZX','R095ZX','462900','R095ZM'].map((sku,i)=>({id:i+1,line_id:'est2434-'+i,item_index:i,sku}));
 const counts=new Map([[1,0],[2,0],[3,1],[4,0]]);
 const client=[db[2],db[0],db[3],db[1]].map(row=>({...row,decorations:row.sku==='462900'?[{}]:[]}));
 expect(decorationShrinkConflicts(client,db,counts,{})).toEqual([]);
 client[0].decorations=[];
 expect(decorationShrinkConflicts(client,db,counts,{})).toHaveLength(1);
 expect(decorationShrinkConflicts(client,db,counts,{'line:est2434-2':{from:1,to:0}})).toEqual([]);
});

test('EST-2434: a newly added line never adopts the line_id of the existing line it resembles',()=>{
 const {resolveOutgoingLineIds}=require('../lib/orderLineIdentity');
 const db=[
  {id:1,line_id:'lx-russell',sku:'R095ZX',color:'',product_id:null},
  {id:2,line_id:'lx-default',sku:'R095ZX',color:'Default',product_id:null},
  {id:3,line_id:'shorts',sku:'462900',color:'Black',product_id:null},
  {id:4,line_id:'zm-russell',sku:'R095ZM',color:'',product_id:null},
 ];
 // The rep changed line 0 to the Momentec Default jersey and added a fresh R095ZM Default line.
 const client=[
  {line_id:'lx-russell',sku:'R095ZX',color:'Default',product_id:null},
  {line_id:'lx-default',sku:'R095ZX',color:'Default',product_id:null},
  {line_id:'shorts',sku:'462900',color:'Black',product_id:null},
  {line_id:'zm-russell',sku:'R095ZM',color:'',product_id:null},
  {sku:'R095ZM',color:'Default',product_id:null},
  {sku:'R095ZX',color:'Default',product_id:null}, // second blank twin of an already-claimed line
 ];
 const out=resolveOutgoingLineIds(client,db);
 const ids=out.map(it=>it.line_id);
 expect(ids.slice(0,4)).toEqual(['lx-russell','lx-default','shorts','zm-russell']);
 expect(ids[4]).toBeUndefined();                 // no DB twin at all → server mints, as before
 expect(ids[5]).toBeTruthy();                    // sole twin is claimed by line 1 → fresh id, never 'lx-default'
 expect(ids[5]).not.toBe('lx-default');
 expect(new Set(ids.filter(Boolean)).size).toBe(ids.filter(Boolean).length);
 expect(client[5].line_id).toBeUndefined();      // payload-only: the editor's objects are not mutated
});

test('offline draft lines still re-attach to their unique unclaimed twin, and ambiguity is left to the server',()=>{
 const {resolveOutgoingLineIds}=require('../lib/orderLineIdentity');
 const db=[{id:1,line_id:'a',sku:'A',color:'',product_id:null},{id:2,line_id:'b',sku:'B',color:'',product_id:null},{id:3,line_id:'b2',sku:'B',color:'',product_id:null}];
 const out=resolveOutgoingLineIds([{sku:'A',color:''},{sku:'B',color:''},{sku:'A',color:''}],db);
 expect(out[0].line_id).toBe('a');       // unique twin → adopted (legacy behaviour)
 expect(out[1].line_id).toBeUndefined(); // two unclaimed twins → server raises AMBIGUOUS, unchanged
 expect(out[2].line_id).toBeTruthy();    // 'a' is now claimed by line 0 → this is a new line
 expect(out[2].line_id).not.toBe('a');
});
