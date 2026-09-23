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
