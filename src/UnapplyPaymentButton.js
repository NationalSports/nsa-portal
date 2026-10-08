import React, {useState} from 'react';
import {authFetch} from './utils';
import {canReceivePayments} from './lib/receivePaymentsAccess';

export default function UnapplyPaymentButton({invoice, payment, user, onSaved, nf}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  if (!canReceivePayments(user) || invoice._hist || !payment.ref
    || !['check','ach','cash','venmo','zelle'].includes(payment.method) || Number(payment.cc_fee)>0) return null;
  const save = async () => {
    if (saving || reason.trim().length<3) return;
    setSaving(true);
    try {
      const response = await authFetch('/.netlify/functions/unapply-invoice-payment', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({invoiceId:invoice.id,paymentRef:payment.ref,payment,reason,confirmed:true}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not unapply payment');
      if (!data.invoice || !Array.isArray(data.payments)) throw new Error('Unapplication was not confirmed. Reload before retrying.');
      onSaved(data);
      nf(data.qbo_review_required
        ? 'Unapplied in the portal. QuickBooks is unchanged; the receipt is held for accounting reconciliation.'
        : 'Payment unapplied. The money is available in Receive Payments.');
      setOpen(false);
    } catch (e) { nf(e.message, 'error'); }
    finally { setSaving(false); }
  };
  return <>
    <button className="btn btn-sm btn-secondary" onClick={()=>setOpen(true)}>Unapply</button>
    {open && <div className="modal-overlay"><div className="modal" role="dialog" aria-label="Unapply payment" style={{maxWidth:540}}>
      <div className="modal-header"><h2>Unapply payment</h2></div>
      <div className="modal-body">
        <p>Remove <strong>${Number(payment.amount).toFixed(2)}</strong> ({payment.ref}) from <strong>{invoice.id}</strong>?</p>
        <p>This reopens the invoice balance and keeps the payment on the customer's account. It does not refund or delete the payment.</p>
        <p style={{color:'#92400e'}}>QuickBooks is not changed. Payments that may already be in QuickBooks are held from reapplication and automatic payment sync until accounting reconciles them. If you already entered the payment on the correct invoice, do not apply this money again.</p>
        <label>Reason<textarea className="form-input" aria-label="Reason for unapplying" value={reason} maxLength={1000} onChange={e=>setReason(e.target.value)} disabled={saving}/></label>
      </div>
      <div className="modal-footer">
        <button className="btn btn-secondary" disabled={saving} onClick={()=>setOpen(false)}>Cancel</button>
        <button className="btn btn-primary" disabled={saving || reason.trim().length<3} onClick={save}>{saving?'Unapplying…':'Confirm unapply'}</button>
      </div>
    </div></div>}
  </>;
}
