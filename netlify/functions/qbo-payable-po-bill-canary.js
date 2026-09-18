const {randomUUID}=require('crypto');
const {verifyQBOUser,getSupabaseAdmin}=require('./_shared');
const {getValidAccessToken,qbRequest}=require('./_qb');
const {reviewEnabled}=require('./_qboReviewConfig');
const {attemptKey,buildPlan,buildSource,linkKey,listCandidates,receiptKey,verifyPrerequisites,verifyReadback}=require('./_qboPayablePOBillCanary');

const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const clean=value=>String(value==null?'':value).trim();
const qboLiteral=value=>clean(value).replace(/'/g,"\\'");
const publicErrors=new Set(['verified_review_required','no_po_bill_canary_candidate','approved_accounts_required','vendor_changed','accounts_changed','duplicate_document','purchase_order_not_linkable','po_bill_candidate_changed','po_bill_readback_mismatch']);
const safeError=error=>publicErrors.has(error?.message)?error.message:'po_bill_canary_unavailable';

async function readQuery(token,realm,sql){
  const response=await qbRequest('GET',`/v3/company/${realm}/query?query=${encodeURIComponent(sql)}`,token.access_token,null,false);
  if(response.status!==200||response.data?.Fault||!response.data?.QueryResponse)throw new Error('qbo_read_failed');
  return response.data.QueryResponse;
}
const parse=value=>{try{return typeof value==='string'?JSON.parse(value):value}catch{return null}};
const detailedError=(message,details)=>Object.assign(new Error(message),{details});

async function loadSources(admin,realm){
  const{data:runs,error:runError}=await admin.from('qbo_payable_review_runs').select('id,snapshot_id,status,report,finished_at').eq('company_key','national').in('status',['complete','needs_review']).not('snapshot_id','is',null).order('started_at',{ascending:false}).limit(10);
  if(runError)throw new Error('review_unavailable');
  const run=(runs||[]).find(item=>item.report?.reviewerVersion===2&&item.report?.replay?.identical===true);if(!run)throw new Error('verified_review_required');
  const candidates=listCandidates(run.report),ids=candidates.map(candidate=>candidate.ledgerId);
  const{data:rows,error:rowError}=await admin.from('applied_bills').select('id,status,portal_status,qb_status,qb_bill_id,doc_number,vendor,doc_total,is_credit,raw_meta').in('id',ids);if(rowError)throw new Error('po_bill_candidate_changed');
  const rowById=new Map((rows||[]).map(row=>[clean(row.id),row])),linkIds=[];
  for(const row of rows||[]){const poNumber=clean(row?.raw_meta?.po_number);if(poNumber)linkIds.push(linkKey(realm,'qbPOMap',poNumber))}
  const{data:links,error:linkError}=linkIds.length?await admin.from('app_state').select('id,value').in('id',[...new Set(linkIds)]):{data:[],error:null};if(linkError)throw new Error('po_link_read_failed');
  const poMap=new Map();for(const item of links||[]){const value=parse(item.value);if(value?.active!==false&&value?.map_key==='qbPOMap'&&clean(value.source_id)&&clean(value.qbo_id))poMap.set(clean(value.source_id),clean(value.qbo_id))}
  const out=[],diagnostics={reviewedCandidates:candidates.length,sourceRows:(rows||[]).length,rowsWithPONumber:0,rowsWithDurablePOLink:0,sourceEligible:0,liveRejected:{}};
  for(const candidate of candidates){const row=rowById.get(clean(candidate.ledgerId)),poNumber=clean(row?.raw_meta?.po_number),qboPurchaseOrderId=poMap.get(poNumber);if(poNumber)diagnostics.rowsWithPONumber++;if(qboPurchaseOrderId)diagnostics.rowsWithDurablePOLink++;if(!row||!qboPurchaseOrderId)continue;try{out.push(buildSource({run,row,candidate,realm,qboPurchaseOrderId}))}catch(error){if(error?.message!=='po_bill_candidate_changed')throw error}}
  diagnostics.sourceEligible=out.length;if(!out.length)throw detailedError('no_po_bill_canary_candidate',diagnostics);return{sources:out,diagnostics};
}

async function loadContext(admin,token,realm){
  const{sources,diagnostics}=await loadSources(admin,realm),accountsResult=await readQuery(token,realm,'SELECT * FROM Account MAXRESULTS 1000');
  for(const source of sources.slice(0,25)){
    const doc=qboLiteral(source.documentNumber),vendorId=qboLiteral(source.candidate.qboVendorId),poId=qboLiteral(source.qboPurchaseOrderId);
    const[poResult,vendorResult,billResult,creditResult]=await Promise.all([
      readQuery(token,realm,`SELECT * FROM PurchaseOrder WHERE Id = '${poId}' MAXRESULTS 1`),
      readQuery(token,realm,`SELECT * FROM Vendor WHERE Id = '${vendorId}' MAXRESULTS 1`),
      readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),
      readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`),
    ]);
    try{
      verifyPrerequisites({source,vendor:vendorResult.Vendor?.[0],accounts:accountsResult.Account||[],bills:billResult.Bill||[],credits:creditResult.VendorCredit||[]});
      return buildPlan(source,poResult.PurchaseOrder?.[0]);
    }catch(error){if(!publicErrors.has(error?.message))throw error;diagnostics.liveRejected[error.message]=(diagnostics.liveRejected[error.message]||0)+1}
  }
  throw detailedError('no_po_bill_canary_candidate',diagnostics);
}

async function readback(token,realm,plan,billId){
  const doc=qboLiteral(plan.summary.documentNumber),id=qboLiteral(billId),poId=qboLiteral(plan.summary.qboPurchaseOrderId);
  const[idRead,docRead,creditRead,poRead]=await Promise.all([
    readQuery(token,realm,`SELECT * FROM Bill WHERE Id = '${id}' MAXRESULTS 1`),
    readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),
    readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`),
    readQuery(token,realm,`SELECT * FROM PurchaseOrder WHERE Id = '${poId}' MAXRESULTS 1`),
  ]);
  return verifyReadback(plan,idRead.Bill?.[0],poRead.PurchaseOrder?.[0],docRead.Bill||[],creditRead.VendorCredit||[]);
}

async function updateAttempt(admin,key,value){const{data,error}=await admin.from('app_state').update({value:JSON.stringify(value),updated_at:new Date().toISOString()}).eq('id',key).select('id');if(error||data?.length!==1)throw new Error('receipt_save_failed')}

async function saveReceipts(admin,realm,plan,billId,evidence){
  const verifiedAt=evidence.verified_at||new Date().toISOString(),ledgerId=plan.summary.ledgerId;
  const{data:rows,error}=await admin.from('applied_bills').update({qb_status:'success',qb_bill_id:billId,qb_message:`Server PO-to-bill canary verified: QBO Bill #${billId}`,qb_synced_at:verifiedAt,updated_at:verifiedAt}).eq('id',ledgerId).is('qb_status',null).is('qb_bill_id',null).select('id');
  if(error)throw new Error('ledger_receipt_failed');
  if(!rows?.length){const{data:current,error:readError}=await admin.from('applied_bills').select('qb_status,qb_bill_id').eq('id',ledgerId).maybeSingle();if(readError||current?.qb_status!=='success'||clean(current.qb_bill_id)!==clean(billId))throw new Error('ledger_receipt_conflict')}
  const billReceipt={realm_id:realm,qbo_bill_id:clean(billId),qbo_purchase_order_id:plan.summary.qboPurchaseOrderId,source_id:ledgerId,po_number:plan.summary.poNumber,doc_number:plan.summary.documentNumber,verified_at:verifiedAt};
  const{error:billReceiptError}=await admin.from('app_state').upsert({id:receiptKey(realm,billId),value:JSON.stringify(billReceipt),updated_at:verifiedAt},{onConflict:'id'});if(billReceiptError)throw new Error('canary_receipt_failed');
  const poBillKey=linkKey(realm,'qbPOBillMap',plan.summary.poNumber),poBillReceipt={realm_id:realm,map_key:'qbPOBillMap',source_id:plan.summary.poNumber,qbo_id:clean(billId),active:true,verified_at:verifiedAt,evidence:{result:'created',api_readback:true,purchase_order_id:plan.summary.qboPurchaseOrderId,bill_id:clean(billId),bill_doc_number:plan.summary.documentNumber,bill_date:plan.summary.date,bill_total:plan.summary.total,purchase_order_total:plan.summary.total,vendor_id:plan.summary.qboVendorId,reciprocal_link:true,items_created:0,inventory_quantity_posted:false},log:{id:`qb-link-qbPOBillMap-${clean(billId)}-${verifiedAt}`,verified_at:verifiedAt,ts:verifiedAt,type:'purchase_order_bill_canary',status:'success',details:[`${plan.summary.poNumber} — created and verified linked QBO Bill #${clean(billId)}`]}};
  const{data:prior,error:priorError}=await admin.from('app_state').select('value').eq('id',poBillKey).maybeSingle();if(priorError)throw new Error('po_bill_link_save_failed');
  if(prior){const existing=parse(prior.value);if(existing?.active!==false&&clean(existing?.qbo_id)!==clean(billId))throw new Error('po_bill_link_conflict')}
  const{error:linkError}=await admin.from('app_state').upsert({id:poBillKey,value:JSON.stringify(poBillReceipt),updated_at:verifiedAt},{onConflict:'id'});if(linkError)throw new Error('po_bill_link_save_failed');
}

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers};if(event.httpMethod!=='POST')return{statusCode:405,headers,body:'{}'};
  const auth=await verifyQBOUser(event);if(!auth.ok)return{statusCode:auth.status,headers,body:'{}'};if(!reviewEnabled())return{statusCode:409,headers,body:JSON.stringify({error:'Payable review is disabled'})};
  let body;try{body=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers,body:JSON.stringify({error:'Invalid JSON'})}}
  if(!['preview','execute'].includes(body.action))return{statusCode:400,headers,body:JSON.stringify({error:'Action must be preview or execute'})};
  const admin=getSupabaseAdmin(),realm=process.env.QBO_REVIEW_REALM_ID,key=attemptKey(realm);
  try{
    const token=await getValidAccessToken(admin,'national');if(clean(token.realm_id)!==clean(realm))throw new Error('realm_changed');
    if(body.action==='execute'&&body.approved!==true)return{statusCode:400,headers,body:JSON.stringify({error:'Explicit approval is required'})};
    const{data:prior,error:priorError}=await admin.from('app_state').select('value').eq('id',key).maybeSingle();if(priorError)throw new Error('attempt_read_failed');
    if(prior){const saved=parse(prior.value);if(!saved)throw new Error('attempt_corrupt');const expected=saved.expected;
      if(saved.status==='complete'&&saved.qbo_bill_id&&expected){const evidence=await readback(token,realm,expected,saved.qbo_bill_id);return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:saved.qbo_bill_id,qboPurchaseOrderId:expected.summary.qboPurchaseOrderId,recovered:true,audited:true,evidence})}}
      if(body.action==='execute'&&saved.status==='qbo_verified'&&saved.qbo_bill_id&&expected&&saved.expected_hash===clean(body.previewHash)){const evidence={...(await readback(token,realm,expected,saved.qbo_bill_id)),verified_at:saved.evidence?.verified_at||new Date().toISOString()};await saveReceipts(admin,realm,expected,saved.qbo_bill_id,evidence);await updateAttempt(admin,key,{...saved,status:'complete',evidence:{...evidence,ledger_receipt:true,po_bill_receipt:true},finished_at:new Date().toISOString()});return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:saved.qbo_bill_id,qboPurchaseOrderId:expected.summary.qboPurchaseOrderId,recovered:true})}}
      return{statusCode:409,headers,body:JSON.stringify({error:'A prior PO-to-bill canary attempt requires review',status:saved.status||'unknown',qboBillId:saved.qbo_bill_id||null})};
    }
    const plan=await loadContext(admin,token,realm);if(body.action==='preview')return{statusCode:200,headers,body:JSON.stringify({mode:'preview',candidate:plan.summary,previewHash:plan.previewHash,writes:0})};
    if(clean(body.previewHash)!==plan.previewHash)return{statusCode:409,headers,body:JSON.stringify({error:'The PO-to-bill candidate changed; prepare it again'})};
    const startedAt=new Date().toISOString(),attempt={attempt_id:randomUUID(),realm_id:realm,ledger_id:plan.summary.ledgerId,po_number:plan.summary.poNumber,qbo_purchase_order_id:plan.summary.qboPurchaseOrderId,status:'executing',expected_hash:plan.previewHash,expected:plan,requested_by:auth.userId,started_at:startedAt};
    const{error:insertError}=await admin.from('app_state').insert({id:key,value:JSON.stringify(attempt),updated_at:startedAt});if(insertError){if(insertError.code==='23505')return{statusCode:409,headers,body:JSON.stringify({error:'Another PO-to-bill canary attempt already exists'})};throw new Error('attempt_save_failed')}
    let response;try{response=await qbRequest('POST',`/v3/company/${realm}/bill`,token.access_token,plan.payload,false)}catch{await updateAttempt(admin,key,{...attempt,status:'unknown',error:'qbo_write_outcome_unknown',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:'QBO linked-bill write outcome is unknown; inspect QBO before retrying'})}}
    const bill=response.data?.Bill;if(response.status!==200||!bill?.Id){await updateAttempt(admin,key,{...attempt,status:'blocked',error:'qbo_write_rejected',finished_at:new Date().toISOString()});return{statusCode:409,headers,body:JSON.stringify({error:'QBO rejected the linked-bill canary; no retry was attempted'})}}
    const billId=clean(bill.Id);let verified;try{verified=await readback(token,realm,plan,billId)}catch{await updateAttempt(admin,key,{...attempt,status:'unknown',qbo_bill_id:billId,error:'readback_failed',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:`QBO Bill #${billId} exists but PO-link verification failed; stop and review it`})}}
    const evidence={...verified,verified_at:new Date().toISOString(),review_run_id:plan.summary.reviewRunId,snapshot_id:plan.summary.snapshotId,source_hash:plan.summary.sourceHash,items_created:0,inventory_quantity_posted:false};
    await updateAttempt(admin,key,{...attempt,status:'qbo_verified',qbo_bill_id:billId,evidence,finished_at:evidence.verified_at});await saveReceipts(admin,realm,plan,billId,evidence);await updateAttempt(admin,key,{...attempt,status:'complete',qbo_bill_id:billId,evidence:{...evidence,ledger_receipt:true,po_bill_receipt:true},finished_at:evidence.verified_at});
    return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:billId,qboPurchaseOrderId:plan.summary.qboPurchaseOrderId,candidate:plan.summary})};
  }catch(error){return{statusCode:409,headers,body:JSON.stringify({error:safeError(error),...(error.details?{details:error.details}:{})})}}
};
