import React,{useState} from 'react';
import {authFetch} from './utils';

const money=value=>'$'+Number(value||0).toFixed(2);
export default function QBPayablePOBillCanaryCard(){
  const[preview,setPreview]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
  async function request(action){
    setBusy(true);setError('');
    try{
      if(action==='execute'&&!window.confirm(`Create exactly one QBO bill linked to an existing purchase order?\n\n${preview.candidate.vendor}\nDocument ${preview.candidate.documentNumber}\n${preview.candidate.poNumber} → QBO PO #${preview.candidate.qboPurchaseOrderId}\n${money(preview.candidate.total)} on ${preview.candidate.date}\n\nThis will create account-based lines linked to the existing PO and verify both records.`))return;
      const response=await authFetch('/.netlify/functions/qbo-payable-po-bill-canary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action==='execute'?{action,approved:true,previewHash:preview.previewHash}:{action:'preview'})});
      const data=await response.json();if(!response.ok)throw new Error((data.error||'PO-to-bill canary unavailable')+(data.details?' · '+JSON.stringify(data.details):''));if(action==='execute'||data.status==='complete')setResult(data);else setPreview(data);
    }catch(e){setError(e.message||'PO-to-bill canary unavailable')}finally{setBusy(false)}
  }
  return <section aria-label="PO-linked bill canary" style={{marginTop:18}}>
    <h2 style={{fontSize:16}}>Bill matched to an existing PO canary</h2>
    <p style={{fontSize:11,color:'#475569'}}>Prepares one verified Portal bill whose purchase order already has a durable QBO mapping. Preparation reads current QBO data and makes no changes.</p>
    <button className="btn btn-secondary btn-sm" disabled={busy||!!result} onClick={()=>request('preview')}>Prepare PO-linked bill canary — No QBO Changes</button>
    {preview&&!result&&<div style={{marginTop:10,padding:10,border:'1px solid #cbd5e1',borderRadius:6}}>
      <p><strong>{preview.candidate.vendor}</strong> · document {preview.candidate.documentNumber} · {preview.candidate.date} · {money(preview.candidate.total)}</p>
      <p>{preview.candidate.poNumber} → QBO PO #{preview.candidate.qboPurchaseOrderId} · 51300 Purchases / 21100 A/P · no item creation or inventory quantity</p>
      <button className="btn btn-sm" disabled={busy} onClick={()=>request('execute')}>Create and verify exactly one PO-linked QBO bill</button>
    </div>}
    {result&&<p role="status">Verified QBO Bill #{result.qboBillId} linked to QBO Purchase Order #{result.qboPurchaseOrderId}. Durable receipts saved.</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
