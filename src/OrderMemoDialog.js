import React,{useEffect,useRef,useState} from 'react';
import {draftJournal} from './lib/draftJournal';
export const MEMO_DRAFT_TABLE='sales_order_memos';
export const newMemoRequest=()=>crypto.randomUUID();

export default function OrderMemoDialog({initial,owner,saveCommand,onSaved,onClose,onPendingChange,journal=draftJournal}){
  const [command,setCommand]=useState(()=>({...initial,requestId:initial.requestId||newMemoRequest()}));
  const [busy,setBusy]=useState(false),[backingUp,setBackingUp]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(null),[durable,setDurable]=useState(!!initial._draftRecovery);
  const receiptRef=useRef(initial._draftRecovery||null),sequence=useRef(0),busyRef=useRef(false);
  const dirty=(command.memo||'')!==(command.expectedMemo||'')||!!initial._draftRecovery;
  useEffect(()=>{
    onPendingChange?.(dirty||busy);
    const warn=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};
    window.addEventListener('beforeunload',warn);
    return()=>{onPendingChange?.(false);window.removeEventListener('beforeunload',warn);};
  },[dirty,busy,onPendingChange]);
  const persist=async next=>{
    const seq=++sequence.current;setBackingUp(true);
    try{
      const receipt=await journal.stage(String(owner),MEMO_DRAFT_TABLE,next);
      if(seq===sequence.current){receiptRef.current=receipt;setDurable(true);}return receipt;
    }catch(e){
      if(seq===sequence.current){receiptRef.current=e.draftReceipt||null;setDurable(false);setError('Browser recovery is unavailable. Keep this dialog open or download your memo until its cloud save is confirmed.');}
      return e.draftReceipt;
    }finally{if(seq===sequence.current)setBackingUp(false);}
  };
  const edit=value=>{
    const next={...command,memo:value,requestId:newMemoRequest()};setCommand(next);setError('');
    persist(next);
  };
  const acknowledge=async receipt=>{
    if(receipt)await journal.acknowledge(receipt);
    if(initial._draftRecovery&&initial._draftRecovery.revision!==receipt?.revision)await journal.acknowledge(initial._draftRecovery);
  };
  const submit=async(next=command)=>{
    if(busyRef.current)return;
    if(!next.memo?.trim()){setError('Memo is required.');return;}
    busyRef.current=true;setBusy(true);setError('');
    try{
      const receipt=await persist(next);
      const result=await saveCommand(next);
      if(result?.saved===true){
        // Memo versions must not become the version of an unrefreshed full order.
        await onSaved(next.id,result.current_memo,result.current_version);
        try{await acknowledge(receipt);}catch{ /* Keep the recovery copy if cleanup is unavailable; cloud save is confirmed. */ }
        onClose();
      }else if(result?.conflict){setConflict(result);setError('Someone else changed this memo. Review both versions before choosing.');}
      else setError('The memo is not confirmed in the cloud. Your draft remains here; retry Save memo.');
    }catch(e){setError(e.message||'The memo could not be saved. Keep your draft and retry.');}
    finally{busyRef.current=false;setBusy(false);}
  };
  const download=()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({format:'nsa-memo-draft-v1',command},null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=command.id+'-memo-draft.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  return <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="memo-dialog-title" style={{maxWidth:580}}>
    <div className="modal-header"><h2 id="memo-dialog-title">Edit memo · {command.id}</h2></div>
    <div className="modal-body">
      <label htmlFor="memo-command-input">Your memo</label>
      <textarea id="memo-command-input" className="form-input" autoFocus value={command.memo||''} disabled={busy} maxLength={10000} onChange={e=>edit(e.target.value)} rows={3}/>
      {error&&<p role="alert">{error}</p>}
      {backingUp&&<p>Saving recovery copy…</p>}
      {dirty&&durable&&!backingUp&&<p>Recovery copy saved in this browser.</p>}
      {conflict&&<div style={{padding:12,background:'#fff7ed',marginTop:12}}><strong>Current cloud memo</strong><p style={{whiteSpace:'pre-wrap'}}>{conflict.current_memo||'(empty)'}</p>
        <button disabled={busy} onClick={()=>{const next={...command,expectedMemo:conflict.current_memo,requestId:newMemoRequest()};setCommand(next);submit(next);}}>Use my memo instead</button>
      </div>}
    </div>
    <div className="modal-footer" style={{display:'flex',gap:8,flexWrap:'wrap'}}>
      <button disabled={busy||backingUp||(dirty&&!durable)} onClick={onClose}>{dirty?'Close and keep draft':'Cancel'}</button>
      {dirty&&<button onClick={download}>Download memo</button>}
      {dirty&&<button disabled={busy||backingUp} onClick={async()=>{try{await acknowledge(receiptRef.current);onClose();}catch{setError('Could not discard the recovery copy. Your memo is still available.');}}}>Discard memo draft</button>}
      <button className="btn btn-primary" disabled={busy||!dirty} onClick={()=>submit()}>{busy?'Saving…':'Save memo'}</button>
    </div>
  </div></div>;
}
