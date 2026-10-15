import React,{useEffect,useRef,useState} from 'react';
import {createSalesOrderEditLease} from './lib/salesOrderEditLease';
import {loadRecoveryDocument} from './lib/loadRecoveryDocument';
import {currentDraftOwner} from './lib/draftJournal';

// Viewing never mounts the side-effectful editor. Both classic and redesigned
// editors enter through this gate; the database remains the authority on saves.
export default function SalesOrderEditGate({enabled=process.env.REACT_APP_SO_EDIT_LEASES==='1',editor:Editor,...props}) {
  // Stage one can ship the outbox repair independently. Enable the gate only
  // after the migration and role-specific preview checks in the rollout guide.
  const pilotOrderId=process.env.REACT_APP_SO_EDIT_PILOT_ORDER_ID;
  if(!enabled||(pilotOrderId&&props.order?.id!==pilotOrderId))return <Editor {...props}/>;
  return <EnabledSalesOrderEditGate editor={Editor} {...props}/>;
}
export function EnabledSalesOrderEditGate({editor:Editor,...props}) {
  const [state,setState]=useState({phase:'view'});
  const [loaded,setLoaded]=useState(null);
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const recovery=useRef(null);
  const target=props.recoveryEditorRef||recovery;
  const controller=useRef(null);
  const mounted=useRef(true);
  const preserved=useRef(false);
  if(!controller.current)controller.current=createSalesOrderEditLease({client:props.supabase,id:props.order.id,onChange:setState});
  const lease=controller.current;
  useEffect(()=>{
    mounted.current=true;
    const tick=setInterval(()=>{lease.canSave()},1000);
    const renew=setInterval(()=>{lease.renew()},30000);
    const resume=()=>{if(document.visibilityState==='visible')lease.renew()};
    const pagehide=()=>lease.closeOnPageHide();
    const lost=event=>{if(event.detail?.id===props.order.id&&event.detail?.session===lease.state.session)lease.lose()};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    window.addEventListener('pagehide',pagehide);
    window.addEventListener('nsa:edit-lease-lost',lost);
    return()=>{mounted.current=false;clearInterval(tick);clearInterval(renew);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('pagehide',pagehide);window.removeEventListener('nsa:edit-lease-lost',lost);Promise.resolve().then(()=>{if(!mounted.current)lease.close()})};
  },[lease,props.order.id]);
  useEffect(()=>{
    if(state.phase!=='lost'||!loaded)return;
    let cancelled=false,running=false;
    const preserve=async()=>{
      if(cancelled||running||preserved.current||!target.current)return;
      running=true;
      try{await target.current.preserve(currentDraftOwner(),row=>({...row,_editLease:{session:lease.state.session,generation:lease.state.generation}}));preserved.current=true;if(!cancelled)setMessage('Editing paused. A recovery copy of your draft is saved in this browser.');}
      catch(error){if(!cancelled)setMessage(error.message+' Keep this tab open.');}
      finally{running=false;}
    };
    preserve();const timer=setInterval(preserve,2000);
    return()=>{cancelled=true;clearInterval(timer)};
  },[state.phase,loaded,lease,target]);
  const begin=async takeover=>{
    if(busy)return;
    if(takeover&&!window.confirm('Take over editing? The other tab will stop being able to save this order. Its draft will remain available for review.'))return;
    setBusy(true);setMessage('');
    try{
      const result=await lease.acquire(takeover);
      if(result.phase!=='editing')return;
      // Never grant a new fence to an old snapshot, even in the same user's tab.
      const {row}=await loadRecoveryDocument(props.supabase,'sales_orders',props.order.id);
      if(mounted.current&&lease.canSave()){const current=lease.stamp(row);setLoaded(current);props.onLeaseLoaded?.(current);}
    }catch(error){lease.lose('Could not load the complete saved order.');setMessage(error.message)}
    finally{if(mounted.current)setBusy(false)}
  };
  const blocked=()=>{props.nf?.('Editing is paused. Your draft is kept; reopen the saved order before continuing.','error');return false};
  const save=fn=>payload=>{
    const stamped=lease.stamp(payload);return stamped&&fn?fn(stamped):blocked();
  };
  const back=async()=>{
    if(busy)return;
    setBusy(true);
    try{
      if(loaded&&target.current&&!preserved.current){
        // Preserve the actual editor, including buffered inputs, before unmounting.
        await target.current.preserve(currentDraftOwner(),row=>({...row,_editLease:{session:lease.state.session,generation:lease.state.generation}}));
      }
      await lease.close();props.onBack();
    }catch(error){setMessage(error.message);setBusy(false)}
  };
  // Parent refreshes may carry new child data; the editor's existing reconciliation
  // handles those after the authoritative initial load. Never switch IDs here.
  const order=loaded?(props.order._editLease?.session===lease.state.session?props.order:loaded):props.order;
  return <div>
    <div role="status" style={{padding:12,marginBottom:12,border:'1px solid #cbd5e1',borderRadius:8,background:state.phase==='lost'?'#fff7ed':'#f8fafc',display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}>
      <strong>{state.phase==='editing'&&loaded?'Editing in this tab':state.phase==='lost'?'Editing paused':'View only'}</strong>
      <span>{message||state.message||(state.holder?state.holder+' is editing this order.':'Anyone can view this order. One tab can edit at a time.')}</span>
      {!loaded&&state.phase!=='lost'&&<button className="btn btn-primary" disabled={busy} onClick={()=>begin(false)}>{busy?'Opening…':'Edit order'}</button>}
      {!loaded&&state.can_takeover&&<button className="btn" disabled={busy} onClick={()=>begin(true)}>Take over editing</button>}
      <button className="btn" disabled={busy} onClick={back}>{loaded?'Keep draft & close':'Back'}</button>
    </div>
    {loaded?<div inert={state.phase==='editing'?undefined:''} aria-disabled={state.phase!=='editing'}>
      <Editor {...props} order={order} recoveryEditorRef={target}
        onSave={save(props.onSave)} onSaveNow={save(props.onSaveNow)} onEmergencySave={save(props.onEmergencySave)}
        onSaveArtFiles={props.onSaveArtFiles?save(props.onSaveArtFiles):undefined}
        onBack={props.onBack}/>
    </div>:<SalesOrderReadView order={props.order} customer={props.customer}/>}
  </div>;
}
export function SalesOrderReadView({order,customer}) {
  const [tab,setTab]=useState('items');
  const tabs=[['items','Line Items'],['art','Art Library'],['jobs','Jobs']];
  const field=(label,value)=><div style={{minWidth:150,flex:'1 1 150px'}}><div style={{fontSize:10,fontWeight:700,color:'#64748b',marginBottom:5}}>{label}</div><div style={{minHeight:35,padding:'8px 10px',border:'1px solid #e2e8f0',borderRadius:6,background:'#f8fafc',fontSize:12,color:'#334155'}}>{value||'—'}</div></div>;
  return <section aria-label="Sales order details" style={{color:'#334155'}}>
    <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',padding:'12px 16px',background:'white',border:'1px solid #e2e8f0',borderRadius:8,marginBottom:12}}>
      <strong style={{color:'#1e40af',fontSize:15}}>{order.id}</strong>
      <span style={{padding:'3px 9px',borderRadius:12,background:'#f1f5f9',color:'#475569',fontSize:11,fontWeight:700}}>{(order.status||'Open').replace(/_/g,' ')}</span>
      <span style={{color:'#1e40af',fontSize:12,fontWeight:600}}>{customer?.name||''}</span>
      <span style={{color:'#64748b',fontSize:12,flex:1}}>{order.memo||''}</span>
    </div>
    <div className="card" style={{padding:16,marginBottom:12}}>
      <div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
        {field('Customer',customer?.name)}{field('Memo',order.memo)}{field('School PO #',order.po_number)}{field('Need-by',order.need_by||order.due_date)}
      </div>
    </div>
    <nav aria-label="Sales order sections" style={{display:'flex',gap:4,borderBottom:'1px solid #cbd5e1',marginBottom:12}}>
      {tabs.map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} aria-current={tab===key?'page':undefined} style={{padding:'10px 16px',border:0,borderBottom:tab===key?'3px solid #2563eb':'3px solid transparent',background:'transparent',color:tab===key?'#1d4ed8':'#64748b',fontWeight:700,cursor:'pointer'}}>{label}</button>)}
    </nav>
    {tab==='items'&&<div>
      {order._itemsHydrated===false&&<div role="status" style={{padding:12}}>Order details are still loading.</div>}
      {(order.items||[]).map((item,i)=><div key={item.line_id||i} className="card" style={{padding:16,marginBottom:12}}>
        <div style={{display:'flex',gap:10,alignItems:'baseline',flexWrap:'wrap'}}><strong style={{color:'#1e40af'}}>{item.sku||'Item'}</strong><strong>{item.name||''}</strong><span>{item.color||''}</span></div>
        <div style={{marginTop:12,display:'flex',gap:16,flexWrap:'wrap',fontSize:12}}>
          <div><strong>Sizes:</strong> {Object.entries(item.sizes||{}).map(([size,qty])=>size+': '+qty).join('   ')||item.qty_only||item.est_qty||'—'}</div>
          {!!item.decorations?.length&&<div><strong>Decoration:</strong> {item.decorations.map(d=>[d.name||d.type||d.kind||'Decoration',d.location].filter(Boolean).join(' · ')).join(', ')}</div>}
          {!!item.po_lines?.length&&<div><strong>Purchase orders:</strong> {item.po_lines.map(p=>[p.po_id,p.status].filter(Boolean).join(' · ')).join(', ')}</div>}
        </div>
      </div>)}
      {!order.items?.length&&order._itemsHydrated!==false&&<div className="card" style={{padding:16}}>No line items.</div>}
    </div>}
    {tab==='art'&&<div className="card" style={{padding:16}}>{(order.art_files||[]).map((art,i)=><div key={art.id||i} style={{padding:'8px 0',borderBottom:'1px solid #e2e8f0'}}>{art.name||art.id} {art.status&&'· '+art.status}</div>)}{!order.art_files?.length&&'No artwork attached.'}</div>}
    {tab==='jobs'&&<div className="card" style={{padding:16}}>{(order.jobs||[]).map((job,i)=><div key={job.id||i} style={{padding:'8px 0',borderBottom:'1px solid #e2e8f0'}}>{job.id} · {job.art_name||'Production job'} · {job.prod_status||job.status||'Open'}</div>)}{!order.jobs?.length&&'No production jobs.'}</div>}
  </section>;
}
