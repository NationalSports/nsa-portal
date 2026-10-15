const { corsHeaders, verifyUser } = require('./_shared');
const { loadTimingContext, clearTimingCache } = require('./_fulfillmentTiming');
exports.handler = async event => {
 const headers={...corsHeaders(),'Cache-Control':'no-store'};
 const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(!['GET','POST'].includes(event.httpMethod))return reply(405,{error:'Method not allowed'});
 const auth=await verifyUser(event);
 if(!auth.ok)return reply(auth.status,{error:auth.error});
 try {
  if(event.httpMethod==='POST'){
   if((event.body||'').length>65536)return reply(413,{error:'Too many arrival lines'});
   let body;try{body=JSON.parse(event.body||'{}');}catch{return reply(400,{error:'Invalid JSON'});}
   if(body.action!=='record_arrival'||!Array.isArray(body.lines)||body.lines.length<1||body.lines.length>250||body.lines.some(l=>!l||typeof l!=='object')||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.request_id||''))return reply(400,{error:'Choose the arriving quantities'});
   const lines=body.lines.map(l=>({so_id:l.so_id,item_index:l.item_index,po_id:l.po_id,size:l.size,qty:l.qty}));
   const r=await auth.admin.rpc('record_fulfillment_arrivals',{p_request_id:body.request_id,p_lines:lines});
   if(r.error)return reply(409,{error:r.error.code==='PGRST202'?'Timing capture is not deployed yet':r.error.message});
   clearTimingCache();return reply(200,{ok:true,recorded:r.data});
  }
  const context=await loadTimingContext(auth.admin);
  if(!context)return reply(503,{error:'Timing history is not available yet. Existing estimates remain in use.'});
  const {model,plan,jobs}=context;
  return reply(200,{model,plan:jobs.map(j=>({job_id:j.id,so_id:j.so_id,method:j.deco_type,units:j.total_units,status:j.prod_status,...(plan.jobs[`${j.so_id}|${j.id}`]||{finish_date:null,reason:'Waiting for release; stock, artwork, and materials must be ready'})})).sort((a,b)=>(a.start_date||'9999').localeCompare(b.start_date||'9999')||String(a.job_id).localeCompare(String(b.job_id)))});
 }catch(error){console.warn('[fulfillment-planning]',error.message);return reply(500,{error:'Could not load production planning'});}
};
