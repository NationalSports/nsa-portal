// Record the prepared write set for existing merge/guard regression assertions.
// These are PLAN entries (planned:true), not REST calls. PostgreSQL execution,
// rollback, access and replay are tested by order_save_scenarios.cjs.
module.exports = function atomicSaveRpc(state,name,args) {
  state.calls.push({table:'RPC',method:name,args:[args]});
  if(name.endsWith('_save_token'))return Promise.resolve({data:'test-save-token',error:null});
  if(name!=='save_sales_order_atomic')return Promise.resolve({data:null,error:null});
  if(state.atomicError){const error=state.atomicError;delete state.atomicError;return Promise.resolve({data:null,error})}
  const p=args.p_plan;
  const record=(table,method,rows,extra={})=>state.calls.push({table,method,args:[rows],planned:true,...extra});
  record('sales_orders',p.is_new?'insert':'upsert',p.header);
  if(p.art_upserts.length)record('so_art_files','upsert',p.art_upserts);
  if(p.job_upserts.length)record('so_jobs','upsert',p.job_upserts);
  if(p.art_deletes.length)record('so_art_files','delete',null,{inArgs:['id',p.art_deletes]});
  if(p.job_deletes.length)record('so_jobs','delete',null,{inArgs:['id',p.job_deletes]});
  if(p.items){
    record('so_items','insert',p.items);
    for(const [key,table] of [['decorations','so_item_decorations'],['pick_lines','so_item_pick_lines'],['po_lines','so_item_po_lines']]){
      const rows=p.items.flatMap(it=>(it[key]||[]).map(row=>({...row,so_item_id:'plan-item-'+it.item_index})));
      if(rows.length)record(table,'insert',rows);
    }
  }
  return Promise.resolve({data:{saved:true,version:(p.base_version||0)+1},error:null});
};
