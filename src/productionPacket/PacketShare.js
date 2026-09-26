import React,{useEffect,useState} from 'react';
import {packetRequest} from './api';

export default function PacketShare({storeId,scope,token}) {
 const [dpos,setDpos]=useState([]),[selection,setSelection]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[copyUrl,setCopyUrl]=useState(token?`${window.location.origin}/production-packet#token=${encodeURIComponent(token)}`:'');
 const [retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;packetRequest({token:token||undefined,store_id:storeId,scope_so_id:scope||undefined,action:'options'},'store-production-email').then(result=>{if(active){setDpos(result.dpos);setSelection(result.dpos.length===1?'0':'');setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[storeId,scope,token,retry]);
 const run=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const getLink=async()=>{
  if(copyUrl)return copyUrl;
  const link=await packetRequest({store_id:storeId,scope_so_id:scope||undefined,action:'create_link',label:'Shared production packet'});
  const url=`${window.location.origin}/production-packet#token=${link.token}`;setCopyUrl(url);return url;
 };
 const copyText=async(text,success)=>{try{await navigator.clipboard.writeText(text);setNotice(success);}catch{setNotice('Select and copy the text below.');}};
 const selected=selection!==''?dpos[Number(selection)]:null;
 const message=url=>`Production packet${selected?` - ${selected.soId}`:''}\n${url}\n\n${selected?`DPO: ${selected.number}\nDecorator: ${selected.vendor}\n\n`:''}Open the link for current production details and the associated DPO reference. No sign-in is required.`;
 const download=()=>run(async()=>{const result=await packetRequest({token:token||undefined,store_id:storeId,scope_so_id:scope||undefined,action:'download',dpo_id:selected.id,target_so_id:selected.soId},'store-production-email');const bytes=Uint8Array.from(atob(result.attachment.content),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=result.attachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 return <section className="pp-share-tools pp-card" aria-label="Share production packet">
  <h2>Share production packet</h2><p>Copy this link and send it by email or message. Anyone with the link can open the packet and its DPO reference without signing in.</p>
  <label>Production packet link <input aria-label="Shareable production packet link" readOnly value={copyUrl} placeholder="Click Copy link to create a shareable link" onFocus={e=>e.target.select()}/></label>
  <div className="pp-actions"><button disabled={busy} onClick={()=>run(async()=>copyText(await getLink(),'Link copied.'))}>Copy link</button><button disabled={busy} onClick={()=>run(async()=>copyText(message(await getLink()),'Message and link copied.'))}>Copy message with link</button></div>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <button disabled={busy} onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
  {dpos.length>0&&<><label>Associated decoration purchase order <select aria-label="Decoration purchase order" value={selection} onChange={e=>setSelection(e.target.value)}><option value="">Choose DPO…</option>{dpos.map((d,i)=><option key={`${d.soId}-${d.id}`} value={String(i)}>{d.number} · {d.vendor} · {d.soId}</option>)}</select></label>
   {selected&&<><p>{selected.vendor}{selected.email&&<> · <a href={`mailto:${selected.email}`}>{selected.email}</a></>}</p><button disabled={busy} onClick={download}>Download {selected.number} PDF</button>{copyUrl&&<a className="pp-email-link" href={`mailto:${encodeURIComponent(selected.email||'')}?subject=${encodeURIComponent(`${selected.number} - Production packet`)}&body=${encodeURIComponent(message(copyUrl))}`}>Open in my email app</a>}</>}
  </>}
  {copyUrl&&<details><summary>Message to copy</summary><textarea aria-label="Share message with link" readOnly rows={7} value={message(copyUrl)} onFocus={e=>e.target.select()}/></details>}
 </section>;
}
