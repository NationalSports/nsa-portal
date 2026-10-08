// Queue removals must keep the source PO commitment until its save is confirmed.
export function carryBatchPoMetadata(items,bp){
  const amount=Number(bp?.manual_cost)||0;const paymentMethod=bp?.payment_method||'';
  if(!(amount>0)&&!paymentMethod)return items;
  let stored=false;
  return(items||[]).map(it=>({...it,po_lines:(it.po_lines||[]).map(pl=>{
    if(pl.batch_queue_id!==bp.id)return pl;
    if(!stored){stored=true;return{...pl,...(paymentMethod?{_payment_method:paymentMethod}:{}),...(amount>0?{_manual_cost:amount,...(bp.manual_cost_note?{_manual_cost_note:bp.manual_cost_note}:{})}:{})}}
    const{_payment_method,_manual_cost,_manual_cost_note,...rest}=pl;return rest;
  })}));
}

export function planQueuedBatchRemoval(bp,so,itemIndex=null){
  if(!bp?.id||bp.all_school_allocation_id)throw new Error('This queue entry cannot be removed here.');
  if(!so||so.id!==bp.so_id||!Array.isArray(so.items)||!so.items.length)throw new Error('The source sales order could not be loaded.');
  const whole=itemIndex==null;
  const target=whole?null:bp.items?.[itemIndex];
  if(!whole&&(!Number.isInteger(itemIndex)||!target||!Number.isInteger(target.item_idx)||!so.items[target.item_idx]))throw new Error('The source item could not be identified.');
  if(!whole&&bp.items.some((it,i)=>i!==itemIndex&&it.item_idx===target.item_idx))throw new Error('Multiple queue items share a source line. Remove the whole PO instead.');
  if(target){const source=so.items[target.item_idx];if((target.line_id&&source.line_id!==target.line_id)||source.sku!==target.sku||(source.color||'')!==(target.color||''))throw new Error('The source item changed.');}
  let removed=0;
  const items=so.items.map((it,i)=>{
    if(!whole&&i!==target.item_idx)return it;
    const po_lines=(it.po_lines||[]).filter(pl=>{if(pl.batch_queue_id!==bp.id)return true;if(pl.status!=='queued'||pl.batch_po_number||pl.api_order_id||Object.values(pl.received||{}).some(n=>Number(n)>0))throw new Error('This PO has already been submitted or received.');removed++;return false});
    return{...it,po_lines};
  });
  if(!removed)throw new Error('The linked queued PO could not be found on the sales order.');
  const remaining=whole?[]:bp.items.filter((_,i)=>i!==itemIndex);
  const batch=remaining.length?{...bp,items:remaining,total_cost:remaining.reduce((n,it)=>n+(Number(it.qty)||0)*(Number(it.unit_cost)||0),0)+(Number(bp.manual_cost)||0)}:null;
  return{order:{...so,items:batch?carryBatchPoMetadata(items,bp):items,updated_at:new Date().toLocaleString()},batch};
}

export function planQueuedBatchEdit(bp,so,updatedItems){
  // Validate the existing commitment before editing or removing any quantities.
  planQueuedBatchRemoval(bp,so);
  const indexes=new Set();
  for(const it of bp.items||[]){
    const source=so.items[it.item_idx];
    if(!Number.isInteger(it.item_idx)||!source||(it.line_id&&source.line_id!==it.line_id)||indexes.has(it.item_idx)||source.sku!==it.sku||(source.color||'')!==(it.color||''))throw new Error('The source items changed.');
    indexes.add(it.item_idx);
  }
  for(const it of updatedItems){if(!indexes.has(it.item_idx))throw new Error('The source item could not be identified.');}
  const byIndex=new Map(updatedItems.map(it=>[it.item_idx,it]));
  const items=so.items.map((it,i)=>({...it,po_lines:(it.po_lines||[]).flatMap(pl=>{
    if(pl.batch_queue_id!==bp.id)return[pl];
    const changed=byIndex.get(i);if(!changed)return[];
    const clean={...pl};Object.keys(clean).forEach(k=>{if(typeof clean[k]==='number'&&k!=='unit_cost'&&!k.startsWith('_'))delete clean[k]});
    return[{...clean,...changed.sizes,unit_cost:changed.unit_cost}];
  })}));
  const batch=updatedItems.length?{...bp,items:updatedItems,total_cost:updatedItems.reduce((n,it)=>n+(Number(it.qty)||0)*(Number(it.unit_cost)||0),0)+(Number(bp.manual_cost)||0)}:null;
  return{order:{...so,items:batch?carryBatchPoMetadata(items,bp):items,updated_at:new Date().toLocaleString()},batch};
}

export async function commitQueuedBatchRemoval(plan,saveOrder,commitQueue){
  if(await saveOrder(plan.order)!==true)throw new Error('The sales-order save could not be confirmed.');
  commitQueue(plan.batch);
}
