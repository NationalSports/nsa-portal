import React, { useCallback, useEffect, useMemo, useState } from 'react';
import MethodicRequestForm from './MethodicRequestForm';
import MethodicAccountingSetup from './MethodicAccountingSetup';
import { methodicApi } from './methodicApi';
import { METHODIC_COLORS, METHODIC_STATUS, billingBalanceCents, isRequestOverdue, nextAction, nextDue, requestStage, statusTone } from './methodicWorkflow';

const fmtDate = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString() : '—';
const age = (value) => value ? Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86400000)) : 0;
const cash = (cents) => cents == null ? '—' : `$${(Number(cents) / 100).toFixed(2)}`;

function Pill({ group, value }) {
  const tone = METHODIC_COLORS[statusTone(group, value)];
  return <span style={{ display: 'inline-flex', whiteSpace: 'nowrap', padding: '3px 7px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 10, fontWeight: 850 }}>{METHODIC_STATUS[group]?.[value] || value || '—'}</span>;
}

const TABS = ['All', 'Requests', 'Pricing', 'Art', 'Samples', 'Orders', 'Tracking', 'Billing', 'Blocked', 'Overdue', 'Mine'];

export default function MethodicDashboard({ orders = [], estimates = [], customers = [], teamMembers = [], currentUser, notify, onOpenDocument }) {
  const [requests, setRequests] = useState([]);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('All');
  const [search, setSearch] = useState('');
  const [repFilter, setRepFilter] = useState('all');
  const [editing, setEditing] = useState(null);
  const [newOrderId, setNewOrderId] = useState('');

  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const orderById = useMemo(() => new Map(orders.map((order) => [order.id, order])), [orders]);
  const estimateById = useMemo(() => new Map(estimates.map((estimate) => [estimate.id, estimate])), [estimates]);
  const memberById = useMemo(() => new Map(teamMembers.map((member) => [member.id, member])), [teamMembers]);
  const eventByRequest = useMemo(() => events.reduce((map, event) => { (map[event.request_id] ||= []).push(event); return map; }, {}), [events]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const data = await methodicApi('list'); setRequests(data.requests || []); setEvents(data.events || []); }
    catch (loadError) { setError(loadError.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const enriched = useMemo(() => requests.map((request) => {
    const order = request.sales_order_id ? orderById.get(request.sales_order_id) : estimateById.get(request.estimate_id);
    const customer = customerById.get(request.customer_id || order?.customer_id);
    const rep = memberById.get(request.rep_id || customer?.primary_rep_id || order?.created_by);
    const owner = memberById.get(request.owner_id);
    const due = nextDue(request);
    return { ...request, order, customer, rep, owner, due, stage: requestStage(request), overdue: isRequestOverdue(request) };
  }), [requests, orderById, estimateById, customerById, memberById]);

  const visible = useMemo(() => enriched.filter((request) => {
    if (repFilter !== 'all' && request.rep_id !== repFilter) return false;
    if (tab === 'Mine' && request.rep_id !== currentUser?.id && request.owner_id !== currentUser?.id) return false;
    if (tab === 'Blocked' && !request.blocker) return false;
    if (tab === 'Overdue' && !request.overdue) return false;
    if (tab === 'Billing' && ['not_ready', 'void'].includes(request.billing_status || 'not_ready')) return false;
    if (!['All', 'Mine', 'Blocked', 'Overdue'].includes(tab)) {
      if (tab === 'Billing') {
        // Billing is a parallel accounting lifecycle, not a production stage.
      } else {
        const match = { Requests: 'Request', Pricing: 'Pricing', Art: 'Art', Samples: 'Sample', Orders: 'Order', Tracking: 'Tracking' }[tab];
        if (request.stage !== match && !(tab === 'Orders' && request.stage === 'Purchasing')) return false;
      }
    }
    if (search) {
      const hay = [request.request_number, request.sales_order_id, request.estimate_id, request.title, request.style_number, request.garment_description, request.customer?.name, request.customer?.alpha_tag, request.rep?.name, request.methodic_order_number, request.purchase_order_number, request.tracking_number].join(' ').toLowerCase();
      if (!hay.includes(search.toLowerCase())) return false;
    }
    return true;
  }).sort((a, b) => {
    if (!!a.blocker !== !!b.blocker) return a.blocker ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return String(a.due?.date || '9999').localeCompare(String(b.due?.date || '9999')) || String(b.updated_at).localeCompare(String(a.updated_at));
  }), [enriched, repFilter, tab, search, currentUser]);

  const counts = {
    open: enriched.filter((row) => !['delivered', 'cancelled'].includes(row.order_status)).length,
    art: enriched.filter((row) => ['requested', 'in_art', 'ready_for_rep', 'revisions_requested'].includes(row.mockup_status)).length,
    samples: enriched.filter((row) => !['not_requested', 'approved', 'waived', 'cancelled'].includes(row.sample_status)).length,
    production: enriched.filter((row) => ['ordered', 'confirmed', 'in_production', 'quality_check', 'shipped'].includes(row.order_status)).length,
    billing: enriched.filter((row) => !['not_ready', 'paid', 'void'].includes(row.billing_status || 'not_ready')).length,
    overdue: enriched.filter((row) => row.overdue).length,
    blocked: enriched.filter((row) => row.blocker).length,
  };

  const save = async (payload) => {
    const isEdit = !!editing?.id;
    const editingIsEstimate = !!editing?.estimate_id;
    const [kind, selectedId] = String(newOrderId || '').split(':');
    const order = isEdit ? (editingIsEstimate ? estimateById.get(editing.estimate_id) : orderById.get(editing.sales_order_id)) : (kind === 'est' ? estimateById.get(selectedId) : orderById.get(selectedId));
    if (!order) throw new Error('Choose a sales order or estimate first.');
    const source = kind === 'est' ? { estimate_id: order.id } : { sales_order_id: order.id };
    const data = await methodicApi(isEdit ? 'update' : 'create', isEdit ? { id: editing.id, ...payload } : { ...source, ...payload });
    setEditing(null); setNewOrderId(''); await load();
    notify?.(`${data.request?.request_number || 'Methodic request'} saved${!isEdit && payload.mockup_status === 'requested' ? ' and sent to Art Dashboard' : ''}`);
  };
  const [newKind, newId] = String(newOrderId || '').split(':');
  const editingOrder = editing?.id ? (editing.estimate_id ? estimateById.get(editing.estimate_id) : orderById.get(editing.sales_order_id)) : (newKind === 'est' ? estimateById.get(newId) : orderById.get(newId));
  const editingDocumentType = editing?.id ? (editing.estimate_id ? 'estimate' : 'sales_order') : (newKind === 'est' ? 'estimate' : 'sales_order');

  return <div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
      <div><h2 style={{ margin: 0, color: '#0f172a' }}>Methodic Operations</h2><div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>One queue for pricing, art mockups, samples, purchasing, production, delivery, and intercompany billing.</div></div>
      <button className="btn btn-primary" onClick={() => { setEditing({}); setNewOrderId(''); }}>+ New Methodic request</button>
    </div>

    <MethodicAccountingSetup currentUser={currentUser} notify={notify} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(135px,1fr))', gap: 10, marginBottom: 14 }}>
      {Object.entries(counts).map(([key, value]) => <div key={key} style={{ background: key === 'blocked' && value ? '#fef2f2' : key === 'overdue' && value ? '#fff7ed' : 'white', border: '1px solid #dbe3ef', borderRadius: 10, padding: 12 }}><div style={{ fontSize: 24, fontWeight: 900, color: key === 'blocked' && value ? '#b91c1c' : '#0f172a' }}>{value}</div><div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase' }}>{key}</div></div>)}
    </div>

    <div className="card" style={{ marginBottom: 14 }}><div className="card-body" style={{ padding: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="form-input" style={{ maxWidth: 310 }} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search request, SO, customer, style, tracking…" />
      <select className="form-input" style={{ maxWidth: 210 }} value={repFilter} onChange={(event) => setRepFilter(event.target.value)}><option value="all">All reps</option>{teamMembers.filter((member) => member.role === 'rep' || member.role === 'admin' || member.role === 'super_admin').map((member) => <option key={member.id} value={member.id}>{member.name || member.id}</option>)}</select>
      <button className="btn btn-sm btn-secondary" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh'}</button>
    </div><div style={{ padding: '0 10px 10px', display: 'flex', gap: 5, overflowX: 'auto' }}>{TABS.map((name) => <button key={name} onClick={() => setTab(name)} style={{ border: 0, cursor: 'pointer', whiteSpace: 'nowrap', borderRadius: 7, padding: '6px 10px', fontSize: 11, fontWeight: 800, background: tab === name ? '#312e81' : '#f1f5f9', color: tab === name ? 'white' : '#475569' }}>{name}</button>)}</div></div>

    {error && <div style={{ marginBottom: 12, padding: 12, borderRadius: 8, background: '#fef2f2', color: '#b91c1c' }}>{error}</div>}
    {!loading && !visible.length && !error && <div className="card"><div className="card-body" style={{ padding: 36, textAlign: 'center', color: '#64748b' }}>No Methodic requests match this view.</div></div>}
    {!!visible.length && <div className="card" style={{ overflow: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1260 }}><thead><tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left', fontSize: 10, textTransform: 'uppercase' }}>{['Request / customer', 'Rep / owner', 'Stage', 'Pricing', 'Art mock', 'Sample', 'Order / tracking', 'Billing', 'Next action', 'Updated', ''].map((heading) => <th key={heading} style={{ padding: '9px 10px', borderBottom: '1px solid #e2e8f0' }}>{heading}</th>)}</tr></thead><tbody>{visible.map((row) => {
      const latest = (eventByRequest[row.id] || [])[0];
      return <tr key={row.id} style={{ borderBottom: '1px solid #eef2f7', background: row.blocker ? '#fffafa' : row.overdue ? '#fffdf7' : 'white' }}>
        <td style={{ padding: 10 }}><div style={{ fontFamily: 'monospace', color: '#4338ca', fontWeight: 900 }}>{row.request_number}</div><button onClick={() => onOpenDocument?.(row.estimate_id ? 'estimate' : 'sales_order', row.estimate_id || row.sales_order_id)} style={{ border: 0, background: 'none', color: '#2563eb', padding: 0, cursor: 'pointer', fontWeight: 800 }}>{row.estimate_id || row.sales_order_id}</button><div style={{ fontSize: 12, fontWeight: 800, color: '#1e293b', marginTop: 3 }}>{row.customer?.name || 'Unknown customer'}</div><div style={{ fontSize: 11, color: '#64748b' }}>{row.title}{row.style_number ? ` · ${row.style_number}` : ''}</div></td>
        <td style={{ padding: 10, fontSize: 11 }}><strong>{row.rep?.name || '—'}</strong><div style={{ color: '#64748b', marginTop: 3 }}>{row.owner?.name ? `Owner: ${row.owner.name}` : 'Unassigned'}</div></td>
        <td style={{ padding: 10 }}><span style={{ fontSize: 10, fontWeight: 900, color: '#0369a1', background: '#e0f2fe', padding: '3px 7px', borderRadius: 999 }}>{row.stage}</span>{row.priority !== 'normal' && <div style={{ marginTop: 5, fontSize: 9, fontWeight: 900, color: row.priority === 'rush' ? '#b91c1c' : '#a16207', textTransform: 'uppercase' }}>{row.priority}</div>}</td>
        <td style={{ padding: 10 }}><Pill group="pricing" value={row.pricing_status} /><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{row.quoted_unit_cost_cents != null ? `${cash(row.quoted_unit_cost_cents)} / unit` : fmtDate(row.expected_pricing_date)}</div></td>
        <td style={{ padding: 10 }}><Pill group="mockup" value={row.mockup_status} /><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{row.art_job_id || 'No linked job'} · {fmtDate(row.expected_mockup_date)}</div></td>
        <td style={{ padding: 10 }}><Pill group="sample" value={row.sample_status} /><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{fmtDate(row.expected_sample_date)}</div></td>
        <td style={{ padding: 10 }}><Pill group="order" value={row.order_status} /><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{row.methodic_order_number || row.purchase_order_number || row.tracking_number || '—'}</div>{row.tracking_url && <a href={row.tracking_url} target="_blank" rel="noreferrer" style={{ fontSize: 10 }}>Track shipment</a>}</td>
        <td style={{ padding: 10 }}><Pill group="billing" value={row.billing_status || 'not_ready'} /><div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{row.billing_amount_cents != null ? `${cash(row.billing_amount_cents)} · ${cash(billingBalanceCents(row))} due` : 'Not prepared'}</div></td>
        <td style={{ padding: 10, maxWidth: 210 }}><div style={{ fontSize: 11, fontWeight: 800, color: row.blocker ? '#b91c1c' : '#334155' }}>{nextAction(row)}</div><div style={{ fontSize: 10, color: row.overdue ? '#b91c1c' : '#64748b', marginTop: 3 }}>{row.due ? `${row.due.label} ${fmtDate(row.due.date)}${row.overdue ? ` · ${Math.abs(row.due.days)}d late` : ''}` : 'No due date'}</div>{latest && <div title={latest.message} style={{ fontSize: 9, color: '#94a3b8', marginTop: 4, maxWidth: 190, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{latest.message}</div>}</td>
        <td style={{ padding: 10, fontSize: 10, color: '#64748b' }}>{age(row.updated_at)}d ago</td>
        <td style={{ padding: 10 }}><button className="btn btn-sm btn-secondary" onClick={() => setEditing(row)}>Open</button></td>
      </tr>;
    })}</tbody></table></div>}

    {editing && <div className="modal-overlay" onClick={() => { setEditing(null); setNewOrderId(''); }}><div className="modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 940, width: '95vw', maxHeight: '94vh', overflow: 'auto' }}><div className="modal-header"><h2>{editing.id ? `${editing.request_number} · ${editing.estimate_id || editing.sales_order_id}` : 'New Methodic request'}</h2><button className="modal-close" onClick={() => { setEditing(null); setNewOrderId(''); }}>×</button></div><div className="modal-body">
      {!editing.id && <label className="form-group" style={{ display: 'block', marginBottom: 16 }}><span className="form-label">Sales order or estimate</span><select className="form-input" value={newOrderId} onChange={(event) => setNewOrderId(event.target.value)}><option value="">Choose a document…</option><optgroup label="Sales orders">{orders.filter((order) => !order.deleted_at).slice().sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true })).map((order) => <option key={order.id} value={`so:${order.id}`}>{order.id} — {customerById.get(order.customer_id)?.name || order.memo || 'Unknown customer'}</option>)}</optgroup><optgroup label="Estimates">{estimates.filter((estimate) => !estimate.deleted_at && estimate.status !== 'converted').slice().sort((a, b) => String(b.id).localeCompare(String(a.id), undefined, { numeric: true })).map((estimate) => <option key={estimate.id} value={`est:${estimate.id}`}>{estimate.id} — {customerById.get(estimate.customer_id)?.name || estimate.memo || 'Unknown customer'}</option>)}</optgroup></select></label>}
      {editingOrder ? <MethodicRequestForm request={editing.id ? editing : null} order={editingOrder} itemIndex={editing.item_index} initialItem={editing.item_index != null ? editingOrder.items?.[editing.item_index] : null} documentType={editingDocumentType} teamMembers={teamMembers} onSave={save} onCancel={() => { setEditing(null); setNewOrderId(''); }} /> : <div style={{ padding: 28, textAlign: 'center', color: '#64748b' }}>Choose a sales order or estimate to create the request.</div>}
    </div></div></div>}
  </div>;
}
