import { planQueuedBatchRemoval, planQueuedBatchEdit, commitQueuedBatchRemoval } from './queuedBatchRemoval';

const setup=()=>{
  const bp={id:'q1',so_id:'SO-1',manual_cost:5,manual_cost_note:'shipping',payment_method:'card',items:[{item_idx:0,sku:'A',color:'Navy',qty:2,unit_cost:3},{item_idx:1,sku:'B',qty:4,unit_cost:2}]};
  const so={id:'SO-1',items:[{sku:'A',color:'Navy',po_lines:[{status:'queued',batch_queue_id:'q1',S:2,_manual_cost:5,_payment_method:'card'},{po_id:'other',M:3}]},{sku:'B',po_lines:[{status:'queued',batch_queue_id:'q1',EA:4}]}]};
  return{bp,so};
};
test('whole removal preserves sales items and unrelated POs without mutating input',()=>{
  const{bp,so}=setup();const before=JSON.stringify(so);const plan=planQueuedBatchRemoval(bp,so);
  expect(plan.batch).toBeNull();expect(plan.order.items).toHaveLength(2);
  expect(plan.order.items[0].po_lines).toEqual([{po_id:'other',M:3}]);expect(plan.order.items[1].po_lines).toEqual([]);expect(JSON.stringify(so)).toBe(before);
});
test('one-item removal moves shipping/payment metadata and recomputes cost',()=>{
  const{bp,so}=setup();const plan=planQueuedBatchRemoval(bp,so,0);
  expect(plan.batch.total_cost).toBe(13);expect(plan.batch.items).toHaveLength(1);
  expect(plan.order.items[1].po_lines[0]).toMatchObject({_manual_cost:5,_manual_cost_note:'shipping',_payment_method:'card',EA:4});
});
test.each(['missing order','unknown source item','stale source item','missing link','allocated batch'])('blocks %s',reason=>{
  const{bp,so}=setup();let index=null;
  if(reason==='missing order')so.id='other';
  if(reason==='unknown source item'){delete bp.items[0].item_idx;index=0;}
  if(reason==='stale source item'){so.items[0].sku='changed';index=0;}
  if(reason==='missing link')so.items.forEach(it=>it.po_lines=[]);
  if(reason==='allocated batch')bp.all_school_allocation_id='a1';
  expect(()=>planQueuedBatchRemoval(bp,so,index)).toThrow();
});
test.each([false,undefined,{}])('unconfirmed save %p leaves queue intact',async result=>{
  const{bp,so}=setup();const commit=jest.fn();
  await expect(commitQueuedBatchRemoval(planQueuedBatchRemoval(bp,so),async()=>result,commit)).rejects.toThrow('could not be confirmed');expect(commit).not.toHaveBeenCalled();
});
test('rejected save leaves queue intact',async()=>{
  const{bp,so}=setup();const commit=jest.fn();await expect(commitQueuedBatchRemoval(planQueuedBatchRemoval(bp,so),async()=>{throw new Error('conflict')},commit)).rejects.toThrow('conflict');expect(commit).not.toHaveBeenCalled();
});
test('queue changes only after the durable save resolves',async()=>{
  const{bp,so}=setup();let finish;const saved=new Promise(resolve=>{finish=resolve});const commit=jest.fn();const plan=planQueuedBatchRemoval(bp,so);
  const pending=commitQueuedBatchRemoval(plan,()=>saved,commit);expect(commit).not.toHaveBeenCalled();finish(true);await pending;expect(commit).toHaveBeenCalledWith(null);
});

test('submitted/received linked lines cannot be deleted from an orphaned queue',()=>{
  const{bp,so}=setup();so.items[0].po_lines[0].status='waiting';expect(()=>planQueuedBatchRemoval(bp,so)).toThrow('submitted');
});
test('quantity edits remove zeroed source commitments and preserve remaining metadata',()=>{
  const{bp,so}=setup();const remaining=[{...bp.items[1],sizes:{EA:2},qty:2,unit_cost:4}];const plan=planQueuedBatchEdit(bp,so,remaining);
  expect(plan.batch.total_cost).toBe(13);expect(plan.order.items[0].po_lines).toEqual([{po_id:'other',M:3}]);
  expect(plan.order.items[1].po_lines[0]).toMatchObject({EA:2,unit_cost:4,_manual_cost:5});
});

test('reordered identical garments cannot remove the wrong stable line',()=>{
  const{bp,so}=setup();bp.items[0].line_id='original';so.items[0].line_id='different';
  expect(()=>planQueuedBatchRemoval(bp,so,0)).toThrow('changed');
  expect(()=>planQueuedBatchEdit(bp,so,bp.items)).toThrow('changed');
});
