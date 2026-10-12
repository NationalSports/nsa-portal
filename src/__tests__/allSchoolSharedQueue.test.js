jest.mock('../../netlify/functions/teamshop-auto-po',()=>({generateForSoSafe:jest.fn(async()=>({ok:true}))}));
const {sweepAllSchoolPurchasing,supplierChunks}=require('../../netlify/functions/all-school-purchasing');
const store=id=>({id,org_type:'all_school',all_school_settings:{purchasing:{enabled:true}}});
function adminFor({age=1,cost=5000}={}) {
  const rows={webstores:[store('A'),store('B'),{...store('C'),org_type:'club'}],webstore_orders:['A','B','C'].map(id=>({id,store_id:id,so_id:id,order_source:'all_school',status:'batched',created_at:new Date(Date.UTC(2026,9,12-age)).toISOString()})),teamshop_auto_po_needs:['A','B','C'].map((id,i)=>({id:i+1,so_id:id,vendor:'Momentec',skip_reason:'all_school_pending',qty_needed:2,qty_on_hand:0,unit_cost_cents:cost,sku:'790',po_id:null,dismissed_at:null})),purchase_orders:[]};
  return {from:table=>{let data=rows[table] || [];const q={select:()=>q,eq:(k,v)=>{data=data.filter(r=>r[k]===v);return q;},in:(k,v)=>{data=data.filter(r=>v.includes(r[k]));return q;},not:()=>q,is:(k,v)=>{data=data.filter(r=>r[k]===v);return q;},order:()=>q,range:async(a,b)=>({data:data.slice(a,b+1)})};return q;},rpc:jest.fn(async(name,args)=>({data:args.p_due_reason==='evaluate'?{lines:args.p_need_ids.map(id=>({meta:{need_id:id},qty:2}))}:{ok:true}}))};
}
test('two schools cross $200 together, Club never joins and retries use one stable key',async()=>{
  const db=adminFor();
  await sweepAllSchoolPurchasing(db,{now:'2026-10-12T00:00:00Z'});
  const calls=db.rpc.mock.calls.filter(([,a])=>a.p_due_reason==='minimum');
  expect(calls).toHaveLength(1);
  expect(calls[0][1].p_need_ids).toEqual([1,2]);
  expect(calls[0][1].p_combine_regular).toBe(false);
  await sweepAllSchoolPurchasing(db,{now:'2026-10-12T00:00:00Z'});
  expect(db.rpc.mock.calls.filter(([,a])=>a.p_due_reason==='minimum')[1][1].p_run_key).toBe(calls[0][1].p_run_key);
});
test.each([6,7])('below minimum releases at seven days, age=%s',async age=>{
 const db=adminFor({age,cost:100});await sweepAllSchoolPurchasing(db,{now:'2026-10-12T00:00:00Z'});
 expect(db.rpc.mock.calls.filter(([,a])=>a.p_due_reason==='max_wait')).toHaveLength(age===7?1:0);
});
test('large queues split oldest first within cost and line limits',()=>{
 const needs=Array.from({length:120},(_,i)=>({id:i,sku:'790',qty_needed:1,unit_cost_cents:100,created_at:'2026-10-01'}));
 expect(supplierChunks(needs).map(c=>c.length)).toEqual([100,20]);
});
