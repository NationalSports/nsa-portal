import {priceListOrderCandidates,priceListCustomDraft,priceListLineFields} from '../lib/priceListOrderItem';
import {_pick,_itemCols,_pickSoItem} from '../constants';
const result=(price='12.56',label='Price')=>({matches:[{document_id:'doc1',vendor_id:'ns_35',vendor_name:'Athletic Specialties',file_name:'ASI.xlsx',location:'Sheet1 · rows 601–608',content:`Column labels:\nRow 1:  | Item | Description | ${label}\nSource rows:\nRow 603:  | JRL | LEATHER JUMP ROPE | ${price}\nRow 605:  | KAS | KNEE PAD | 2.15`}]});
test('JRL becomes an order-only custom draft with vendor cost and order markup',()=>{
 const rows=priceListOrderCandidates(result(),'JRL');expect(rows).toHaveLength(1);
 const draft=priceListCustomDraft(rows[0],1.65);
 expect(draft).toMatchObject({sku:'JRL',name:'LEATHER JUMP ROPE',vendor_id:'ns_35',nsa_cost:12.56,unit_sell:20.72,saveToCatalog:false});
});
test.each(['0.00','EUR 12.56','12,56','12.56 / dozen'])('does not guess a cost from %s',value=>{
 expect(priceListOrderCandidates(result(value),'JRL')[0].cost).toBeNull();
});
test('retail is not treated as vendor cost',()=>{
 expect(priceListOrderCandidates(result('25.00','Retail'),'JRL')[0].cost).toBeNull();
});
test('estimate and sales order persistence projections retain SKU, cost, vendor and source',()=>{
 const draft=priceListCustomDraft(priceListOrderCandidates(result(),'JRL')[0]);
 const line={product_id:null,is_custom:true,sku:draft.sku,name:draft.name,vendor_id:draft.vendor_id,nsa_cost:draft.nsa_cost,unit_sell:draft.unit_sell,sizes:{},decorations:[],...priceListLineFields(draft)};
 for(const saved of [_pick(line,_itemCols),_pickSoItem(line)]){
  const reloaded=JSON.parse(JSON.stringify(saved));
  expect(reloaded).toMatchObject({product_id:null,is_custom:true,sku:'JRL',vendor_id:'ns_35',nsa_cost:12.56,unit_sell:20.72,qty_only:true,est_qty:1,no_deco:true});
  expect(reloaded.notes).toContain('ASI.xlsx');expect(reloaded.notes).toContain('row 603');
 }
});
test('does not offer neighboring items for a multi-row-only match or unknown layouts',()=>{
 expect(priceListOrderCandidates(result(),'JRL KAS')).toEqual([]);
 expect(priceListOrderCandidates({matches:[{content:'PDF JRL 12.56'}]},'JRL')).toEqual([]);
});
