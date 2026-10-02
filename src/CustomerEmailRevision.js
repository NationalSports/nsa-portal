import React,{useState} from 'react';
import {calcOrderTotals} from './pricing';
import {_loadArtRow} from './constants';
export function revisionOrder(snapshot,removed=[]){
 const ids=new Set(removed.map(i=>i.id));
 return {...snapshot.estimate,art_files:(snapshot.art||[]).map(_loadArtRow),items:(snapshot.items||[]).filter(i=>!ids.has(i.id)).map(i=>({...i,decorations:(snapshot.decorations||[]).filter(d=>d.estimate_item_id===i.id).map(d=>({...d,art_file_id:d.art_file_id|| (d.art_tbd_type?'__tbd':null)}))}))};
}
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
export default function CustomerEmailRevision({revision,busy,accountChanged,action,onOpenEstimate}){
 const [error,setError]=useState('');
 const open=async id=>{try{setError('');await onOpenEstimate(id)}catch(e){setError(e.message)}};
 const s=revision.snapshot,removed=revision.removed||[];
 const totals=s&&['ready','created'].includes(revision.state)?{before:calcOrderTotals(revisionOrder(s),s.customer?.tax_rate||0),after:calcOrderTotals(revisionOrder(s,removed),s.customer?.tax_rate||0)}:null;
 return <div className="email-work-revision">
  <h4>{revision.state==='already_removed'?'Removal already reflected':'Revise existing estimate'}{revision.estimate_id?' · '+revision.estimate_id:''}</h4>
  <p>{s?.customer?.name} {s?.estimate?.memo&&' · '+s.estimate.memo} {s?.estimate?.status&&' · '+s.estimate.status}</p>
  <p>{revision.state==='created'?'Revision draft '+revision.revised_estimate_id+' is ready. The original quote is unchanged.':revision.reason}</p>
  {error&&<p role="alert">{error}</p>}
  {(revision.requests||[]).map((r,i)=><blockquote key={i}>{r.evidence}</blockquote>)}
  {removed.map(i=><p key={i.id}><strong>Remove:</strong> {i.name} · {i.sku} · {i.color} · {Object.values(i.sizes||{}).reduce((a,b)=>a+Number(b),0)||i.est_qty} units at {money(i.unit_sell)} each</p>)}
  {totals&&<><table><thead><tr><th>Amount</th><th>Original</th><th>Revised draft</th></tr></thead><tbody>{[['Items and decoration','rev'],['Shipping','ship'],['Tax','tax'],['Total','grand']].map(([label,key])=><tr key={key}><th>{label}</th><td>{money(totals.before[key])}</td><td>{money(totals.after[key])}</td></tr>)}</tbody></table><p>Totals use the estimate’s current pricing and your portal’s calculator. Review decoration volume pricing, size upcharges, tax and shipping before sending.</p></>}
  <div className="email-work-buttons">
   {revision.state==='ready'&&<button className="btn btn-primary" disabled={!!busy||accountChanged} onClick={async()=>{const d=await action('create_revision');if(d?.estimateId)await open(d.estimateId)}}>Create reviewed revision draft</button>}
   {revision.revised_estimate_id&&<button className="btn btn-primary" disabled={!!busy} onClick={()=>open(revision.revised_estimate_id)}>Open revision draft</button>}
   {revision.estimate_id&&<button className="btn btn-secondary" disabled={!!busy} onClick={()=>open(revision.estimate_id)}>Open original estimate</button>}
   <button className="btn btn-secondary" disabled={!!busy} onClick={()=>action('prepare',{retry:true})}>Re-read conversation</button>
  </div>
  <small>The original quote is preserved. Creating a revision draft does not send email or create a sales order.</small>
 </div>;
}
