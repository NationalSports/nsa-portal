import React, { useState } from 'react';
import { authFetch } from './utils';

export async function sendRepShipmentUpdate(soId, shipmentIds, preview = false) {
  const response = await authFetch('/.netlify/functions/so-shipment-rep-notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ soId, shipmentIds, preview }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not send rep update');
  return data;
}

export default function RepShipmentButton({ soId, nf }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const send = async () => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const preview = await sendRepShipmentUpdate(soId, undefined, true);
      if (!window.confirm(`Email ${preview.shipments} saved shipment record(s) for ${soId} to ${preview.to}? This sends only to the assigned rep.`)) return;
      const result = await sendRepShipmentUpdate(soId, preview.shipmentIds);
      const text = `Rep shipment update ${result.status === 'sent' ? 'sent' : 'queued for delivery'} to ${result.to}`;
      setMessage(text); nf(text);
    } catch (err) { setMessage(err.message); nf(err.message, 'error'); }
    finally { setBusy(false); }
  };
  return <span><button className="btn btn-sm btn-secondary" disabled={busy} onClick={send}>
    {busy ? 'Sending…' : 'Email Rep Update'}
  </button>{message && <span role="status" style={{display:'block',fontSize:12,marginTop:4}}>{message}</span>}</span>;
}
