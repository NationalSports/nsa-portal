const {randomUUID}=require('crypto');
const {verifyQBOUser,getSupabaseAdmin}=require('./_shared');
const {getValidAccessToken,qbRequest}=require('./_qb');
const {reviewEnabled}=require('./_qboReviewConfig');
const {buildCanaryPlan,listCanaryCandidates,payableCanaryAttemptKey,payableCanaryReceiptKey,selectCanarySource,verifyCanaryReadback,verifyQboPrerequisites}=require('./_qboPayableCanary');

const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
const clean=value=>String(value==null?'':value).trim();
const safeError=error=>['verified_review_required','no_canary_candidate','candidate_changed','candidate_already_synced','approved_accounts_required','vendor_changed','accounts_changed','duplicate_document','readback_mismatch'].includes(error?.message)?error.message:'canary_unavailable';
const qboLiteral=value=>String(value).replace(/'/g,"\\'");

async function readQuery(token,realm,sql){
  const response=await qbRequest('GET',`/v3/company/${realm}/query?query=${encodeURIComponent(sql)}`,token.access_token,null,false);
  if(response.status!==200||response.data?.Fault||!response.data?.QueryResponse)throw new Error('qbo_read_failed');
  return response.data.QueryResponse;
}
async function completedCanary(admin,realm){
  const prefix='_qb_canary_bill_'+clean(realm).replace(/[^A-Za-z0-9_-]/g,'_')+'_';
  const{data,error}=await admin.from('app_state').select('value').gte('id',prefix).lt('id',prefix+'\uffff').order('id',{ascending:true}).limit(1);if(error)throw new Error('attempt_read_failed');
  if(!data?.length)return null;let receipt;try{receipt=typeof data[0].value==='string'?JSON.parse(data[0].value):data[0].value}catch{throw new Error('attempt_corrupt')}
  return clean(receipt?.realm_id)===clean(realm)&&clean(receipt?.qbo_bill_id)?receipt:null;
}
async function auditCompletedCanary(admin,token,realm,receipt){
  const key=payableCanaryAttemptKey(realm,receipt.source_id),{data,error}=await admin.from('app_state').select('value').eq('id',key).maybeSingle();if(error||!data)throw new Error('attempt_read_failed');
  let attempt;try{attempt=typeof data.value==='string'?JSON.parse(data.value):data.value}catch{throw new Error('attempt_corrupt')}
  const evidence=attempt?.evidence||{},lines=(evidence.lines||[]).map(value=>{const[type,accountId,amount]=String(value).split('|');if(type!=='A'||!accountId)return null;return{Amount:Number(amount),DetailType:'AccountBasedExpenseLineDetail',AccountBasedExpenseLineDetail:{AccountRef:{value:accountId}}}}).filter(Boolean);
  const plan={summary:{documentNumber:clean(evidence.docNumber),qboVendorId:clean(evidence.vendorId),date:clean(evidence.date),total:Number(evidence.total),apAccount:{id:clean(evidence.apAccountId)}},payload:{Line:lines}};
  if(!plan.summary.documentNumber||!plan.summary.qboVendorId||!plan.summary.date||!plan.summary.apAccount.id||!lines.length)throw new Error('attempt_corrupt');
  const billId=clean(receipt.qbo_bill_id),doc=qboLiteral(plan.summary.documentNumber),[idRead,docRead,creditRead]=await Promise.all([readQuery(token,realm,`SELECT * FROM Bill WHERE Id = '${qboLiteral(billId)}' MAXRESULTS 1`),readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`)]);
  return verifyCanaryReadback(plan,idRead.Bill?.[0],docRead.Bill||[],creditRead.VendorCredit||[]);
}
async function loadReviewSource(admin,realm){
  const{data:runs,error:runError}=await admin.from('qbo_payable_review_runs').select('id,snapshot_id,status,report,finished_at').eq('company_key','national').in('status',['complete','needs_review']).not('snapshot_id','is',null).order('started_at',{ascending:false}).limit(10);
  if(runError)throw new Error('review_unavailable');
  const run=(runs||[]).find(item=>item.report?.reviewerVersion===2&&item.report?.replay?.identical===true);
  if(!run)throw new Error('verified_review_required');
  const candidates=listCanaryCandidates(run.report),ids=candidates.map(candidate=>candidate.ledgerId);
  const{data:rows,error:rowError}=await admin.from('applied_bills').select('id,status,portal_status,qb_status,qb_bill_id,doc_number,vendor,doc_total,is_credit,raw_meta').in('id',ids);
  if(rowError)throw new Error('candidate_changed');
  const{row,candidate}=selectCanarySource({run,rows,realm});
  return{run,row,candidate};
}
async function loadContext(admin,token,realm,source){
  const{run,row,candidate}=source||await loadReviewSource(admin,realm),plan=buildCanaryPlan({run,row,candidate,realm});
  const doc=qboLiteral(plan.summary.documentNumber),vendorId=qboLiteral(plan.summary.qboVendorId);
  const [vendorResult,accountsResult,billResult,creditResult]=await Promise.all([
    readQuery(token,realm,`SELECT * FROM Vendor WHERE Id = '${vendorId}' MAXRESULTS 1`),
    readQuery(token,realm,'SELECT * FROM Account MAXRESULTS 1000'),
    readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),
    readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`),
  ]);
  verifyQboPrerequisites({plan,vendor:vendorResult.Vendor?.[0],accounts:accountsResult.Account||[],bills:billResult.Bill||[],credits:creditResult.VendorCredit||[]});
  return{run,row,plan};
}
async function saveAttempt(admin,key,value){const{data,error}=await admin.from('app_state').update({value:JSON.stringify(value),updated_at:new Date().toISOString()}).eq('id',key).select('id');if(error||data?.length!==1)throw new Error('receipt_save_failed')}
async function repairReceipts(admin,realm,ledgerId,billId,evidence){
  const verifiedAt=evidence.verified_at||new Date().toISOString();
  const{data:rows,error}=await admin.from('applied_bills').update({qb_status:'success',qb_bill_id:billId,qb_message:`Server canary verified: QBO Bill #${billId}`,qb_synced_at:verifiedAt,updated_at:verifiedAt}).eq('id',ledgerId).is('qb_status',null).is('qb_bill_id',null).select('id');
  if(error)throw new Error('ledger_receipt_failed');
  if(!rows?.length){const{data:current,error:readError}=await admin.from('applied_bills').select('qb_status,qb_bill_id').eq('id',ledgerId).maybeSingle();if(readError||current?.qb_status!=='success'||clean(current.qb_bill_id)!==clean(billId))throw new Error('ledger_receipt_conflict')}
  const receipt={realm_id:realm,qbo_bill_id:clean(billId),source_id:clean(ledgerId),doc_number:evidence.docNumber,verified_at:verifiedAt};
  const receiptKey=payableCanaryReceiptKey(realm,billId),{data:existing,error:existingError}=await admin.from('app_state').select('value').eq('id',receiptKey).maybeSingle();if(existingError)throw new Error('canary_receipt_failed');
  if(existing){let prior;try{prior=typeof existing.value==='string'?JSON.parse(existing.value):existing.value}catch{throw new Error('canary_receipt_conflict')}if(clean(prior?.realm_id)!==realm||clean(prior?.qbo_bill_id)!==clean(billId)||clean(prior?.source_id)!==clean(ledgerId)||clean(prior?.doc_number)!==clean(evidence.docNumber))throw new Error('canary_receipt_conflict')}
  const{error:receiptError}=await admin.from('app_state').upsert({id:receiptKey,value:JSON.stringify(receipt),updated_at:verifiedAt},{onConflict:'id'});if(receiptError)throw new Error('canary_receipt_failed');
}

exports.handler=async event=>{
  if(event.httpMethod==='OPTIONS')return{statusCode:204,headers};
  if(event.httpMethod!=='POST')return{statusCode:405,headers,body:'{}'};
  const auth=await verifyQBOUser(event);if(!auth.ok)return{statusCode:auth.status,headers,body:'{}'};
  if(!reviewEnabled())return{statusCode:409,headers,body:JSON.stringify({error:'Payable review is disabled'})};
  let body;try{body=JSON.parse(event.body||'{}')}catch{return{statusCode:400,headers,body:JSON.stringify({error:'Invalid JSON'})}}
  if(!['preview','execute'].includes(body.action))return{statusCode:400,headers,body:JSON.stringify({error:'Action must be preview or execute'})};
  const action=body.action,admin=getSupabaseAdmin(),realm=process.env.QBO_REVIEW_REALM_ID;
  try{
    const token=await getValidAccessToken(admin,'national');if(clean(token.realm_id)!==realm)throw new Error('realm_changed');
    if(action==='execute'&&body.approved!==true)return{statusCode:400,headers,body:JSON.stringify({error:'Explicit approval is required'})};
    const completed=await completedCanary(admin,realm);if(completed){const evidence=await auditCompletedCanary(admin,token,realm,completed);return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:completed.qbo_bill_id,recovered:true,audited:true,evidence})}}
    const source=await loadReviewSource(admin,realm),attemptKey=payableCanaryAttemptKey(realm,source.candidate.ledgerId);
    const{data:prior,error:priorError}=await admin.from('app_state').select('value').eq('id',attemptKey).maybeSingle();if(priorError)throw new Error('attempt_read_failed');
    if(prior){let saved;try{saved=typeof prior.value==='string'?JSON.parse(prior.value):prior.value}catch{throw new Error('attempt_corrupt')}
      if(action==='execute'&&saved?.status==='complete'&&saved?.expected_hash===clean(body.previewHash)&&saved?.qbo_bill_id){await repairReceipts(admin,realm,source.candidate.ledgerId,saved.qbo_bill_id,saved.evidence||{});return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:saved.qbo_bill_id,recovered:true})}}
      if(action==='execute'&&saved?.status==='qbo_verified'&&saved?.expected_hash===clean(body.previewHash)&&saved?.qbo_bill_id){
        const plan=buildCanaryPlan({...source,realm}),billId=clean(saved.qbo_bill_id),doc=qboLiteral(plan.summary.documentNumber);
        const[idRead,docRead,creditRead]=await Promise.all([readQuery(token,realm,`SELECT * FROM Bill WHERE Id = '${qboLiteral(billId)}' MAXRESULTS 1`),readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`)]);
        const verified=verifyCanaryReadback(plan,idRead.Bill?.[0],docRead.Bill||[],creditRead.VendorCredit||[]),evidence={...saved.evidence,...verified,verified_at:saved.evidence?.verified_at||new Date().toISOString()};
        await repairReceipts(admin,realm,plan.summary.ledgerId,billId,evidence);await saveAttempt(admin,attemptKey,{...saved,status:'complete',evidence:{...evidence,ledger_receipt:true,canary_receipt:true},finished_at:new Date().toISOString()});
        return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:billId,recovered:true})};
      }
      return{statusCode:409,headers,body:JSON.stringify({error:'A prior canary attempt requires review',status:saved?.status||'unknown'})};
    }
    const context=await loadContext(admin,token,realm,source),{plan}=context;
    if(action==='preview')return{statusCode:200,headers,body:JSON.stringify({mode:'preview',candidate:plan.summary,previewHash:plan.previewHash,writes:0})};
    if(clean(body.previewHash)!==plan.previewHash)return{statusCode:409,headers,body:JSON.stringify({error:'The candidate changed; prepare it again'})};
    const attemptId=randomUUID(),startedAt=new Date().toISOString();
    const attempt={attempt_id:attemptId,realm_id:realm,ledger_id:plan.summary.ledgerId,status:'executing',expected_hash:plan.previewHash,requested_by:auth.userId,started_at:startedAt};
    const{error:insertError}=await admin.from('app_state').insert({id:attemptKey,value:JSON.stringify(attempt),updated_at:startedAt});
    if(insertError){if(insertError.code==='23505')return{statusCode:409,headers,body:JSON.stringify({error:'Another canary attempt already exists'})};throw new Error('attempt_save_failed')}
    let response;
    try{response=await qbRequest('POST',`/v3/company/${realm}/bill`,token.access_token,plan.payload,false)}catch(error){await saveAttempt(admin,attemptKey,{...attempt,status:'unknown',error:'qbo_write_outcome_unknown',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:'QBO write outcome is unknown; inspect QBO before retrying'})}}
    const bill=response.data?.Bill;
    if(response.status!==200||!bill?.Id){await saveAttempt(admin,attemptKey,{...attempt,status:'blocked',error:'qbo_write_rejected',finished_at:new Date().toISOString()});return{statusCode:409,headers,body:JSON.stringify({error:'QBO rejected the canary bill; no retry was attempted'})}}
    const billId=clean(bill.Id),doc=qboLiteral(plan.summary.documentNumber);
    let verified;
    try{
      const [idRead,docRead,creditRead]=await Promise.all([
        readQuery(token,realm,`SELECT * FROM Bill WHERE Id = '${qboLiteral(billId)}' MAXRESULTS 1`),
        readQuery(token,realm,`SELECT * FROM Bill WHERE DocNumber = '${doc}' MAXRESULTS 100`),
        readQuery(token,realm,`SELECT * FROM VendorCredit WHERE DocNumber = '${doc}' MAXRESULTS 100`),
      ]);
      verified=verifyCanaryReadback(plan,idRead.Bill?.[0],docRead.Bill||[],creditRead.VendorCredit||[]);
    }catch(error){await saveAttempt(admin,attemptKey,{...attempt,status:'unknown',qbo_bill_id:billId,error:'readback_failed',finished_at:new Date().toISOString()});return{statusCode:503,headers,body:JSON.stringify({error:`QBO Bill #${billId} exists but verification failed; stop and review it`})}}
    const evidence={...verified,verified_at:new Date().toISOString(),review_run_id:plan.summary.reviewRunId,snapshot_id:plan.summary.snapshotId,source_hash:plan.summary.sourceHash,items_created:0,inventory_quantity_posted:false};
    await saveAttempt(admin,attemptKey,{...attempt,status:'qbo_verified',qbo_bill_id:billId,evidence,finished_at:evidence.verified_at});
    await repairReceipts(admin,realm,plan.summary.ledgerId,billId,evidence);
    await saveAttempt(admin,attemptKey,{...attempt,status:'complete',qbo_bill_id:billId,evidence:{...evidence,ledger_receipt:true,canary_receipt:true},finished_at:evidence.verified_at});
    return{statusCode:200,headers,body:JSON.stringify({status:'complete',qboBillId:billId,candidate:plan.summary})};
  }catch(error){return{statusCode:409,headers,body:JSON.stringify({error:safeError(error)})}}
};
