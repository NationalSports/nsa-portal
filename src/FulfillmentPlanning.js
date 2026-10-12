import React, { useState } from 'react';
import { authFetch } from './utils';
const fmt=value=>value==null?'Learning':Number(value).toFixed(1);
export default function FulfillmentPlanning({ onOpenJob }) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const load=async()=>{setOpen(true);setBusy(true);setError('');try{const r=await authFetch('/.netlify/functions/fulfillment-planning');const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);}catch(e){setError(e.message);}finally{setBusy(false);}};
 return <div className="card" style={{marginBottom:12}}>
  <div className="card-header"><h2>Production planning estimates</h2><button className="btn btn-sm btn-secondary" disabled={busy} onClick={load}>{busy?'Loading…':data?'Refresh estimates':'Show estimates'}</button>{open&&<button className="btn btn-sm btn-secondary" onClick={()=>setOpen(false)}>Hide</button>}</div>
  {open&&<div className="card-body">
   {error&&<p role="alert">{error}</p>}
   {data&&<>
    <p style={{fontSize:12,color:'#64748b'}}>Based on the last 60 days of recorded work from the same season. Production defaults to 7–8 business days in Aug/Sep/Dec/Jan and 5 otherwise; workload can extend this. In-process jobs go first, then released jobs by due date. Work awaiting stock, artwork, or materials is not scheduled. These forecasts do not move jobs or reserve a machine.</p>
    <div style={{overflowX:'auto'}}><table style={{width:'100%',fontSize:12}}><thead><tr><th>Decoration</th><th>Completed jobs</th><th>Jobs / business day</th><th>Units / business day</th><th>Typical run hours (80th percentile)</th></tr></thead><tbody>
     {Object.values(data.model.methods).map(m=><tr key={m.method}><td>{m.method}</td><td>{m.completed_jobs} across {m.active_days} days</td><td>{fmt(m.jobs_per_day)}</td><td>{fmt(m.units_per_day)}</td><td>{fmt(m.run_minutes==null?null:m.run_minutes/60)}</td></tr>)}
    </tbody></table></div>
    <p style={{fontSize:12}}>Check-in: {data.model.checkin.days} business days · {data.model.checkin.qualified?'learned from':'default while learning from'} {data.model.checkin.samples} completed arrival batches. Production learns after at least 10 completed jobs across 5 working days; job-size timing requires 10 comparable runs.</p>
    <div style={{overflowX:'auto',maxHeight:360}}><table style={{width:'100%',fontSize:12}}><thead><tr><th>Job</th><th>Method</th><th>Units</th><th>Estimated start</th><th>Estimated production finish</th></tr></thead><tbody>
     {data.plan.slice(0,200).map(p=><tr key={p.so_id+'|'+p.job_id}><td><button className="btn btn-sm btn-secondary" onClick={()=>onOpenJob?.(p)}>{p.so_id} · {p.job_id}</button></td><td>{p.method}</td><td>{p.units}</td><td>{p.start_date||'—'}</td><td style={{color:p.finish_date&&p.expected_date&&p.finish_date>p.expected_date?'#b45309':undefined}}>{p.finish_date||p.reason}{p.finish_date&&p.expected_date&&p.finish_date>p.expected_date?' · past requested date':''}</td></tr>)}
    </tbody></table></div>
    <div style={{fontSize:11,color:'#64748b',marginTop:8}}>Showing {Math.min(200,data.plan.length)} of {data.plan.length} jobs. Updated {new Date(data.model.calculated_at).toLocaleString()}. Business days exclude weekends; holidays and staffing changes require review.</div>
   </>}
  </div>}
 </div>;
}
export function DockArrivalButton({ buildLines }) {
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[request,setRequest]=useState(null);
 const record=async()=>{
  const lines=buildLines();if(!lines.length){setMessage('Enter the quantities that have arrived first.');return;}
  const signature=JSON.stringify(lines), id=request?.signature===signature?request.id:crypto.randomUUID();
  setRequest({signature,id});setBusy(true);setMessage('');
  try{const r=await authFetch('/.netlify/functions/fulfillment-planning',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'record_arrival',request_id:id,lines})});const d=await r.json();if(!r.ok)throw new Error(d.error);setMessage('Dock arrival recorded. Confirm Received after checking these items in.');}catch(e){setMessage(e.message);}finally{setBusy(false);}
 };
 return <div style={{fontSize:12,flexBasis:'100%',padding:'8px 0'}}>
  <button className="btn btn-sm btn-secondary" disabled={busy} onClick={record}>{busy?'Recording…':'Record selected quantities at dock'}</button>
  <span style={{marginLeft:8}}>Record when cartons arrive, before check-in. Use the quantities entered in this receipt.</span>
  {message&&<div role="status" style={{marginTop:5}}>{message}</div>}
 </div>;
}
