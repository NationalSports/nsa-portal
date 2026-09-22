import React,{useState} from 'react';
import {reviewCustomerLinkRepair,applyCustomerLinkRepair} from './qbCustomerLinkRepair';
export default function QBCustomerLinkRepair({customerId,qbApi,qbConfig,customers,invoices,salesOrders,persistQbLink,qbSyncing,setQbSyncing}){
  const [targetId,setTargetId]=useState('');
  const [review,setReview]=useState(null);
  const [approved,setApproved]=useState(false);
  const [message,setMessage]=useState('');
  const args={qbApi,qbConfig,customers,invoices,salesOrders,customerId,targetId};
  const current=review&&review.sourceId===String(customerId)&&review.targetId===targetId.trim()&&review.realmId===String(qbConfig.realm_id);
  const run=async(apply)=>{
    setQbSyncing(true);setMessage('');
    try{
      if(apply){
        if(!current)throw new Error('Review the selected customer first.');
        await applyCustomerLinkRepair(args,review,{approved,persistQbLink});
        setMessage('Portal link saved and read back. No QBO customer or transaction changed.');setReview(null);
      }else{setReview(null);setApproved(false);setReview(await reviewCustomerLinkRepair(args));}
    }catch(e){setMessage(e.message);setApproved(false);setReview(null);}
    finally{setQbSyncing(false);}
  };
  return <div className="card" style={{padding:16,marginTop:16}}>
    <h3>Repair the selected customer’s stale QBO link</h3>
    <p>Uses the customer selected above. The old QBO account must be inactive or missing; the replacement must have a unique matching primary email and an active payment term. Linked transactions and IDs claimed by another Portal customer block repair. This never edits QuickBooks.</p>
    <label>Replacement QBO customer ID <input aria-label="Replacement QBO customer ID" value={targetId} onChange={e=>{setTargetId(e.target.value);setReview(null);setApproved(false);}}/></label>
    <button className="btn btn-secondary" disabled={qbSyncing||!customerId||!targetId.trim()} onClick={()=>run(false)}>Review Link Repair — No Changes</button>
    {current&&<><p>{review.customerName}: #{review.previousId} ({review.oldStatus}) → #{review.targetId} {review.targetName} · {review.email} · QBO terms: {review.termName}</p>
      <label><input type="checkbox" checked={approved} onChange={e=>setApproved(e.target.checked)}/> I approve this exact Portal-only link replacement.</label>
      <button className="btn btn-primary" disabled={qbSyncing||!approved} onClick={()=>run(true)}>Save Reviewed Portal Link</button></>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
