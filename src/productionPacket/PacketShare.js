import React,{useState} from 'react';
import {packetRequest} from './api';

export default function PacketShare({storeId,scope,token}) {
 const [open,setOpen]=useState(false),[dpos,setDpos]=useState([]),[selection,setSelection]=useState(''),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[copyUrl,setCopyUrl]=useState('');
 const request=body=>packetRequest({store_id:storeId,scope_so_id:scope||undefined,...body},'store-production-email');
 const run=async fn=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
 const copy=()=>run(async()=>{
  let url=token?`${window.location.origin}/production-packet#token=${encodeURIComponent(token)}`:copyUrl;
  if(!url){const link=await packetRequest({store_id:storeId,scope_so_id:scope||undefined,action:'create_link',label:'Shared production packet'});url=`${window.location.origin}/production-packet#token=${link.token}`;}
  setCopyUrl(url);
  try{await navigator.clipboard.writeText(url);setNotice('Link copied. Anyone with this link can open the packet without signing in.');}catch{setNotice('Select and copy the link below.');}
 });
 const start=()=>run(async()=>{setOpen(true);setDraft(null);const result=await request({action:'options'});setDpos(result.dpos);setSelection(result.dpos.length===1?'0':'');});
 const prepare=()=>run(async()=>{const selected=dpos[Number(selection)];const result=await request({action:'prepare',dpo_id:selected.id,target_so_id:selected.soId});setDraft(result);});
 const send=()=>run(async()=>{
  const result=await packetRequest({sender:{name:'National Sports Apparel',email:'noreply@nationalsportsapparel.com'},to:[{email:draft.to.trim()}],replyTo:draft.replyTo,subject:draft.subject,textContent:draft.text,attachment:[draft.attachment]},'brevo-proxy');
  if(!result.messageId)throw new Error('The email provider did not confirm acceptance. Check delivery before trying again.');
  setNotice(`Email accepted for ${draft.to}, with ${draft.dpo} attached.`);setDraft(null);setOpen(false);
 });
 const download=()=>{const bytes=Uint8Array.from(atob(draft.attachment.content),c=>c.charCodeAt(0));const url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));const a=document.createElement('a');a.href=url;a.download=draft.attachment.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <section className="pp-share-tools" aria-label="Share production packet">
  <div className="pp-actions"><button disabled={busy} onClick={copy}>Copy link</button><button disabled={busy} onClick={start}>Email decorator</button></div>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error} <a href={`https://connect.nationalsportsapparel.com/production-packet?store=${encodeURIComponent(storeId)}`}>Open staff view</a></p>}
  {copyUrl&&<input aria-label="Shareable production packet link" readOnly value={copyUrl} onFocus={e=>e.target.select()}/>}
  {open&&<div className="pp-card"><h2>Email production packet</h2><p>Choose the destination DPO. The recipient comes from its decorator’s vendor contact. The email includes a link to this SO’s packet and a DPO reference PDF.</p>
   <label>Decoration purchase order <select aria-label="Decoration purchase order" disabled={busy} value={selection} onChange={e=>{setSelection(e.target.value);setDraft(null);}}><option value="">Choose DPO…</option>{dpos.map((d,i)=><option key={`${d.soId}-${d.id}`} value={String(i)}>{d.number} · {d.vendor} · {d.soId}</option>)}</select></label>
   {!dpos.length&&!error&&<p>No associated DPOs found. Add a decoration PO to the SO first.</p>}
   {selection!==''&&!draft&&<><p>Recipient: {dpos[Number(selection)]?.email||'No vendor email saved — enter it in the draft.'}</p><button disabled={busy} onClick={prepare}>{busy?'Preparing…':'Prepare email'}</button></>}
   {draft&&<><label>To <input aria-label="Decorator email" type="email" value={draft.to} onChange={e=>setDraft({...draft,to:e.target.value})}/></label><label>Subject <input aria-label="Email subject" value={draft.subject} onChange={e=>setDraft({...draft,subject:e.target.value})}/></label><label>Message <textarea aria-label="Email message" rows={12} value={draft.text} onChange={e=>setDraft({...draft,text:e.target.value})}/></label><p>Attached: <button onClick={download}>{draft.attachment.name}</button></p><p className="pp-muted">Anyone with the link can access the SO packet without signing in. It expires in 90 days. Review the DPO attachment and recipient before sending.</p><button className="pp-primary" disabled={busy||!/^\S+@\S+\.\S+$/.test(draft.to.trim())||!draft.subject.trim()} onClick={send}>{busy?'Sending…':'Send email'}</button></>}
   <button disabled={busy} onClick={()=>{setOpen(false);setDraft(null);}}>Close</button>
  </div>}
 </section>;
}
