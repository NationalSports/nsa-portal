import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { methodicApi } from './methodicApi';
import MethodicRequestForm from './MethodicRequestForm';
import MethodicAccountingPanel from './MethodicAccountingPanel';
import { METHODIC_COLORS, METHODIC_STATUS, nextAction, nextDue, requestStage, statusTone } from './methodicWorkflow';

const fmtDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : '—';
const money = (cents) => cents == null ? '—' : `$${(Number(cents) / 100).toFixed(2)}`;

function Badge({ group, value }) {
  const tone = METHODIC_COLORS[statusTone(group, value)];
  return <span style={{ display: 'inline-flex', padding: '3px 7px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 800 }}>{METHODIC_STATUS[group]?.[value] || value || '—'}</span>;
}

export default function MethodicOrderPanel({ order, customer, teamMembers = [], currentUser, notify, onOpenDashboard }) {
  const [rows, setRows] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    if (!order?.id) return;
    setLoading(true); setError('');
    try {
      const data = await methodicApi('list', { sales_order_id: order.id });
      setRows(data.requests || []); setEvents(data.events || []);
    } catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, [order?.id]);
  useEffect(() => { load(); }, [load]);
  const eventByRequest = useMemo(() => events.reduce((map, event) => {
    (map[event.request_id] ||= []).push(event); return map;
  }, {}), [events]);

  const save = async (payload) => {
    const action = editing?.id ? 'update' : 'create';
    const data = await methodicApi(action, editing?.id ? { id: editing.id, ...payload } : { sales_order_id: order.id, ...payload });
    setEditing(null); await load();
    window.dispatchEvent(new CustomEvent('methodic-updated', { detail: { salesOrderId: order.id } }));
    notify?.(`${data.request?.request_number || 'Methodic request'} saved${action === 'create' && payload.mockup_status === 'requested' ? ' and sent to Art Dashboard' : ''}`);
  };

  if (loading) return <div style={{ padding: 24, color: '#64748b' }}>Loading Methodic requests…</div>;
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>Methodic</div><div style={{ fontSize: 12, color: '#64748b' }}>Pricing, mockups, samples, production, and tracking for {order.id}{customer?.name ? ` · ${customer.name}` : ''}</div></div>
      <div style={{ display: 'flex', gap: 8 }}>
        {onOpenDashboard && <button className="btn btn-secondary" onClick={onOpenDashboard}>Open Methodic dashboard</button>}
        <button className="btn btn-primary" onClick={() => setEditing({})}>+ New request</button>
      </div>
    </div>
    {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8 }}>{error} <button onClick={load}>Retry</button></div>}
    {!rows.length && !error && <div style={{ padding: 28, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 10, background: '#f8fafc' }}><div style={{ fontWeight: 800, color: '#334155' }}>No Methodic work on this order</div><div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>Create one request for pricing, a mockup, or both. Mock requests go straight to the selected art job.</div></div>}
    {rows.map((row) => {
      const due = nextDue(row); const recent = (eventByRequest[row.id] || [])[0];
      return <div key={row.id} style={{ border: row.blocker ? '2px solid #fecaca' : '1px solid #dbe3ef', borderRadius: 12, overflow: 'hidden', background: 'white' }}>
        <div style={{ padding: '11px 14px', background: row.blocker ? '#fff7f7' : '#f8fafc', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 900, color: '#4338ca' }}>{row.request_number}</span>
          <span style={{ fontWeight: 800, color: '#0f172a' }}>{row.title}</span>
          <span style={{ fontSize: 10, fontWeight: 900, color: '#0369a1', background: '#e0f2fe', padding: '3px 7px', borderRadius: 999 }}>{requestStage(row)}</span>
          {row.priority !== 'normal' && <span style={{ fontSize: 10, fontWeight: 900, color: row.priority === 'rush' ? '#b91c1c' : '#a16207', textTransform: 'uppercase' }}>{row.priority}</span>}
          <button className="btn btn-sm btn-secondary" style={{ marginLeft: 'auto' }} onClick={() => setEditing(row)}>Update</button>
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
            <div><div className="oe-label">Pricing</div><Badge group="pricing" value={row.pricing_status} /><div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>{row.pricing_status === 'quoted' ? `${money(row.quoted_unit_cost_cents)} / unit` : `Expected ${fmtDate(row.expected_pricing_date)}`}</div></div>
            <div><div className="oe-label">Mock / Art</div><Badge group="mockup" value={row.mockup_status} /><div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>{row.art_job_id || 'No art job'} · {fmtDate(row.expected_mockup_date)}</div></div>
            <div><div className="oe-label">Sample</div><Badge group="sample" value={row.sample_status} /><div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>{fmtDate(row.expected_sample_date)}</div></div>
            <div><div className="oe-label">Order</div><Badge group="order" value={row.order_status} /><div style={{ fontSize: 11, marginTop: 4, color: '#64748b' }}>{row.methodic_order_number || row.purchase_order_number || 'No order number'}</div></div>
            <div><div className="oe-label">Next action</div><div style={{ fontSize: 12, fontWeight: 800, color: row.blocker ? '#b91c1c' : '#334155' }}>{nextAction(row)}</div><div style={{ fontSize: 11, color: due?.days < 0 ? '#b91c1c' : '#64748b' }}>{due ? `${due.label}: ${fmtDate(due.date)}${due.days < 0 ? ` · ${Math.abs(due.days)}d late` : ''}` : 'No due date'}</div></div>
          </div>
          {(row.tracking_number || row.sample_tracking_number) && <div style={{ marginTop: 10, padding: 8, background: '#ecfdf5', borderRadius: 7, fontSize: 12 }}><strong>Tracking:</strong> {row.tracking_url ? <a href={row.tracking_url} target="_blank" rel="noreferrer">{row.tracking_number}</a> : row.tracking_number || row.sample_tracking_number} · expected {fmtDate(row.expected_arrival_date || row.expected_sample_date)}</div>}
          <MethodicAccountingPanel request={row} currentUser={currentUser} notify={notify} onUpdated={load} />
          {recent && <div style={{ marginTop: 9, color: '#64748b', fontSize: 11 }}>Latest: {recent.message} · {new Date(recent.created_at).toLocaleString()}</div>}
        </div>
      </div>;
    })}
    {editing && <div className="modal-overlay" onClick={() => setEditing(null)}><div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 920, width: '95vw', maxHeight: '92vh', overflow: 'auto' }}><div className="modal-header"><h2>{editing.id ? `Update ${editing.request_number}` : `New Methodic request — ${order.id}`}</h2><button className="modal-close" onClick={() => setEditing(null)}>×</button></div><div className="modal-body"><MethodicRequestForm request={editing.id ? editing : null} order={order} teamMembers={teamMembers} onSave={save} onCancel={() => setEditing(null)} /></div></div></div>}
  </div>;
}
