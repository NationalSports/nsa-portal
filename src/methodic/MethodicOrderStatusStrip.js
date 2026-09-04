import React, { useEffect, useState } from 'react';
import { methodicApi } from './methodicApi';
import { nextAction, nextDue, requestStage } from './methodicWorkflow';

export default function MethodicOrderStatusStrip({ orderId, documentId, documentType = 'sales_order', onOpen }) {
  const [requests, setRequests] = useState([]);
  const sourceId = documentId || orderId;
  useEffect(() => {
    let active = true;
    const source = documentType === 'estimate' ? { estimate_id: sourceId } : { sales_order_id: sourceId };
    const load = () => methodicApi('list', source).then((data) => { if (active) setRequests(data.requests || []); }).catch(() => {});
    const refresh = (event) => { const changed = documentType === 'estimate' ? event.detail?.estimateId : event.detail?.salesOrderId; if (!changed || changed === sourceId) load(); };
    load(); window.addEventListener('methodic-updated', refresh);
    return () => { active = false; window.removeEventListener('methodic-updated', refresh); };
  }, [sourceId, documentType]);
  if (!requests.length) return null;
  const sorted = requests.slice().sort((a, b) => {
    if (!!a.blocker !== !!b.blocker) return a.blocker ? -1 : 1;
    return String(nextDue(a)?.date || '9999').localeCompare(String(nextDue(b)?.date || '9999'));
  });
  const lead = sorted[0]; const due = nextDue(lead);
  return <button type="button" onClick={onOpen} style={{ width: '100%', margin: '0 0 12px', border: lead.blocker ? '1px solid #fecaca' : '1px solid #c7d2fe', borderRadius: 9, background: lead.blocker ? '#fff7f7' : '#eef2ff', padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', cursor: 'pointer', color: '#1e1b4b' }}>
    <span style={{ fontWeight: 900 }}>METHODIC</span>
    <span style={{ padding: '2px 7px', borderRadius: 999, background: '#312e81', color: 'white', fontSize: 10, fontWeight: 900 }}>{requests.length}</span>
    <span style={{ fontSize: 12, fontWeight: 800 }}>{requestStage(lead)} · {nextAction(lead)}</span>
    {due && <span style={{ fontSize: 11, color: due.days < 0 ? '#b91c1c' : '#6366f1' }}>{due.label} {new Date(`${due.date}T12:00:00`).toLocaleDateString()}{due.days < 0 ? ` · ${Math.abs(due.days)}d late` : ''}</span>}
    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800 }}>{documentType === 'estimate' ? 'View Methodic queue' : 'View on order'} →</span>
  </button>;
}
