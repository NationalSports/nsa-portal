import React,{useState} from 'react';
import {authFetch} from './utils';

const money=value=>'$'+Number(value||0).toFixed(2);
export default function QBPayablePOCanaryCard(){
  const[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
  async function request(action){
    setBusy(true);setError('');
    try{
      if(action==='execute'&&!window.confirm(`Create exactly one QBO purchase order?\n\n${preview.candidate.vendor}\n${preview.candidate.poId}\n${money(preview.candidate.total)} on ${preview.candidate.date}\n\nThis will post one account-based PO line to 51300 and verify the QBO record.`))return;
      const response=await authFetch('/.netlify/functions/qbo-payable-po-canary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='execute'?{action,approved:true,previewHash:preview.previewHash}:{action:'preview'})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'PO canary unavailable');if(action==='execute'||data.status==='complete')setResult(data);else setPreview(data);
    }catch(e){setError(e.message||'PO canary unavailable')}finally{setBusy(false)}
  }
  return <section aria-label="Purchase-order canary" style={{marginTop:18}}>
    <h2 style={{fontSize:16}}>Single purchase-order canary</h2>
    <p style={{fontSize:11,color:'#475569'}}>Prepares the smallest verified Portal PO with a durable vendor mapping. Execution creates one account-based PO, performs API read-back, and saves its durable mapping.</p>
    <button className="btn btn-secondary btn-sm" disabled={busy||!!result} onClick={()=>request('preview')}>Prepare smallest PO canary — No QBO Changes</button>
    {preview&&!result&&<div style={{marginTop:10,padding:10,border:'1px solid #cbd5e1',borderRadius:6}}>
      <p><strong>{preview.candidate.vendor}</strong> · {preview.candidate.poId} · {preview.candidate.date} · {money(preview.candidate.total)}</p>
      <p>51300 Purchases · one account-based line · no item creation or inventory quantity</p>
      <button className="btn btn-sm" disabled={busy} onClick={()=>request('execute')}>Create and verify exactly one QBO purchase order</button>
    </div>}
    {result&&<p role="status">Verified QBO Purchase Order #{result.qboPurchaseOrderId}. Durable mapping saved.</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
