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
    const lost=event=>{if(event.detail?.id===props.order.id&&event.detail?.session===lease.state.session)lease.lose()};
    window.addEventListener('focus',resume);document.addEventListener('visibilitychange',resume);
    window.addEventListener('nsa:edit-lease-lost',lost);
    return()=>{mounted.current=false;clearInterval(tick);clearInterval(renew);window.removeEventListener('focus',resume);document.removeEventListener('visibilitychange',resume);window.removeEventListener('nsa:edit-lease-lost',lost);Promise.resolve().then(()=>{if(!mounted.current)lease.close()})};
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
        onBack={props.onBack}/>
    </div>:<SalesOrderReadView order={props.order} customer={props.customer}/>}
  </div>;
}
export function SalesOrderReadView({order,customer}) {
  return <section aria-label="Sales order details" className="card" style={{padding:20}}>
    <h2>{order.id} · {customer?.name||'Sales order'}</h2>
    <p>{order.memo}</p><p>Status: {order.status||'Open'}{order.po_number?' · Customer PO: '+order.po_number:''}</p>
    {order._itemsHydrated===false&&<p>Order details are still loading.</p>}
    <div style={{overflowX:'auto'}}><table style={{width:'100%',textAlign:'left'}}>
      <thead><tr><th>Item</th><th>Color</th><th>Sizes / quantities</th><th>Decoration</th><th>Purchase orders</th></tr></thead>
      <tbody>{(order.items||[]).map((item,i)=><tr key={item.line_id||i}>
        <td>{item.sku} {item.name}</td><td>{item.color}</td>
        <td>{Object.entries(item.sizes||{}).map(([size,qty])=>size+': '+qty).join(', ')||item.qty_only||item.est_qty||'—'}</td>
        <td>{(item.decorations||[]).map((d,i)=><div key={i}>{d.name||d.type||d.kind||'Decoration'} {d.location||''}</div>)}</td>
        <td>{(item.po_lines||[]).map((p,i)=><div key={i}>{p.po_id} · {p.status||'Open'}</div>)}</td>
      </tr>)}</tbody>
    </table></div>
    {!!order.jobs?.length&&<><h3>Production</h3><ul>{order.jobs.map(job=><li key={job.id}>{job.id} · {job.art_name||''} · {job.prod_status||job.status||'Open'}</li>)}</ul></>}
    {!!order.art_files?.length&&<><h3>Artwork</h3><ul>{order.art_files.map((art,i)=><li key={art.id||i}>{art.name||art.id} · {art.status||''}</li>)}</ul></>}
  </section>;
}
