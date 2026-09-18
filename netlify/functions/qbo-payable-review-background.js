const {verifyQBOUser,getSupabaseAdmin}=require('./_shared');
const {getValidAccessToken,qbRequest}=require('./_qb');
const {reviewEnabled}=require('./_qboReviewConfig');
const {runPayableReview}=require('./_qboPayableServerReview');
const {payableReviewStore}=require('./_qboPayableReviewStore');
const {snapshotStore}=require('./_qboPayableSnapshotStore');
const {acquireSnapshot,hash}=require('./_qboPayableSnapshot');

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return{statusCode:405};
  const auth=await verifyQBOUser(event);if(!auth.ok)return{statusCode:auth.status};
  const realm=process.env.QBO_REVIEW_REALM_ID;if(!reviewEnabled())return{statusCode:409,body:'Server review is disabled'};
  let body;try{body=JSON.parse(event.body||'{}')}catch{return{statusCode:400,body:'Invalid JSON'}}
  if(body.snapshotId&&!/^[a-f0-9-]{36}$/i.test(body.snapshotId))return{statusCode:400,body:'Invalid snapshot ID'};
  const admin=getSupabaseAdmin(),store=payableReviewStore(admin,realm);
  let snapshotId=body.snapshotId,finished;
  const finish=store.finish;
  // Delay publishing until two identical in-memory replays pass. Checkpoint IDs
  // remain available on failures so the next invocation can resume explicitly.
  store.finish=async(id,row)=>{finished={id,row};if(row.status==='failed')await finish(id,{...row,snapshot_id:snapshotId||null})};
  const read=async sql=>{
    const token=await getValidAccessToken(admin,'national');if(String(token.realm_id)!==realm)throw new Error('realm_changed');
    const response=await qbRequest('GET',`/v3/company/${realm}/query?query=${encodeURIComponent(sql)}`,token.access_token,null,false);
    if(response.status!==200||response.data?.Fault||!response.data?.QueryResponse){
      const error=new Error(response.status===429?'qbo_rate_limited':'qbo_upstream_failed');error.status=response.status;throw error;
    }
    return response.data.QueryResponse;
  };
  let snapshot;
  try{
    const first=await runPayableReview({store,realm,requestedBy:auth.userId,prepareSnapshot:async()=>{
      snapshot=await acquireSnapshot({store:snapshotStore(admin,realm,id=>{snapshotId=id}),read,realm,portalSnapshot:()=>store.snapshot(),snapshotId});return snapshot;
    }});
    if(first.status==='busy')return{statusCode:200,body:JSON.stringify(first)};
    const second=await runPayableReview({store:{claim:async()=>true,finish:async()=>{}},realm,requestedBy:auth.userId,prepareSnapshot:async()=>snapshot});
    if(hash(first.report)!==hash(second.report)||first.report.safeguards.historicalPayablesProposed!==0||first.report.safeguards.historicalPurchaseOrdersProposed!==0)throw new Error('replay_mismatch');
    first.report.replay={identical:true,runs:2,reportHash:hash(second.report)};
    await finish(first.id,{...finished.row,report:first.report,snapshot_id:snapshotId});
    return{statusCode:200,body:JSON.stringify({id:first.id,status:first.status,snapshotId})};
  }catch(error){
    if(finished&&finished.row.status!=='failed')await finish(finished.id,{status:'failed',finished_at:new Date().toISOString(),snapshot_id:snapshotId||null,error_code:'payable_review_replay_failed'});
    throw error;
  }
};
