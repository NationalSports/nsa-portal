import React, {useCallback,useEffect,useState,useRef} from 'react';
import {draftJournal,DRAFT_CHANGE_KEY} from './lib/draftJournal';
import {supersededDraftReceipts,draftBaseVersion,STALE_DRAFT_MS} from './lib/savedDraftComparison';

export default function DraftRecoveryPanel({owner,onReview,loadSavedVersions,journal=draftJournal}) {
  const [drafts,setDrafts]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const ownerRef=useRef(owner);ownerRef.current=owner;
  const loadSavedRef=useRef(loadSavedVersions);loadSavedRef.current=loadSavedVersions;
  const refreshSequence=useRef(0);
  // Copies stop piling up: drop an older copy a newer one already holds, and a
  // week-old copy whose order was since saved past it and closed out. Best
  // effort only: a failed check leaves every copy listed. One pass at a time;
  // each clear announces a change that would otherwise start another pass.
  const cleaning=useRef(false);
  const clearSuperseded=useCallback(async rows=>{
    if(cleaning.current)return false;
    cleaning.current=true;
    try{
      const mine=rows.filter(d=>d.owner===String(owner)),now=Date.now(),saved=new Map();
      const ids=[...new Set(mine.filter(d=>d.durable&&d.table==='sales_orders'&&now-d.ts>=STALE_DRAFT_MS&&draftBaseVersion(d)!=null).map(d=>d.id))];
      if(ids.length&&loadSavedRef.current){
        try{(await loadSavedRef.current('sales_orders',ids)).forEach(row=>saved.set('sales_orders:'+row.id,row));}catch{}
      }
      const receipts=supersededDraftReceipts(mine,saved,now,d=>!!journal.isSaving?.(d));
      if(!receipts.length||ownerRef.current!==owner)return false;
      await Promise.all(receipts.map(r=>journal.acknowledge(r).catch(()=>false)));
      return true;
    }finally{cleaning.current=false;}
  },[owner,journal]);
  const refresh=useCallback(async()=>{
    const sequence=++refreshSequence.current;
    if(!owner){setDrafts([]);return;}
    try{let rows=await journal.list(String(owner));if(await clearSuperseded(rows))rows=await journal.list(String(owner));if(ownerRef.current===owner&&sequence===refreshSequence.current){setDrafts(rows);setError('');}}
    catch{if(ownerRef.current===owner&&sequence===refreshSequence.current)setError('Draft recovery is unavailable. Keep unsaved work open until its cloud save is confirmed.');}
  },[owner,journal,clearSuperseded]);
  useEffect(()=>{
    setDrafts([]);setError('');
    refresh();
    return()=>{refreshSequence.current++;};
  },[refresh]);
  useEffect(()=>{
    const changed=()=>refresh();
    const storage=e=>{if(e.key===DRAFT_CHANGE_KEY)refresh();};
    const visible=()=>{if(document.visibilityState==='visible')refresh();};
    window.addEventListener('nsa:drafts-changed',changed);
    window.addEventListener('focus',changed);
    window.addEventListener('storage',storage);
    document.addEventListener('visibilitychange',visible);
    return()=>{window.removeEventListener('nsa:drafts-changed',changed);window.removeEventListener('focus',changed);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',visible);};
  },[refresh]);
  // A durable safety copy for a running save is not a recovery task. A failed
  // save or a fresh session exposes it again without deleting any backup.
  // A recovery copy belongs to the signed-in editor, even when that editor
  // is not the order's assigned sales rep (or the order has no customer yet).
  const visibleDrafts=drafts.filter(d=>d.owner===String(owner)&&(!d.durable||!journal.isSaving?.(d)));
  if(!owner||(!visibleDrafts.length&&!error))return null;
  const download=()=>{
    const blob=new Blob([JSON.stringify({format:'nsa-draft-recovery-v1',exportedAt:new Date().toISOString(),drafts:visibleDrafts},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download='nsa-unsaved-drafts.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <details style={{background:'#fff7ed',border:'1px solid #fed7aa',padding:'10px 16px',fontSize:12}}>
    <summary style={{cursor:'pointer',fontWeight:600}}>Draft recovery{visibleDrafts.length?' ('+visibleDrafts.length+')':''}</summary>
    {error&&<p role="alert">{error}</p>}
    <p>These are browser backups, not a save error for the page you are viewing. A copy clears when its own save is confirmed. Older copies from another session stay until you review and save them, or discard them. A copy clears itself once a newer copy holds the same edits, or once it is a week old and the order has since been saved and closed out as complete. Download a backup first if you are unsure.</p>
    <button onClick={refresh}>Refresh drafts</button>{' '}
    {!!visibleDrafts.length&&<button onClick={download}>Download recovery copy</button>}
    {visibleDrafts.length>1&&<>{' '}<button disabled={busy} onClick={async()=>{
      // One step for a stack of old copies: save them all to a file first, then clear them.
      if(!window.confirm('Download all '+visibleDrafts.length+' recovery copies to a file, then clear them from this browser? Saved orders are not changed.'))return;
      setBusy(true);
      try{
        download();
        const results=await Promise.all(visibleDrafts.map(d=>journal.acknowledge({key:d.key,owner:d.owner,revision:d.revision}).catch(()=>false)));
        await refresh();
        if(results.some(r=>!r)&&ownerRef.current===owner)setError('Some recovery copies changed or could not be cleared. They are still listed.');
      }finally{setBusy(false);}
    }}>Download &amp; clear all</button></>}
    {visibleDrafts.map(d=><div key={d.key} style={{borderTop:'1px solid #fed7aa',marginTop:8,paddingTop:8}}>
      <strong>{d.id}</strong> — {d.payload.memo||d.payload.name||'Document draft'} · {new Date(d.ts).toLocaleString()}
      {Array.isArray(d.payload.items)&&<span> · {d.payload.items.length} item lines</span>}
      {!d.durable&&<p role="alert">Only available in this open tab. Download a recovery copy before closing.</p>}
      {' '}<button disabled={busy} onClick={async()=>{
        setBusy(true);
        try{await onReview({...d.payload,_draftRecovery:{key:d.key,owner:d.owner,revision:d.revision}},d.table);}
        catch{setError('Could not open this draft for review. Its recovery copy is still available.');}
        finally{setBusy(false);}
      }}>Review draft</button>
      {' '}<button disabled={busy} onClick={async()=>{
        if(!window.confirm('Discard this recovery copy of '+d.id+'? This removes only this browser backup, not the saved order. Download a recovery copy first if you might need these edits.'))return;
        setBusy(true);
        try{
          const removed=await journal.acknowledge({key:d.key,owner:d.owner,revision:d.revision});
          await refresh();
          if(!removed&&ownerRef.current===owner)setError('This recovery copy changed while you were reviewing it. The newer copy has been kept.');
        }catch{if(ownerRef.current===owner)setError('Could not discard this recovery copy. It is still available.');}
        finally{setBusy(false);}
      }}>Discard recovery copy</button>
    </div>)}
  </details>;
}
