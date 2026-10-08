// Scheduled continuation for pending transcripts and crashed workers.
const { getSupabaseAdmin, getTrustedSiteBaseUrl } = require('./_shared');
exports.handler = async event => {
  let scheduled=String(event?.headers?.['x-nf-event']||'').toLowerCase()==='schedule';
  try{scheduled=scheduled||!!JSON.parse(event?.body||'{}').next_run}catch{}
  if(!scheduled) return {statusCode:403,body:'Scheduled only'};
  const admin=getSupabaseAdmin(); const now=new Date().toISOString();
  const {data,error}=await admin.from('meetings').select('id').eq('status','processing').or(`processing_lease_until.is.null,processing_lease_until.lt.${now}`).order('updated_at').limit(10);
  if(error) return {statusCode:500,body:'Could not list pending notes'};
  const base=getTrustedSiteBaseUrl(event)||process.env.URL;
  const secret=process.env.INTERNAL_FUNCTION_SECRET||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret)return {statusCode:503,body:'Processing is not configured'};
  const results=await Promise.allSettled((data||[]).map(m=>fetch(`${base.replace(/\/+$/,'')}/.netlify/functions/meeting-process-background`,{method:'POST',headers:{'content-type':'application/json','x-internal-secret':secret},body:JSON.stringify({meeting_id:m.id})}).then(r=>{if(!r.ok)throw new Error('Worker start failed')})));
  return {statusCode:200,body:JSON.stringify({started:results.filter(r=>r.status==='fulfilled').length})};
};
