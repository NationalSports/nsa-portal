import { supabase } from '../lib/auth';
export async function packetRequest(body, endpoint = 'store-production-packet') {
 const session = supabase ? (await supabase.auth.getSession()).data?.session : null;
 const r = await fetch(`/.netlify/functions/${endpoint}`, {method:'POST',headers:{'Content-Type':'application/json',...(session?.access_token && !body.token ? {Authorization:`Bearer ${session.access_token}`} : {})},body:JSON.stringify(body)});
 const data = await r.json(); if(!r.ok) { const message=r.status===401&&!body.token?'Your staff session expired. Sign in again, then reopen the production packet.':(data.error || 'Production packet request failed'); const error=new Error(message); error.status=r.status; throw error; } return data;
}
export function openProductionPacket(storeId, soId) {
 const q = new URLSearchParams(storeId ? {store:storeId} : {so:soId});
 window.open(`/production-packet?${q}`, '_blank', 'noopener,noreferrer');
}

// Store pages hand decorators a tokenized recipient view. The token stays in the
// URL fragment, so it is not sent in hosting logs or Referer headers.
export async function openSharedProductionPacket(storeId, soId) {
 const target=window.open('', '_blank');
 if(target){
  target.opener=null;
  target.document.title='Preparing production packet';
  target.document.body.textContent='Preparing secure production packet link…';
  target.document.body.style.cssText='margin:0;padding:48px;font:15px/1.5 Inter,system-ui,sans-serif;color:#19333c;background:#f3f6f5';
 }
 try{
  const result=await packetRequest({store_id:storeId,scope_so_id:soId||undefined,action:'create_link',label:soId?`Production packet · ${soId}`:'Store production packet'});
  const url=`/production-packet#token=${encodeURIComponent(result.token)}`;
  if(target)target.location.replace(url);else window.location.assign(url);
 }catch(error){
  if(target){
   target.document.body.textContent=error.message||'Could not create the production packet link.';
  }
  throw error;
 }
}
