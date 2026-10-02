// Preparation is read-only. Creating a separate revision draft requires review.
const clean=v=>String(v||'').trim().toLowerCase();
function authored(text){return String(text||'').split(/\n(?:On .+wrote:|From:|_{5,}|>{1})/i)[0].trim();}
function normalizeRevision(raw){
 if(!raw||!['remove_items','other'].includes(raw.kind))return null;
 return {kind:raw.kind,estimate_ref:String(raw.estimate_ref||'').toUpperCase().match(/^EST-\d+$/)?.[0]||null,
  requests:(Array.isArray(raw.requests)?raw.requests:[]).slice(0,12).map(r=>({sku:String(r.sku||'').slice(0,80),name:String(r.name||'').slice(0,200),color:String(r.color||'').slice(0,100),message_id:String(r.message_id||'').slice(0,100),evidence:String(r.evidence||'').trim().slice(0,500)}))};
}
function matchRemoval(request,items){
 const terms=clean(request.name).replace(/[^a-z0-9 ]/g,' ').split(/\s+/).filter(Boolean).map(w=>w.replace(/s$/,''));
 return items.filter(i=>(request.sku?clean(i.sku)===clean(request.sku):terms.length>0&&terms.every(w=>clean(i.name).includes(w)))&&(!request.color||clean(i.color)===clean(request.color)));
}
async function prepareRevision(admin,raw,work,messages){
 const request=normalizeRevision(raw);if(!request)return null;
 const base={kind:request.kind,state:'blocked',requests:request.requests,estimate_id:null,reason:'This change needs review in the estimate editor.'};
 if(request.kind!=='remove_items'||!request.requests.length)return base;
 // Evidence must be in an actual customer's authored message, never quoted text
 // or a model-generated message id. Other alterations remain manual.
 if(request.requests.some(r=>!r.evidence||!messages.some(m=>m.id===r.message_id&&!/@nationalsportsapparel\.com$/i.test(clean(m.from))&&authored(m.text).includes(r.evidence))))return {...base,reason:'Could not verify the removal request in the customer’s email. Review the conversation.'};
 const refs=[...new Set(messages.flatMap(m=>[m.subject,...m.attachments,authored(m.text)].join(' ').match(/\bEST-\d+\b/gi)||[]).map(s=>s.toUpperCase()))];
 const explicit=request.estimate_ref;
 if(explicit&&!refs.includes(explicit)&&explicit!==work.estimate_id)return {...base,reason:'The estimate reference could not be verified in this conversation.'};
 const ids=explicit?[explicit]:work.estimate_id?[work.estimate_id]:refs;
 if(ids.length!==1||!work.customer_id)return {...base,reason:'Choose the correct customer and link one estimate to this conversation, then re-read it.'};
 const {data:snapshot,error}=await admin.rpc('rep_email_estimate_snapshot',{p_estimate_id:ids[0]});if(error)throw error;
 if(!snapshot?.estimate||snapshot.estimate.customer_id!==work.customer_id||snapshot.estimate.deleted_at)return {...base,reason:'The referenced estimate is unavailable for this customer.'};
 base.estimate_id=ids[0];base.snapshot=snapshot;
 if(snapshot.sales_orders?.length)return {...base,reason:'Already converted to '+snapshot.sales_orders.map(s=>s.id).join(', ')+'. Review the sales order; this estimate will not be revised.'};
 if(!['open','sent','draft'].includes(snapshot.estimate.status))return {...base,reason:'Estimate status is '+snapshot.estimate.status+'. Review it in the editor.'};
 const removed=[];
 for(const r of request.requests){const found=matchRemoval(r,snapshot.items||[]);
  if(found.length>1)return {...base,reason:'More than one line matches '+(r.sku||r.name)+'. Select the exact line in the estimate editor.'};
  if(!found.length){
   const {data:audit,error:ae}=await admin.from('estimate_items_audit').select('item_snapshot,deleted_at').eq('estimate_id',ids[0]);if(ae)throw ae;
   const allAbsent=request.requests.every(x=>matchRemoval(x,snapshot.items||[]).length===0);
   const verified=allAbsent&&request.requests.every(x=>matchRemoval(x,(audit||[]).map(a=>a.item_snapshot)).length>0);
   return {...base,state:verified?'already_removed':'blocked',reason:verified?'The requested lines are already absent, and the removal is recorded in the estimate audit. No revision will be created. Check the sent quote before replying.':'No current line matches '+(r.sku||r.name)+'. Review the exact line in the estimate editor.'};
  }
  if(!removed.some(i=>i.id===found[0].id))removed.push(found[0]);
 }
 if(removed.length===(snapshot.items||[]).length)return {...base,reason:'Removing every line requires review in the estimate editor.'};
 if(snapshot.estimate.promo_applied||snapshot.estimate.credit_applied||snapshot.estimate.deco_pos?.length)return {...base,reason:'This estimate has credits, promotions or decoration purchase orders. Review the change in the estimate editor.'};
 return {...base,state:'ready',reason:'Review the removal and totals. Create a separate revision draft when ready; the original estimate remains unchanged.',removed};
}
module.exports={authored,normalizeRevision,matchRemoval,prepareRevision};
