import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './StandaloneArtRequest.css';
import { fileUpload } from './utils';
import { createArtService } from './lib/standaloneArtRequests';

const uid=()=>{if(window.crypto?.randomUUID)return window.crypto.randomUUID();const bytes=new Uint8Array(16);window.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`};
const fileUrl=f=>typeof f==='string'?f:(f?.url||'');
const fileName=f=>typeof f==='string'?(f.split('?')[0].split('/').pop()||'Artwork'):f?.name||fileUrl(f).split('?')[0].split('/').pop()||'Artwork';
const defaultRefs=art=>{
  if(!art)return[];
  const rows=[...(art.files||[]),...(art.prod_files||[]),...(art.mockup_files||[]),...(art.sample_art||[]),...(art.web_logos||[]),...(art.color_ways||[]).flatMap(c=>[c?.file,c?.url,c?.asset,c?.logo,c?.web_logo]).filter(Boolean)];
  if(art.web_logo_url)rows.unshift({name:'Default web logo',url:art.web_logo_url});
  if(art.preview_url)rows.unshift({name:'Preview',url:art.preview_url});
  return rows.map(f=>({name:fileName(f),url:fileUrl(f)})).filter(x=>x.url).filter((x,i,a)=>a.findIndex(y=>y.url===x.url)===i);
};
const cwId=c=>String(c?.id||c?.key||c?.color_way_id||c?.name||c?.garment_color||'');
const cwLabel=c=>c?.name||c?.label||c?.garment_color||c?.color||'Color way';
const statusLabel=s=>({requested:'Requested',in_progress:'In progress',completed:'Completed',cancelled:'Cancelled'}[s]||s||'Requested');

export default function StandaloneArtRequest({supabase,customer,order,mode='customer',art=null,cu,reps=[],beforeCreate,onSaveNow,saveArtFilesNow,onSynced,children}){
  const requestIdRef=useRef(null);
  const [open,setOpen]=useState(false),[kind,setKind]=useState(art?'web_logo':'create_logo'),[name,setName]=useState(art?.name||''),[colorWay,setColorWay]=useState(''),[instructions,setInstructions]=useState(''),[assignedArtist,setAssignedArtist]=useState(''),[refs,setRefs]=useState(()=>defaultRefs(art)),[rows,setRows]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const service=useMemo(()=>createArtService(supabase),[supabase]);
  const cws=Array.isArray(art?.color_ways)?art.color_ways:[];
  const customerId=customer?.id||order?.customer_id||null;
  const estimateId=mode==='estimate'?order?.id||null:order?.estimate_id||null;
  const soId=mode==='so'?order?.id||null:null;
  const load=async()=>{if(!customerId)return;try{const list=await service.list({customerId,estimateId,soId,artId:art?.id||null});setRows(Array.isArray(list)?list:[])}catch(e){setError(e.message||'Could not load requests')}};
  useEffect(()=>{if(open)load();},[open,customerId,estimateId,soId,art?.id]);
  useEffect(()=>{setName(art?.name||'');setRefs(defaultRefs(art));setColorWay('')},[art?.id]);
  const addFiles=async files=>{
    const incoming=Array.from(files||[]);if(!incoming.length)return;
    setBusy(true);setError('');
    try{for(const f of incoming){const url=await fileUpload(f,'nsa-art-requests');if(!url)throw new Error('Upload failed for '+f.name);setRefs(prev=>prev.some(p=>p.url===url)?prev:[...prev,{name:f.name,url}])}}
    catch(e){setError(e.message||'File upload failed')}
    finally{setBusy(false)}
  };
  const submit=async e=>{
    e.preventDefault();setError('');
    if(!customerId){setError('A customer is required to request art.');return}
    if(!name.trim()){setError('Enter a logo or artwork name.');return}
    if(kind==='web_logo'&&cws.length&&!colorWay){setError('Choose a color way.');return}
    if(kind!=='create_logo'&&!art?.id){setError('Choose an existing art folder for this request.');return}
    if(!instructions.trim()){setError('Add a brief for the artist.');return}
    setBusy(true);
    try{
      if(beforeCreate){const ok=await beforeCreate();if(ok!==true)throw new Error('Save the current artwork before submitting the request.')}
      else if(onSaveNow){const ok=await onSaveNow();if(ok!==true)throw new Error('Save the current artwork before submitting the request.')}
      else if(saveArtFilesNow&&order?.art_files){const ok=await saveArtFilesNow(order.art_files,'Art request');if(ok!==true)throw new Error('Save the current artwork before submitting the request.')}
      const actor=cu||{};
      if(!requestIdRef.current)requestIdRef.current=uid();
      const payload={id:requestIdRef.current,customer_id:customerId,estimate_id:estimateId,so_id:soId,art_id:art?.id||null,art_name:name.trim(),request_type:kind,color_way_id:kind==='web_logo'&&cws.length?colorWay:null,instructions:instructions.trim(),reference_files:refs,assigned_artist:assignedArtist||null,requested_by:actor.id||null,requested_by_name:actor.name||actor.full_name||null,source_art:art?{id:art.id,name:art.name||'',deco_type:art.deco_type||null,color_ways:art.color_ways||[],files:defaultRefs(art),default_logo:kind==='web_logo'&&cws.length===0}:null};
      await service.create(payload);
      requestIdRef.current=null;
      setInstructions('');setAssignedArtist('');await load();
    }catch(e2){setError(e2.message||'Request could not be saved')}
    finally{setBusy(false)}
  };
  const syncEstimate=async()=>{setBusy(true);setError('');try{
    if(beforeCreate&&(await beforeCreate())!==true)throw new Error('Save your changes before syncing estimate artwork.');
    const result=await service.syncConversion(estimateId,soId);onSynced?.(result);await load();
  }catch(e){setError(e.message||'Estimate artwork could not sync')}finally{setBusy(false)}};
  const cancel=async row=>{setBusy(true);setError('');try{await service.transition(row.id,'cancelled');await load()}catch(e){setError(e.message||'Could not cancel request')}finally{setBusy(false)}};
  return <>
    <button type="button" onClick={e=>{e.stopPropagation();setOpen(true)}} className="standalone-art-request-trigger">{children||'🎨 Request art'}</button>
    {open&&createPortal(<div onClick={e=>e.stopPropagation()} className="standalone-art-request-backdrop" role="presentation" onMouseDown={e=>{e.stopPropagation();if(!busy&&e.target===e.currentTarget)setOpen(false)}}><section className="standalone-art-request-dialog" role="dialog" aria-modal="true" aria-label="Request art">
      <header><div><h2>Request art</h2><div className="standalone-art-request-sub">{customer?.name||'Customer'}{order?.id?` · ${order.id}`:''}{art?.name?` · ${art.name}`:''}</div></div><button type="button" aria-label="Close" disabled={busy} onClick={()=>setOpen(false)}>×</button></header>
      <p style={{margin:'14px 20px 0',fontSize:12,color:'#475569'}}>{mode==='estimate'?'Start artwork before estimate approval. ':''}Requests appear in the artist’s Waiting for Art queue. Completed files return to this art folder and the customer library for stores and future jobs. Art requests do not approve an estimate or production artwork.</p>
      <div className="standalone-art-request-body">
        <form onSubmit={submit}><fieldset disabled={busy} style={{border:0,padding:0,margin:0,display:'contents'}}>
          <label>Request type<select value={kind} onChange={e=>setKind(e.target.value)}><option disabled={!art} value="web_logo">Web logo</option><option disabled={!art} value="vectorize">Vectorize existing artwork</option><option value="create_logo">Create a new logo</option></select></label>
          <label>Logo / art name<input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Team crest" /></label>
          {kind==='web_logo'&&(cws.length>0?<label>Color way<select value={colorWay} onChange={e=>setColorWay(e.target.value)}><option value="">Choose a color way…</option>{cws.map((cw,i)=><option key={cwId(cw)||i} value={cwId(cw)}>{cwLabel(cw)}</option>)}</select></label>:<div className="standalone-art-request-default"><b>Logo version</b><span>Default logo (no color ways configured)</span></div>)}
          <label>Brief / instructions<textarea rows="4" value={instructions} onChange={e=>setInstructions(e.target.value)} placeholder="Describe what the artist should make or change." required /></label>
          <label>Assign artist (optional)<select value={assignedArtist} onChange={e=>setAssignedArtist(e.target.value)}><option value="">Unassigned</option>{reps.filter(r=>r.is_active!==false&&['art','artist'].includes(r.role)).map((r,i)=>{const id=r.id||r.name||String(i);return <option key={id} value={r.id||r.name}>{r.name||r.full_name||r.email||'Artist'}</option>})}</select></label>
          <div className="standalone-art-request-files"><b>Reference files</b><label className="standalone-art-request-upload">Add files<input type="file" multiple onChange={e=>{addFiles(e.target.files);e.target.value=''}} /></label>{refs.length?refs.map((f,i)=><div key={`${f.url}-${i}`}><a href={f.url} target="_blank" rel="noreferrer">{f.name}</a><button type="button" onClick={()=>setRefs(xs=>xs.filter((_,j)=>i!==j))}>Remove</button></div>):<small>Existing art files are included automatically.</small>}</div>
          {error&&<div className="standalone-art-request-error" role="alert">{error}</div>}
          <footer><button type="button" onClick={()=>setOpen(false)}>Close</button><button type="submit" disabled={busy}>{busy?'Saving…':'Submit request'}</button></footer>
        </fieldset></form>
        <div className="standalone-art-request-history"><h3>Request history</h3>{soId&&estimateId&&onSynced&&<button type="button" disabled={busy} onClick={syncEstimate}>Sync estimate artwork</button>}{rows.length?rows.map(row=><article key={row.id}><div><b>{row.art_name||'Artwork'} · {row.request_type?.replace('_',' ')}</b><span>{statusLabel(row.status)}</span></div><small>{row.instructions||'No instructions'}{row.assigned_artist?` · ${row.assigned_artist}`:''}</small>{row.result_files?.length>0&&<div>{row.result_files.map((f,i)=><a key={i} href={fileUrl(f)} target="_blank" rel="noreferrer">{fileName(f)}</a>)}</div>}{['requested','in_progress'].includes(row.status)&&<button type="button" disabled={busy} onClick={()=>cancel(row)}>Cancel request</button>}</article>):<p>No requests yet.</p>}</div>
      </div>
    </section></div>,document.body)}
  </>;
}
