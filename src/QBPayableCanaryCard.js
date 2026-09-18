import React,{useState} from 'react';
import {authFetch} from './utils';

const money=value=>'$'+Number(value||0).toFixed(2);
export default function QBPayableCanaryCard(){
  const[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
  async function request(action){
    setBusy(true);setError('');
    try{
      if(action==='execute'&&!window.confirm(`Create exactly one QBO bill?\n\n${preview.candidate.vendor}\nDocument ${preview.candidate.documentNumber}\n${money(preview.candidate.total)} on ${preview.candidate.date}\n\nThis will post one line to 51300 and verify the QBO record.`))return;
      const response=await authFetch('/.netlify/functions/qbo-payable-canary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='execute'?{action,approved:true,previewHash:preview.previewHash}:{action:'preview'})});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Canary unavailable');
      if(action==='execute')setResult(data);else setPreview(data);
    }catch(e){setError(e.message||'Canary unavailable')}finally{setBusy(false)}
  }
  return <section aria-label="Payable canary" style={{marginTop:18}}>
    <h2 style={{fontSize:16}}>Single-bill canary</h2>
    <p style={{fontSize:11,color:'#475569'}}>Prepares the smallest verified Portal-origin bill. Preparation reads current QBO data and makes no changes. Execution creates one account-based bill, performs API read-back, and records durable receipts.</p>
    <button className="btn btn-secondary btn-sm" disabled={busy||!!result} onClick={()=>request('preview')}>Prepare smallest bill canary — No QBO Changes</button>
    {preview&&!result&&<div style={{marginTop:10,padding:10,border:'1px solid #cbd5e1',borderRadius:6}}>
      <p><strong>{preview.candidate.vendor}</strong> · document {preview.candidate.documentNumber} · {preview.candidate.date} · {money(preview.candidate.total)}</p>
      <p>Portal ledger {preview.candidate.ledgerId} · {preview.candidate.poNumber} · 51300 Purchases / 21100 A/P · no item creation or inventory quantity</p>
      <button className="btn btn-sm" disabled={busy} onClick={()=>request('execute')}>Create and verify exactly one QBO bill</button>
    </div>}
    {result&&<p role="status">Verified QBO Bill #{result.qboBillId}. Durable receipts saved.</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
