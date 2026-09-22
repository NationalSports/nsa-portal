import React,{useState} from 'react';
import {authFetch} from './utils';

const money=value=>'$'+Number(value||0).toFixed(2);
export default function QBPayablePOBillCanaryCard(){
  const[preview,setPreview]=useState(null),[repair,setRepair]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
  async function request(action){
    setBusy(true);setError('');
    try{
      if(action==='execute'&&!window.confirm(`Create exactly one QBO bill linked to an existing purchase order?\n\n${preview.candidate.vendor}\nDocument ${preview.candidate.documentNumber}\n${preview.candidate.poNumber} → QBO PO #${preview.candidate.qboPurchaseOrderId}\n${money(preview.candidate.total)} on ${preview.candidate.date}\n\nThis will create account-based merchandise lines linked to the existing PO, preserve reviewed freight on 51000 and Sports Inc fees on 58000, and verify both records.`))return;
      if(action==='repair'&&!window.confirm(`Correct the failed PO-linked bill canary?\n\nDelete partial QBO Bill #${repair.qboBillId} only after its verified replacement exists.\nCreate ${repair.candidate.vendor} document ${repair.candidate.documentNumber} from QBO PO #${repair.candidate.qboPurchaseOrderId}.\nVerify the ${money(repair.candidate.total)} open balance and reciprocal PO link before saving receipts.`))return;
      if(action==='reconcile'&&!window.confirm(`Reconcile the verified QBO correction?\n\nRequire exactly one ${money(repair.candidate.total)} bill for document ${repair.candidate.documentNumber}.\nVerify QBO PO #${repair.candidate.qboPurchaseOrderId} is closed and partial Bills #${repair.partialQboBillIds.join(' and #')} are absent.\nSave Portal ledger and durable mapping receipts. No QBO transactions will be created, changed, or deleted.`))return;
      const body=action==='execute'?{action,approved:true,previewHash:preview.previewHash}:action==='repair'?{action,approved:true,qboBillId:repair.qboBillId}:action==='reconcile'?{action,approved:true}:{action:'preview'};
      const response=await authFetch('/.netlify/functions/qbo-payable-po-bill-canary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data=await response.json();
      if(response.status===401)throw new Error('Portal sign-in expired. Return to QuickBooks Sync, sign in again, then reopen Payable review.');
      if(!response.ok){if((data.repairable||data.reconcilable)&&data.candidate)setRepair(data);throw new Error((data.error||'PO-to-bill canary unavailable')+(data.details?' · '+JSON.stringify(data.details):''))}
      if(action==='execute'||action==='repair'||action==='reconcile'||data.status==='complete')setResult(data);else setPreview(data);
    }catch(e){setError(e.message||'PO-to-bill canary unavailable')}finally{setBusy(false)}
  }
  return <section aria-label="PO-linked bill canary" style={{marginTop:18}}>
    <h2 style={{fontSize:16}}>Bill matched to an existing PO canary</h2>
    <p style={{fontSize:11,color:'#475569'}}>Prepares one verified Portal bill whose purchase order already has a durable QBO mapping. Preparation reads current QBO data and makes no changes.</p>
    <button className="btn btn-secondary btn-sm" disabled={busy||!!result} onClick={()=>request('preview')}>Prepare PO-linked bill canary — No QBO Changes</button>
    {preview&&!result&&<div style={{marginTop:10,padding:10,border:'1px solid #cbd5e1',borderRadius:6}}>
      <p><strong>{preview.candidate.vendor}</strong> · document {preview.candidate.documentNumber} · {preview.candidate.date} · {money(preview.candidate.total)}</p>
      <p>{preview.candidate.poNumber} → QBO PO #{preview.candidate.qboPurchaseOrderId} · 51300 Purchases{preview.candidate.freight>0?' + 51000 Freight In '+money(preview.candidate.freight):''}{preview.candidate.sportsFee>0?' + 58000 Sports Inc Fee '+money(preview.candidate.sportsFee):''} / 21100 A/P · no item creation or inventory quantity</p>
      <button className="btn btn-sm" disabled={busy} onClick={()=>request('execute')}>Create and verify exactly one PO-linked QBO bill</button>
    </div>}
    {repair&&!result&&<div style={{marginTop:10,padding:10,border:'2px solid #b91c1c',borderRadius:6}}>
      {repair.reconcilable?<><p><strong>Reconciliation required:</strong> verify exactly one {money(repair.candidate.total)} QBO bill remains, QBO PO #{repair.candidate.qboPurchaseOrderId} is closed, and partial Bills #{repair.partialQboBillIds.join(' and #')} are absent before saving durable receipts.</p><button className="btn btn-sm" disabled={busy} onClick={()=>request('reconcile')}>Reconcile verified QBO correction — No QBO Changes</button></>:<><p><strong>Approved correction:</strong> partial QBO Bill #{repair.qboBillId} · {money(repair.candidate.freight+repair.candidate.sportsFee)}. Its replacement must verify at {money(repair.candidate.total)} and close QBO PO #{repair.candidate.qboPurchaseOrderId} before the partial bill is deleted.</p><button className="btn btn-sm" disabled={busy} onClick={()=>request('repair')}>Create verified replacement, then delete partial bill</button></>}
    </div>}
    {result&&<p role="status">Verified QBO Bill #{result.qboBillId} linked to QBO Purchase Order #{result.qboPurchaseOrderId}. {result.repaired?`Partial Bill #${result.replacedQboBillId} deleted. `:''}{result.reconciled?`Partial Bills #${result.removedQboBillIds.join(' and #')} confirmed absent. `:''}Durable receipts saved.</p>}
    {error&&<p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
  </section>;
}
