import React, {useState} from 'react';

export default function StoreCloseoutReview({status,onSubmit,onCancel,onJobs}) {
  const [checks,setChecks]=useState(()=>status.review?.confirmations||{});
  const [note,setNote]=useState(status.review?.note||'');
  const [nextCheck,setNextCheck]=useState(status.review?.next_check||new Date(Date.now()+86400000).toISOString().slice(0,10));
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const outside=status.outside||[];
  const missing=outside.some(s=>!checks.outside?.[s.key]?.shipped||!checks.outside?.[s.key]?.costs||(checks.outside?.[s.key]?.evidence||'').trim().length<3);
  const ready=!status.save_pending&&!status.blocking_jobs.length&&!missing&&checks.shipped===true&&checks.costs===true;
  const setOutside=(key,field,value)=>setChecks(c=>({...c,outside:{...c.outside,[key]:{...c.outside?.[key],[field]:value}}}));
  const submit=async action=>{setBusy(true);setError('');try{await onSubmit({action,version:status.version,token:status.token,confirmations:checks,note,nextCheck})}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="modal-overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="closeout-title" style={{width:'calc(100vw - 32px)',maxWidth:760,maxHeight:'90vh',overflowY:'auto',padding:24,borderRadius:12,boxSizing:'border-box'}}>
    <h2 id="closeout-title">Close Store — {status.so_id}</h2>
    {status.save_pending&&<p role="alert">This order has unsaved or unconfirmed changes. The review below shows saved records. Save and reload before closing; you can still assign a follow-up.</p>}
    {status.five_week_date&&<p>Rep review due five weeks from sales-order creation: <strong>{status.five_week_date}</strong>. This is a review date; it does not automatically close the store or release commissions.</p>}
    {!!status.blocking_jobs.length&&<div role="alert" style={{background:'#fff1f2',padding:12,borderRadius:8}}>
      <strong>These jobs are blocking closeout</strong><ul>{status.blocking_jobs.map(j=><li key={j.id}>{j.name} · {j.id} · {j.status.replace(/_/g,' ')}</li>)}</ul>
      <p>Finish the work, or verify fulfillment and correct an incorrect job status. Closing will not override these jobs.</p>
      <button className="btn btn-secondary" onClick={onJobs} disabled={busy}>Review jobs</button>
    </div>}
    {outside.length>0&&<><h3>Outside vendors and decorators</h3><p>Review every group below. Shipping from a decorator back to NSA is not final shipment to families.</p>
      {outside.map(s=><fieldset key={s.key} style={{padding:12,margin:'12px 0',border:'1px solid #cbd5e1',borderRadius:8,minWidth:0}}><legend>{s.vendor} — {s.label}</legend>
        <label style={{display:'block'}}><input type="checkbox" checked={!!checks.outside?.[s.key]?.shipped} onChange={e=>setOutside(s.key,'shipped',e.target.checked)}/> All items in this group have shipped to families / final delivery is confirmed</label>
        <label style={{display:'block'}}><input type="checkbox" checked={!!checks.outside?.[s.key]?.costs} onChange={e=>setOutside(s.key,'costs',e.target.checked)}/> Final vendor, decoration and freight costs are recorded, including any rework</label>
        <label style={{display:'block',marginTop:8}}>Shipment evidence and final-cost reference<textarea style={{width:'100%',boxSizing:'border-box',padding:8,fontFamily:'inherit',border:'1px solid #cbd5e1',borderRadius:6}} value={checks.outside?.[s.key]?.evidence||''} onChange={e=>setOutside(s.key,'evidence',e.target.value)} placeholder="Tracking / delivery confirmation and vendor bill or cost reference" maxLength={2000}/></label>
      </fieldset>)}
    </>}
    <label style={{display:'block',marginTop:12}}><input type="checkbox" checked={!!checks.shipped} onChange={e=>setChecks(c=>({...c,shipped:e.target.checked}))}/> Every store item has shipped to families, including partial shipments and replacements</label>
    <label style={{display:'block',marginTop:8}}><input type="checkbox" checked={!!checks.costs} onChange={e=>setChecks(c=>({...c,costs:e.target.checked}))}/> All final costs are recorded, including garments, decoration, freight and platform fees</label>
    <h3>Rep follow-up</h3><p>Missing anything? Save this review with the next check date. No invoice or payment will be created by saving a follow-up.</p>
    <label>Next check <input type="date" value={nextCheck} onChange={e=>setNextCheck(e.target.value)}/></label>
    <label style={{display:'block'}}>What is missing / next action<textarea style={{width:'100%',boxSizing:'border-box',padding:8,fontFamily:'inherit',border:'1px solid #cbd5e1',borderRadius:6}} value={note} onChange={e=>setNote(e.target.value)} maxLength={2000}/></label>
    {!status.assigned_to&&<p role="alert">No active rep is assigned. Assign an active rep on the sales order before saving a follow-up.</p>}
    {error&&<p role="alert">{error}</p>}
    <div style={{display:'flex',gap:8,marginTop:16}}>
      <button className="btn btn-secondary" disabled={busy} onClick={onCancel}>Cancel</button>
      <button className="btn btn-secondary" disabled={busy||!status.assigned_to||!nextCheck||!note.trim()} onClick={()=>submit('follow_up')}>Save review &amp; rep follow-up</button>
      <button className="btn btn-primary" disabled={busy||!ready} onClick={()=>submit('close')}>{busy?'Saving…':'Close Store & apply payments'}</button>
    </div>
  </section></div>;
}
