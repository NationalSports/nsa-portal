// No browser grants: snapshot payloads and pages are service-role-only.
function snapshotStore(admin,realm,onId=()=>{}){
  const known=new Set();
  const checked=async query=>{const {data,error}=await query.abortSignal(AbortSignal.timeout(30000));if(error)throw new Error('snapshot_store_failed');return data};
  return {
    async load(id){const row=await checked(admin.from('qbo_payable_snapshots').select('manifest,portal_snapshot').eq('id',id).eq('realm_id',realm).maybeSingle());if(row){known.add(id);onId(id)}return row?{...row.manifest,portal:row.portal_snapshot}:null},
    async save(manifest){const {portal,...metadata}=manifest;
      if(known.has(manifest.id)){const rows=await checked(admin.from('qbo_payable_snapshots').update({manifest:metadata}).eq('id',manifest.id).eq('realm_id',realm).select('id'));if(rows?.length!==1)throw new Error('snapshot_store_failed')}
      else{await checked(admin.from('qbo_payable_snapshots').insert({id:manifest.id,realm_id:realm,manifest:metadata,portal_snapshot:portal}));known.add(manifest.id)}
      onId(manifest.id)},
    async page(id,entity,page){const row=await checked(admin.from('qbo_payable_snapshot_pages').select('payload').eq('snapshot_id',id).eq('entity',entity).eq('page',page).maybeSingle());return row?.payload},
    async savePage(id,entity,page,payload){await checked(admin.from('qbo_payable_snapshot_pages').insert({snapshot_id:id,entity,page,payload}))},
  };
}
module.exports={snapshotStore};
