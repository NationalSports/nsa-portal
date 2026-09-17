const {verifyQBOUser,getSupabaseAdmin}=require('./_shared');
const {getValidAccessToken,qbRequest}=require('./_qb');
const {reviewEnabled}=require('./_qboReviewConfig');
const {runPayableReview}=require('./_qboPayableServerReview');
const {payableReviewStore}=require('./_qboPayableReviewStore');

exports.handler=async event=>{
  if(event.httpMethod!=='POST')return{statusCode:405};
  const auth=await verifyQBOUser(event);if(!auth.ok)return{statusCode:auth.status};
  const realm=process.env.QBO_REVIEW_REALM_ID;if(!reviewEnabled())return{statusCode:409,body:'Server review is disabled'};
  const admin=getSupabaseAdmin();let token;
  const queryAll=async(entity,fields)=>{const output=[];for(let start=1;start<=20000;start+=1000){token=await getValidAccessToken(admin,'national');if(String(token.realm_id)!==realm)throw new Error('realm_changed');const sql=`SELECT ${fields} FROM ${entity} STARTPOSITION ${start} MAXRESULTS 1000`;const response=await qbRequest('GET',`/v3/company/${realm}/query?query=${encodeURIComponent(sql)}`,token.access_token,null,false);const rows=response.data?.QueryResponse?.[entity]||[];if(response.status!==200||response.data?.Fault||!response.data?.QueryResponse)throw new Error('qbo_read_failed');output.push(...rows);if(rows.length<1000)return output}throw new Error('qbo_population_limit')};
  const result=await runPayableReview({store:payableReviewStore(admin,realm),queryAll,realm,requestedBy:auth.userId});
  return{statusCode:200,body:JSON.stringify({id:result.id,status:result.status})};
};
