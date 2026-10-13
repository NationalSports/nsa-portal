const crypto=require('crypto');
const {getSupabaseAdmin,safeEqualStr}=require('./_shared');
const {processWork}=require('./_repEmailWork');
exports.handler=async event=>{
 const secret=process.env.INTERNAL_FUNCTION_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(event.httpMethod!=='POST'||!secret||Buffer.byteLength(event.body||'')>1000)return {statusCode:403};
 const expected=crypto.createHmac('sha256',secret).update(event.body||'').digest('hex');
 if(!safeEqualStr(expected,event.headers?.['x-work-signature']))return {statusCode:403};
 const {id,revision}=JSON.parse(event.body);await processWork(getSupabaseAdmin(),id,revision);return {statusCode:200};
};
