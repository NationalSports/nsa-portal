import React, {useCallback,useEffect,useState,useRef} from 'react';
import {draftJournal} from './lib/draftJournal';

export default function DraftRecoveryPanel({owner,onReview,journal=draftJournal}) {
  const [drafts,setDrafts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const ownerRef=useRef(owner);ownerRef.current=owner;
  const refresh=useCallback(async()=>{
    if(!owner){setDrafts([]);return;}
    try{const rows=await journal.list(String(owner));if(ownerRef.current===owner){setDrafts(rows);setError('');}}
    catch{setError('Draft recovery is unavailable. Keep unsaved work open until its cloud save is confirmed.');}
  },[owner,journal]);
  useEffect(()=>{
    let active=true;
    setDrafts([]);setError('');
    journal.list(String(owner||'')).then(rows=>{if(active)setDrafts(rows);},()=>{if(active&&owner)setError('Draft recovery is unavailable. Keep unsaved work open until its cloud save is confirmed.');});
    return()=>{active=false;};
  },[owner,journal]);
  useEffect(()=>{
    const changed=()=>refresh();
    window.addEventListener('nsa:drafts-changed',changed);
    window.addEventListener('focus',changed);
    return()=>{window.removeEventListener('nsa:drafts-changed',changed);window.removeEventListener('focus',changed);};
  },[refresh]);
  if(!owner||(!drafts.length&&!error))return null;
  const download=()=>{
    const blob=new Blob([JSON.stringify({format:'nsa-draft-recovery-v1',exportedAt:new Date().toISOString(),drafts},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='nsa-unsaved-drafts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <details style={{background:'#fff7ed',border:'1px solid #fed7aa',padding:'10px 16px',fontSize:12}}>
    <summary style={{cursor:'pointer',fontWeight:600}}>Draft recovery{drafts.length?' ('+drafts.length+')':''}</summary>
    {error&&<p role="alert">{error}</p>}
    <p>These are recovery copies from this browser. Review a copy before applying it; another tab may still be saving. Copies are cleared when their save is confirmed.</p>
    <button onClick={refresh}>Refresh drafts</button>{' '}
    {!!drafts.length&&<button onClick={download}>Download recovery copy</button>}
    {drafts.filter(d=>d.owner===String(owner)).map(d=><div key={d.key} style={{borderTop:'1px solid #fed7aa',marginTop:8,paddingTop:8}}>
      <strong>{d.id}</strong> — {d.payload.memo||d.payload.name||'Document draft'} · {new Date(d.ts).toLocaleString()}
      {Array.isArray(d.payload.items)&&<span> · {d.payload.items.length} item lines</span>}
      {!d.durable&&<p role="alert">Only available in this open tab. Download a recovery copy before closing.</p>}
      {' '}<button disabled={busy} onClick={async()=>{
        setBusy(true);
        try{await onReview({...d.payload,_draftRecovery:{key:d.key,owner:d.owner,revision:d.revision}},d.table);}
        catch{setError('Could not open this draft for review. Its recovery copy is still available.');}
        finally{setBusy(false);}
      }}>Review draft</button>
    </div>)}
  </details>;
}
