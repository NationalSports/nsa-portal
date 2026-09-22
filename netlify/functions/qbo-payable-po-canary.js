const {randomUUID}=require('crypto');
const {verifyQBOUser,getSupabaseAdmin}=require('./_shared');
const {getValidAccessToken,qbRequest}=require('./_qb');
const {reviewEnabled}=require('./_qboReviewConfig');
const {payableReviewStore}=require('./_qboPayableReviewStore');
const {buildPortalPOGroups}=require('./_qboPayableServerReview');
const {attemptKey,buildPlan,linkKey,listCandidates,selectSource,verifyPrerequisites,verifyReadback}=require('./_qboPayablePOCanary');

const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const clean=value=>String(value==null?'':value).trim();
const qboLiteral=value=>String(value).replace(/'/g,"\\'");
const publicErrors=new Set(['verified_review_required','no_po_canary_candidate','po_candidate_changed','po_candidate_already_synced','approved_accounts_required','vendor_changed','accounts_changed','duplicate_po','po_readback_mismatch']);
const safeError=error=>publicErrors.has(error?.message)?error.message:'po_canary_unavailable';

async function readQuery(token,realm,sql){
  const response=await qbRequest('GET',`/v3/company/${realm}/query?query=${encodeURIComponent(sql)}`,token.access_token,null,false);
  if(response.status!==200||response.data?.Fault||!response.data?.QueryResponse)throw new Error('qbo_read_failed');
  return response.data.QueryResponse;
}
async function loadSource(admin,realm){
  const{data:runs,error}=await admin.from('qbo_payable_review_runs').select('id,snapshot_id,status,report,finished_at').eq('company_key','national').in('status',['complete','needs_review']).not('snapshot_id','is',null).order('started_at',{ascending:false}).limit(10);
  if(error)throw new Error('review_unavailable');
  const run=(runs||[]).find(item=>item.report?.reviewerVersion===2&&item.report?.replay?.identical===true);if(!run)throw new Error('verified_review_required');
  listCandidates(run.report);
  const portal=await payableReviewStore(admin,realm).snapshot(),groups=buildPortalPOGroups(portal);
  const selected=selectSource({run,groups,realm});
  if(portal.links?.qbPOMap?.[selected.candidate.poId])throw new Error('po_candidate_already_synced');
  return{run,portal,...selected};
}
async function loadContext(admin,token,realm,source){
  const plan=buildPlan({run:source.run,candidate:source.candidate,group:source.group,realm,purchaseAccount:source.run.report?.accounts?.purchases_account});
  const[vendor,account,pos]=await Promise.all([
    readQuery(token,realm,`SELECT * FROM Vendor WHERE Id = '${qboLiteral(plan.summary.qboVendorId)}' MAXRESULTS 1`),
    readQuery(token,realm,`SELECT * FROM Account WHERE Id = '${qboLiteral(plan.summary.purchaseAccount.id)}' MAXRESULTS 1`),
    readQuery(token,realm,`SELECT * FROM PurchaseOrder WHERE DocNumber = '${qboLiteral(plan.summary.poId)}' MAXRESULTS 100`),
  ]);
  verifyPrerequisites({plan,vendor:vendor.Vendor?.[0],account:account.Account?.[0],purchaseOrders:pos.PurchaseOrder||[]});
  return plan;
}
async function updateAttempt(admin,key,value){const{data,error}=await admin.from('app_state').update({value:JSON.stringify(value),updated_at:new Date().toISOString()}).eq('id',key).select('id');if(error||data?.length!==1)throw new Error('receipt_save_failed')}
async function saveLink(admin,realm,plan,poId,evidence){
  const key=linkKey(realm,plan.summary.poId),verifiedAt=evidence.verified_at;
  const value={realm_id:realm,map_key:'qbPOMap',source_id:plan.summary.poId,qbo_id:clean(poId),active:true,verified_at:verifiedAt,evidence:{result:'created',api_readback:true,doc_number:plan.summary.poId,vendor_id:plan.summary.qboVendorId,date:plan.summary.date,total:plan.summary.total,line_count:1,items_created:0,inventory_quantity_posted:false},log:{id:`qb-link-qbPOMap-${clean(poId)}-${verifiedAt}`,verified_at:verifiedAt,ts:verifiedAt,type:'purchase_order_canary',status:'success',details:[`${plan.summary.poId} — created and verified QBO PO #${clean(poId)}`]}};
  const{data:prior,error:readError}=await admin.from('app_state').select('value').eq('id',key).maybeSingle();if(readError)throw new Error('po_link_save_failed');
  if(prior){let existing;try{existing=typeof prior.value==='string'?JSON.parse(prior.value):prior.value}catch{throw new Error('po_link_conflict')}if(existing?.active!==false&&clean(existing?.qbo_id)!==clean(poId))throw new Error('po_link_conflict')}
  const{error}=await admin.from('app_state').upsert({id:key,value:JSON.stringify(value),updated_at:verifiedAt},{onConflict:'id'});if(error)throw new Error('po_link_save_failed');
  const{data:after,error:afterError}=await admin.from('app_state').select('value').eq('id',key).maybeSingle();if(afterError||!after||after.value!==JSON.stringify(value))throw new Error('po_link_save_failed');
}

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers};if(event.httpMethod!=='POST')return{statusCode:405,headers,body:'{}'};
  const auth=await verifyQBOUser(event);if(!auth.ok)return{statusCode:auth.status,headers,body:'{}'};if(!reviewEnabled())return{statusCode:409,headers,body:JSON.stringify({error:'Payable review is disabled'})};
  let body;try{body=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers,body:JSON.stringify({error:'Invalid JSON'})}}
  if(!['preview','execute'].includes(body.action))return{statusCode:400,headers,body:JSON.stringify({error:'Action must be preview or execute'})};
  const admin=getSupabaseAdmin(),realm=process.env.QBO_REVIEW_REALM_ID;
  try{
    const token=await getValidAccessToken(admin,'national');if(clean(token.realm_id)!==realm)throw new Error('realm_changed');
    if(body.action==='execute'&&body.approved!==true)return{statusCode:400,headers,body:JSON.stringify({error:'Explicit approval is required'})};
    const key=attemptKey(realm),{data:prior,error:priorError}=await admin.from('app_state').select('value').eq('id',key).maybeSingle();if(priorError)throw new Error('attempt_read_failed');
    if(prior){let saved;try{saved=typeof prior.value==='string'?JSON.parse(prior.value):prior.value}catch{throw new Error('attempt_corrupt')}
      if(saved?.status==='complete'&&saved?.qbo_purchase_order_id)return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboPurchaseOrderId:saved.qbo_purchase_order_id,recovered:true})};
      return{statusCode:409,headers,body:JSON.stringify({error:'A prior PO canary attempt requires review',status:saved?.status||'unknown',qboPurchaseOrderId:saved?.qbo_purchase_order_id||null})}}
    const source=await loadSource(admin,realm);
    const plan=await loadContext(admin,token,realm,source);if(body.action==='preview')return{statusCode:200,headers,body:JSON.stringify({mode:'preview',candidate:plan.summary,previewHash:plan.previewHash,writes:0})};
    if(clean(body.previewHash)!==plan.previewHash)return{statusCode:409,headers,body:JSON.stringify({error:'The PO candidate changed; prepare it again'})};
    const startedAt=new Date().toISOString(),attempt={attempt_id:randomUUID(),realm_id:realm,po_id:plan.summary.poId,status:'executing',expected_hash:plan.previewHash,requested_by:auth.userId,started_at:startedAt};
    const{error:insertError}=await admin.from('app_state').insert({id:key,value:JSON.stringify(attempt),updated_at:startedAt});if(insertError){if(insertError.code==='23505')return{statusCode:409,headers,body:JSON.stringify({error:'Another PO canary attempt already exists'})};throw new Error('attempt_save_failed')}
    let response;try{response=await qbRequest('POST',`/v3/company/${realm}/purchaseorder`,token.access_token,plan.payload,false)}catch{await updateAttempt(admin,key,{...attempt,status:'unknown',error:'qbo_write_outcome_unknown',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:'QBO PO write outcome is unknown; inspect QBO before retrying'})}}
    const po=response.data?.PurchaseOrder;if(response.status!==200||!po?.Id){await updateAttempt(admin,key,{...attempt,status:'blocked',error:'qbo_write_rejected',finished_at:new Date().toISOString()});return{statusCode:409,headers,body:JSON.stringify({error:'QBO rejected the PO canary; no retry was attempted'})}}
    const poId=clean(po.Id);let verified;
    try{const[idRead,numberRead]=await Promise.all([readQuery(token,realm,`SELECT * FROM PurchaseOrder WHERE Id = '${qboLiteral(poId)}' MAXRESULTS 1`),readQuery(token,realm,`SELECT * FROM PurchaseOrder WHERE DocNumber = '${qboLiteral(plan.summary.poId)}' MAXRESULTS 100`)]);verified=verifyReadback(plan,idRead.PurchaseOrder?.[0],numberRead.PurchaseOrder||[])}
    catch{await updateAttempt(admin,key,{...attempt,status:'unknown',qbo_purchase_order_id:poId,error:'readback_failed',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:`QBO Purchase Order #${poId} exists but verification failed; stop and review it`})}}
    const evidence={...verified,verified_at:new Date().toISOString(),review_run_id:plan.summary.reviewRunId,snapshot_id:plan.summary.snapshotId,source_hash:plan.summary.sourceHash,items_created:0,inventory_quantity_posted:false};
    await updateAttempt(admin,key,{...attempt,status:'qbo_verified',qbo_purchase_order_id:poId,evidence,finished_at:evidence.verified_at});await saveLink(admin,realm,plan,poId,evidence);await updateAttempt(admin,key,{...attempt,status:'complete',qbo_purchase_order_id:poId,evidence:{...evidence,po_link_receipt:true},finished_at:evidence.verified_at});
    return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboPurchaseOrderId:poId,candidate:plan.summary})};
  }catch(error){return{statusCode:409,headers,body:JSON.stringify({error:safeError(error)})}
  }
};
