const {corsHeaders,verifyUser,verifyAdmin}=require('./_shared');
const reply=(statusCode,body)=>({statusCode,headers:corsHeaders(),body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'Method not allowed'});
 try{
  if(event.httpMethod==='GET'&&event.queryStringParameters?.list==='1'){
   const check=await verifyAdmin(event, ['team']);if(!check.ok)return reply(check.status||403,{error:check.error});
   const {data,error}=await check.admin.from('account_deletion_requests').select('*').order('requested_at',{ascending:true}).limit(200);
   if(error)throw error;return reply(200,{requests:data||[]});
  }
  const check=await verifyUser(event, ["@staff"]);if(!check.ok)return reply(check.status||403,{error:check.error});
  if(event.httpMethod==='POST'){
   let body;try{body=JSON.parse(event.body||'{}');}catch{return reply(400,{error:'Invalid JSON'});}
   if(body.confirm!=='DELETE')return reply(400,{error:'Confirm the account deletion request'});
   const {error}=await check.admin.from('account_deletion_requests').upsert({auth_user_id:check.userId,team_member_id:check.teamMemberId},{onConflict:'auth_user_id',ignoreDuplicates:true});
   if(error)throw error;
  }
  const {data,error}=await check.admin.from('account_deletion_requests').select('id,requested_at,status,completed_at').eq('auth_user_id',check.userId).maybeSingle();
  if(error)throw error;return reply(200,{request:data||null});
 }catch(e){console.error('[account-deletion-request]',e.code||'request failed');return reply(503,{error:'Account deletion requests are unavailable. Please try again later.'});}
};
