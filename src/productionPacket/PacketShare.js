import React,{useEffect,useState} from 'react';
import {packetRequest} from './api';
import {dpoSelectionKey,dpoShareUrl} from './dpoScope';

export default function PacketShare({storeId,scope,token,packet,expiresAt}) {
 const initialDpo=packet?.dpo || null;
 const [dpos,setDpos]=useState(packet?.dpos || []),[selection,setSelection]=useState(dpoSelectionKey(initialDpo)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [createdToken,setCreatedToken]=useState(''),[createdFor,setCreatedFor]=useState(''),[retry,setRetry]=useState(0);
 useEffect(()=>{let active=true;packetRequest({token:token||undefined,store_id:storeId,scope_so_id:scope||undefined,action:'options'},'store-production-email').then(result=>{
   if(!active)return;
   const next=result.dpos||[];setDpos(next);setSelection(current=>next.some(d=>dpoSelectionKey(d)===current)?current:(next.length===1?dpoSelectionKey(next[0]):''));setError('');
  }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[storeId,scope,token,retry]);
 const selected=dpos.find(d=>dpoSelectionKey(d)===selection)||null;
 const linkToken=token || (createdFor===selection?createdToken:'');
 const copyUrl=linkToken?dpoShareUrl(linkToken,selected):'';
 const choose=value=>{setSelection(value);setNotice('');setCreatedToken('');setCreatedFor('');};
 const run=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const getLink=async()=>{
  if(copyUrl)return copyUrl;
  const link=await packetRequest({store_id:storeId,scope_so_id:selected?.soId||scope||undefined,action:'create_link',label:selected?`${selected.number} · ${selected.vendor||'Decorator'}`:'Shared production packet'});
  setCreatedToken(link.token);setCreatedFor(selection);return dpoShareUrl(link.token,selected);
 };
 const copyText=async(text,success)=>{try{await navigator.clipboard.writeText(text);setNotice(success);}catch{setNotice('Select and copy the text below.');}};
 const message=url=>`Production packet${selected?` · ${selected.soId}`:''}\n${url}\n\n${selected?`DPO: ${selected.number}\nDecorator: ${selected.vendor||'Not specified'}\n${selected.dueDate?`Expected return: ${selected.dueDate}\n`:''}\n`:''}Open the link for current production details and the associated DPO reference. No sign-in is required.`;
 const download=()=>run(async()=>{const result=await packetRequest({token:token||undefined,store_id:storeId,scope_so_id:scope||undefined,action:'download',dpo_id:selected.id,dpo_so_id:selected.soId},'store-production-email');const bytes=Uint8Array.from(atob(result.attachment.content),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=result.attachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
 return <section className="pp-share-tools pp-card" aria-label="Share production packet">
  <h2>Share production packet</h2><p>Choose a DPO to open its garments, decoration work, and reference first. The recipient link grants access to its saved store or sales order scope and expires after 90 days.</p>
  {dpos.length>0&&<label>Associated decoration purchase order <select aria-label="Decoration purchase order" value={selection} onChange={e=>choose(e.target.value)}><option value="">Whole packet</option>{dpos.map(d=><option key={dpoSelectionKey(d)} value={dpoSelectionKey(d)}>{d.number} · {d.vendor} · {d.soId}</option>)}</select></label>}
  {selected&&<div className="pp-dpo-share-summary"><p><strong>{selected.number}</strong> · {selected.vendor||'Decorator not specified'} · {selected.soId}</p><p>{selected.dueDate?`Expected return ${selected.dueDate}`:'Expected return not set'} · Saved DPO quantity {selected.savedQuantity??'not set'} · Covered SO garments {selected.coveredQuantity??'not set'}</p>{selected.discrepancy&&<p className="pp-attention">Saved DPO count and covered garment count differ; the DPO may count decoration applications.</p>}{selected.email&&<p>Contact: <a href={`mailto:${selected.email}`}>{selected.email}</a></p>}{selected.notes&&<p>Instructions: {selected.notes}</p>}<button disabled={busy} onClick={download}>Download {selected.number} PDF</button></div>}
  <label>Production packet link <input aria-label="Shareable production packet link" readOnly value={copyUrl} placeholder="Click Copy link to create a shareable link" onFocus={e=>e.target.select()}/></label>
  <div className="pp-actions"><button disabled={busy} onClick={()=>run(async()=>copyText(await getLink(),'Link copied.'))}>Copy link</button><button disabled={busy} onClick={()=>run(async()=>copyText(message(await getLink()),'Message and link copied.'))}>Copy message with link</button></div>
  {expiresAt&&<p className="pp-muted">This recipient link expires {new Date(expiresAt).toLocaleDateString()}.</p>}
  {copyUrl&&selected&&<a className="pp-email-link" href={`mailto:${encodeURIComponent(selected.email||'')}?subject=${encodeURIComponent(`${selected.number} - Production packet`)}&body=${encodeURIComponent(message(copyUrl))}`}>Open in my email app</a>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <button disabled={busy} onClick={()=>setRetry(n=>n+1)}>Retry</button></p>}
  {copyUrl&&<details><summary>Message to copy</summary><textarea aria-label="Share message with link" readOnly rows={7} value={message(copyUrl)} onFocus={e=>e.target.select()}/></details>}
 </section>;
}
