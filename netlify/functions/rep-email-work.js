const crypto=require('crypto');
const {corsHeaders,verifyUser}=require('./_shared');
const {PILOT,TABLE,PRODUCT_COLS,queueWork,sizesOf,priceProduct,stockFor,finish}=require('./_repEmailWork');
const json=(statusCode,body)=>({statusCode,headers:corsHeaders(),body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod==='OPTIONS')return json(204,{});
 if(event.httpMethod!=='POST')return json(405,{error:'POST only'});
 const auth=await verifyUser(event);if(!auth.ok)return json(auth.status,{error:auth.error});
 if(auth.teamMemberId!==PILOT)return json(403,{error:'Email preparation is currently enabled for Steve’s pilot only.'});
 if(Buffer.byteLength(event.body||'')>50000)return json(413,{error:'Request is too large'});
 let body;try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid JSON'})}
 if(!['prepare','save','stock','create_estimate','search_products'].includes(body.action))return json(400,{error:'Unknown action'});
 try{
 const {admin,teamMemberId}=auth;
 const {data:row,error:re}=await admin.from('rep_email_insights').select('*').eq('id',body.insightId).eq('team_member_id',teamMemberId).maybeSingle();if(re)throw re;if(!row)return json(404,{error:'Email not found'});
 if(body.action==='search_products'){
  const term=String(body.query||'').replace(/[^a-z0-9 -]/gi,' ').trim().slice(0,70);
  if(term.length<2)return json(400,{error:'Enter at least two letters or a SKU'});
  let query=admin.from('products').select(PRODUCT_COLS).eq('is_active',true).or('is_archived.is.null,is_archived.eq.false').or('customer_id.is.null'+(row.customer_id?',customer_id.eq.'+row.customer_id:''));
  const{data:products,error:pe}=await query.or('sku.ilike.%'+term+'%,name.ilike.%'+term+'%').limit(30);if(pe)throw pe;return json(200,{products});
 }
 if(body.action==='prepare')return json(200,{work:await queueWork(admin,row,event,{force:body.retry===true})});
 const {data:work,error}=await admin.from(TABLE).select('*').eq('team_member_id',teamMemberId).eq('gmail_thread_id',row.gmail_thread_id||row.gmail_message_id).maybeSingle();if(error)throw error;if(!work)return json(404,{error:'Prepare this email first'});
 if(work.customer_id!==row.customer_id)return json(409,{error:'Account changed. Prepare again to recalculate pricing.'});
 if(body.action==='create_estimate'&&work.estimate_id)return json(200,{estimateId:work.estimate_id});
 if(work.status!=='ready'||body.revision!==work.revision)return json(409,{error:'This request changed. Reload the prepared work and review it again.'});
 if(body.action==='create_estimate'){
  const {data:id,error:ce}=await admin.rpc('create_rep_email_estimate',{p_work_id:work.id,p_owner:teamMemberId,p_revision:work.revision});if(ce)throw ce;
  return json(200,{estimateId:id});
 }
 if(body.action==='stock'){
  const lines=[];for(const line of work.prepared.lines||[])lines.push({...line,stock:await stockFor(admin,line.product)});
  const {data:next,error:se}=await admin.from(TABLE).update({prepared:{...work.prepared,lines},revision:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',work.id).eq('revision',work.revision).select('*').maybeSingle();if(se)throw se;if(!next)return json(409,{error:'Request changed. Refresh and try again.'});return json(200,{work:next});
 }
 if(!Array.isArray(body.lines)||body.lines.length!==(work.prepared.lines||[]).length)return json(400,{error:'Review all prepared lines'});
 const {data:customer,error:ce}=work.customer_id?await admin.from('customers').select('id,name,catalog_markup,adidas_ua_tier').eq('id',work.customer_id).single():{data:null};if(ce)throw ce;
 const lines=[];
 for(let i=0;i<body.lines.length;i++){
  const edit=body.lines[i],original=work.prepared.lines[i];let p=null;
  if(edit.product_id){const {data,error:pe}=await admin.from('products').select(PRODUCT_COLS+',customer_id').eq('id',String(edit.product_id)).eq('is_active',true).or('is_archived.is.null,is_archived.eq.false').maybeSingle();if(pe)throw pe;if(!data||(data.customer_id&&data.customer_id!==work.customer_id))return json(400,{error:'Selected product is unavailable for this account'});p=data;}
  const sizes=sizesOf(edit.sizes),quantity=Number(edit.quantity)||null;
  if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>100000))return json(400,{error:'Enter a valid quantity'});
  if(Object.values(sizes).some(n=>n>100000))return json(400,{error:'Enter valid sizes'});
  lines.push({...original,product:p,sizes,quantity,decoration:typeof edit.decoration==='string'?edit.decoration.slice(0,300):original.decoration,pricing:p?priceProduct(p,customer):null,stock:p?.id===original.product?.id?original.stock:await stockFor(admin,p)});
 }
 const prepared=finish({...work.prepared,lines,customer_name:customer?.name||null});
 const {data:next,error:se}=await admin.from(TABLE).update({prepared,revision:crypto.randomUUID(),updated_at:new Date().toISOString()}).eq('id',work.id).eq('revision',work.revision).select('*').maybeSingle();if(se)throw se;if(!next)return json(409,{error:'Request changed. Refresh and try again.'});return json(200,{work:next});
 }catch(e){console.error('[rep-email-work]',e.message);return json(500,{error:e.message||'Preparation failed. Please retry.'});}
};
