import React, { useState } from 'react';
import { authFetch } from './utils';

const money = (amount, currency) => amount == null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'usd' }).format(amount / (['jpy','krw','clp','vnd','bif','djf','gnf','kmf','mga','pyg','rwf','vuv','xaf','xof','xpf'].includes(currency) ? 1 : 100));
export default function StripePaymentVerification() {
  const [connection, setConnection] = useState(null);
  const [from, setFrom] = useState(new Date(Date.now() - 30*86400000).toISOString().slice(0,10));
  const [to, setTo] = useState(new Date().toISOString().slice(0,10));
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(action, more = false) {
    setBusy(true); setError('');
    try {
      const response = await authFetch('/.netlify/functions/stripe-verification', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, from, to, ...(more ? {starting_after:result.next_cursor} : {})}) });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || 'Verification failed');
      if (action === 'connection') setConnection(data);
      else setResult(data);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="card" style={{marginBottom:16}}>
    <div className="card-header"><h2>Stripe Connection &amp; Payment Verification</h2></div>
    <div className="card-body">
      <p>Automatic invoice checks run nightly. Only issues generate an accounting alert; healthy runs stay quiet. Recent payments have a one-hour grace period.</p>
      <p>Check the portal’s server connection and compare Stripe captured payments with invoice payment records. A match verifies the portal record; QuickBooks posting and bank reconciliation remain separate checks.</p>
      <button className="btn btn-secondary" disabled={busy} onClick={()=>run('connection')}>Check Stripe connection</button>
      {connection && <div style={{marginTop:12}}>
        <strong>{connection.name}</strong> · {connection.account_id} · {connection.livemode ? 'LIVE' : 'TEST MODE'}
        <div>Charges {connection.charges_enabled ? 'enabled' : 'disabled'} · Payouts {connection.payouts_enabled ? 'enabled' : 'disabled'}</div>
        <div>Available: {connection.available.map(b=>money(b.amount,b.currency)).join(', ') || 'None'} · Pending: {connection.pending.map(b=>money(b.amount,b.currency)).join(', ') || 'None'}</div>
        <small>Checked {new Date(connection.checked_at).toLocaleString()}</small>
      </div>}
      <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end',marginTop:16}}>
        <label>From (UTC)<input aria-label="Payment start date" type="date" value={from} disabled={busy} onChange={e=>{setFrom(e.target.value);setResult(null);}} /></label>
        <label>Through (UTC)<input aria-label="Payment end date" type="date" value={to} disabled={busy} onChange={e=>{setTo(e.target.value);setResult(null);}} /></label>
        <button className="btn btn-primary" disabled={busy || !from || !to} onClick={()=>run('payments')}>{busy ? 'Checking…' : 'Verify payments'}</button>
      </div>
      {error && <p role="alert" style={{color:'#b91c1c'}}>{error}</p>}
      {result && <>
        <p>{result.payments.length} payments on this page · {result.payments.filter(p=>p.verified).length} portal records match · {result.has_more ? 'More payments remain' : 'End of results'}. Filter uses payment creation date.</p>
        <div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>Payment</th><th>Invoice</th><th>Captured</th><th>Portal recorded</th><th>Verification</th></tr></thead><tbody>
          {result.payments.map(p=><tr key={p.id}><td>{p.id}<br/><small>{new Date(p.created*1000).toLocaleString()} · {p.status}</small></td><td>{p.invoice_ids.join(', ') || 'No invoice reference'}</td><td>{money(p.captured_cents,p.currency)}</td><td>{money(p.recorded_cents,'usd')}</td><td>{p.verified ? 'Portal record matches' : p.reasons.join('; ')}</td></tr>)}
        </tbody></table></div>
        {result.has_more && <button className="btn btn-secondary" disabled={busy} onClick={()=>run('payments',true)}>Next 25 payments</button>}
        <small> Checked {new Date(result.checked_at).toLocaleString()}</small>
      </>}
    </div>
  </div>;
}
