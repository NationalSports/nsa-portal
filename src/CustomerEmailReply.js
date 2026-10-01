import React,{useEffect,useState} from 'react';
export default function CustomerEmailReply({row,call,onClose}){
 const [context,setContext]=useState(null),[text,setText]=useState(''),[draft,setDraft]=useState(null),[savedText,setSavedText]=useState(null),[busy,setBusy]=useState('load'),[error,setError]=useState(''),[sent,setSent]=useState(false);
 useEffect(()=>{let alive=true;call('rep-gmail-reply',{action:'prepare',insightId:row.id}).then(d=>{if(alive)setContext(d)}).catch(e=>{if(alive)setError(e.message)}).finally(()=>{if(alive)setBusy('')});return()=>{alive=false}},[row.id,call]);
 const save=async()=>{
  setBusy('draft');setError('');
  try{const d=await call('rep-gmail-reply',{action:'draft',insightId:row.id,text,...draft});setDraft({draftId:d.draftId,proof:d.proof});setSavedText(text);setContext(c=>({...c,signature:d.signature}))}catch(e){setError(e.message)}finally{setBusy('')}
 };
 const send=async()=>{
  setBusy('send');setError('');
  try{await call('rep-gmail-reply',{action:'send',insightId:row.id,...draft});setSent(true)}catch(e){setError(e.message)}finally{setBusy('')}
 };
 return <section className="customer-email-reply" aria-label="Reply composer">
  <div className="customer-email-reply-title"><strong>Reply to customer</strong><button className="btn btn-sm btn-secondary" disabled={!!busy} onClick={()=>{if(text&&text!==savedText&&!window.confirm('Discard your unsaved reply text?'))return;onClose()}}>Close</button></div>
  {busy==='load'&&<p>Loading your Gmail signature and original message…</p>}
  {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  {sent?<p role="status">Reply sent from your Gmail account. It is available in Gmail Sent.</p>:context&&<>
   <div className="customer-email-reply-address"><div><b>From:</b> {context.from}</div><div><b>To:</b> {context.to}</div><div><b>Subject:</b> {context.subject}</div></div>
   <details><summary>Read original email</summary><pre>{context.originalText}</pre></details>
   <label>Your reply<textarea aria-label="Your reply" placeholder="Write your reply…" value={text} disabled={!!busy} maxLength={20000} onChange={e=>setText(e.target.value)}/></label>
   <div className="customer-email-signature"><b>Your email signature</b>{context.signature?<iframe title="HTML signature preview" sandbox="" referrerPolicy="no-referrer" srcDoc={'<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src https: data:; style-src \'unsafe-inline\'"></head><body style="margin:8px;font-family:Arial,sans-serif">'+context.signature+'</body></html>'}/>:<p>No Gmail signature was found. Set your signature in Gmail to use signed replies here.</p>}</div>
   <div className="customer-email-reply-buttons"><button className="btn btn-secondary" disabled={!!busy||!text.trim()||!context.signature} onClick={save}>{busy==='draft'?'Saving…':draft?'Update Gmail draft':'Save Gmail draft'}</button><button className="btn btn-primary" disabled={!!busy||!draft||savedText!==text} onClick={send}>{busy==='send'?'Sending…':'Send reply'}</button></div>
   <small>{draft&&savedText===text?'Draft saved in Gmail. Review the recipient, reply, and signature before sending.':'Save a draft to review before sending. Replies go only to the recipient shown above.'}</small>
  </>}
 </section>;
}
