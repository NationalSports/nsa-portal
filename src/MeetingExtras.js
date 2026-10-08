/* eslint-disable */
import React,{useState,useEffect} from 'react';
const fn=async(supabase,name,body)=>{
  const {data:{session}}=await supabase.auth.getSession();
  if(!session?.access_token)throw new Error('Sign in again.');
  const r=await fetch('/.netlify/functions/'+name,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.access_token},body:JSON.stringify(body)});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Request failed');return d;
};
export async function compressedPhoto(file){
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('Choose a JPEG, PNG or WebP photo under 20 MB.');
  const url=URL.createObjectURL(file);
  try {
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not open this photo.'));img.src=url;});
    const scale=Math.min(1,1600/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',0.75));
    if(!blob||blob.size>1048576)throw new Error('Photo is still over 1 MB. Crop it and try again.');return blob;
  }finally{URL.revokeObjectURL(url)}
}
export function CaptureExtras({supabase,meetingId,elapsed,annotations,onAnnotations,notify,onBusy}){
  const [text,setText]=useState('');const[busy,setBusy]=useState(false);const[photos,setPhotos]=useState([]);
  const add=(kind)=>{const entry={kind,at_ms:elapsed,text:text.trim()||(kind==='highlight'?'Important moment':'')};if(!entry.text)return;onAnnotations([...annotations,entry]);setText('');};
  const upload=async file=>{
    if(!file||!meetingId)return;setBusy(true);onBusy?.(true);
    let path;
    try{const blob=await compressedPhoto(file);const d=await fn(supabase,'meeting-notes',{action:'image_upload',id:meetingId,mime:'image/jpeg',name:file.name});path=d.path;const {error}=await supabase.storage.from('meeting-images').uploadToSignedUrl(d.path,d.token,blob,{contentType:'image/jpeg'});if(error)throw error;await fn(supabase,'meeting-notes',{action:'image_commit',id:meetingId,path:d.path});setPhotos(p=>[...p,file.name]);}
    catch(e){if(path)await fn(supabase,'meeting-notes',{action:'image_remove',id:meetingId,path}).catch(()=>{});notify?.(e.message,'error')}finally{setBusy(false);onBusy?.(false)}
  };
  return <div style={{border:'1px solid #e2e8f0',padding:12,borderRadius:8,display:'grid',gap:8}}>
    <b>Highlights & reference photos</b>
    <input className="form-input" value={text} onChange={e=>setText(e.target.value)} maxLength={500} placeholder="A detail to remember…"/>
    <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button className="btn btn-sm btn-secondary" type="button" onClick={()=>add('highlight')}>★ Mark important</button><button className="btn btn-sm btn-secondary" type="button" disabled={!text.trim()} onClick={()=>add('text')}>Add detail</button>
    {meetingId&&<label className="btn btn-sm btn-secondary">{busy?'Uploading photo…':'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} style={{display:'none'}} onChange={e=>{upload(e.target.files?.[0]);e.target.value=''}}/></label>}</div>
    {annotations.map((a,i)=><div key={i} style={{fontSize:12}}>{a.kind==='highlight'?'★ ':''}{Math.floor(a.at_ms/60000)}m · {a.text}<button type="button" aria-label="Remove annotation" onClick={()=>onAnnotations(annotations.filter((_,j)=>j!==i))}>×</button></div>)}
    {photos.map((p,i)=><div key={i} style={{fontSize:12}}>✓ {p}</div>)}
    <small>Audio is temporary. Photos stay with this note, up to six at 1 MB each.</small>
  </div>;
}
export function NoteAttachments({supabase,id}){
  const[data,setData]=useState(null);const[error,setError]=useState('');
  useEffect(()=>{let off=false;fn(supabase,'meeting-notes',{action:'images',id}).then(d=>{if(!off)setData(d)}).catch(e=>{if(!off)setError(e.message)});return()=>{off=true}},[supabase,id]);
  if(error)return <small>{error}</small>;if(!data)return null;
  return <div>{data.annotations.map((a,i)=><div key={i}>{a.kind==='highlight'?'★ ':''}{a.text}</div>)}<div style={{display:'flex',gap:8,flexWrap:'wrap'}}>{data.images.map((im,i)=><a key={i} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt={im.name} style={{width:120,height:100,objectFit:'contain'}}/></a>)}</div></div>;
}
export function AskAccount({supabase,customerId}){
  const[q,setQ]=useState('');const[result,setResult]=useState(null);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  useEffect(()=>{setResult(null);setQ('');setError('')},[customerId]);
  const ask=async()=>{setBusy(true);setError('');try{setResult(await fn(supabase,'meeting-ask',{customer_id:customerId,question:q}))}catch(e){setError(e.message)}finally{setBusy(false)}};
  if(!customerId)return null;
  return <div style={{border:'1px solid #e2e8f0',borderRadius:8,padding:12,marginBottom:12}}><b>Ask this account</b><div style={{display:'flex',gap:8,marginTop:8}}><input className="form-input" style={{flex:1}} maxLength={1000} value={q} onChange={e=>setQ(e.target.value)} placeholder="What did they say about next season’s budget?"/><button className="btn btn-sm btn-primary" disabled={busy||q.trim().length<5} onClick={ask}>{busy?'Searching…':'Ask'}</button></div>
    {error&&<p style={{color:'#b91c1c'}}>{error}</p>}{result&&<div><p style={{whiteSpace:'pre-wrap'}}>{result.answer}</p>{result.citations.map((c,i)=><div key={i} style={{fontSize:12,marginBottom:8}}><b>{c.title||'Meeting'} · {String(c.date).slice(0,10)}</b> · {c.source}<blockquote style={{margin:'4px 0'}}>“{c.quote}”</blockquote></div>)}<small>{result.scope}</small></div>}
  </div>;
}
