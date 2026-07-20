/* eslint-disable */
// Settings → Uniform Orders — staff control center for the complete custom-
// uniform lifecycle. Customer-facing actions are handled by the matching
// uniform-order server function and private status link.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { renderProductionPDF, renderProductionSheet } from './renderCanvas';

const PRODUCTION = ['submitted', 'rep_review', 'proof_ready', 'changes_requested', 'approved', 'production', 'quality_check', 'shipped', 'delivered', 'cancelled'];
const PAYMENTS = ['unpaid', 'pending', 'paid', 'po_terms', 'refunded', 'void'];
const LABEL = {
  submitted: 'Submitted', rep_review: 'Rep review', proof_ready: 'Proof ready', changes_requested: 'Changes requested',
  approved: 'Approved', production: 'In production', quality_check: 'Quality check', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled',
  unpaid: 'Unpaid', pending: 'Pending', paid: 'Paid', po_terms: 'PO terms', refunded: 'Refunded', void: 'Void',
};
const TONE = {
  submitted: ['#92400e', '#fef3c7'], rep_review: ['#1d4ed8', '#dbeafe'], proof_ready: ['#6d28d9', '#ede9fe'],
  changes_requested: ['#b91c1c', '#fee2e2'], approved: ['#15803d', '#dcfce7'], production: ['#1d4ed8', '#dbeafe'],
  quality_check: ['#0369a1', '#e0f2fe'], shipped: ['#0f766e', '#ccfbf1'], delivered: ['#15803d', '#dcfce7'], cancelled: ['#64748b', '#f1f5f9'],
};
const FULFILL_LABEL = { card: 'Card', po: 'School PO', manual: 'Rep queue' };
// Jobs-style board columns. Cancelled stays off the board (visible via the
// queue filters) so the lanes read as live work only.
const BOARD_LANES = [
  ['Intake', ['submitted', 'rep_review']],
  ['Proofing', ['proof_ready', 'changes_requested']],
  ['Approved', ['approved']],
  ['Production', ['production', 'quality_check']],
  ['Shipped', ['shipped', 'delivered']],
];
const fieldStyle = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 9px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff' };

function fileBase(o) { return (o.team_name || 'order').toLowerCase().replace(/\s+/g, '-'); }
function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' }); }
function rosterSummary(roster) { return (roster || []).map((r) => `${r.label || r.size} ×${r.qty} (${r.numsDisplay || ('#' + r.nums)})`).join('; ') || '—'; }
function pill(status) { const [color, background] = TONE[status] || ['#475569', '#f1f5f9']; return { fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 12, color, background, textTransform: 'uppercase', letterSpacing: .25 }; }

export default function UniformOrdersAdmin() {
  const [rows, setRows] = useState(null);
  const [reps, setReps] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [details, setDetails] = useState({});
  const [drafts, setDrafts] = useState({});
  const [expandedId, setExpandedId] = useState('');
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('open');
  const [busyId, setBusyId] = useState('');
  const [view, setView] = useState('board'); // board | queue

  const load = async () => {
    try {
      const [{ data, error }, { data: repRows }, { data: customerRows }] = await Promise.all([
        supabase.from('uniform_order_requests')
          .select('id,order_number,parent_order_id,customer_id,sales_order_id,converted_at,team_name,sport,contact_name,contact_email,config,spec,bottom_spec,roster,total_qty,unit_price,total,public_unit_price,discount_percent,discount_total,pricing_breakdown,fulfillment,status,payment_status,production_status,assigned_rep_id,rep_review_notes,proof_version,approved_proof_version,approved_at,locked_at,locked_by,production_started_at,quality_checked_at,carrier,tracking_number,tracking_url,shipped_at,delivered_at,po_number,po_contact,thumb,back_thumb,last_customer_note,created_at,updated_at')
          .order('created_at', { ascending: false }).limit(300),
        supabase.from('team_members').select('id,name,is_active').eq('is_active', true).order('name'),
        supabase.from('customers').select('id,name,alpha_tag,primary_rep_id,is_active').eq('is_active', true).order('name'),
      ]);
      if (error) throw error;
      setRows(data || []); setReps(repRows || []); setCustomers(customerRows || []); setErr('');
    } catch (e) { setRows([]); setErr('Could not load uniform orders — ' + (e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => !['delivered', 'cancelled'].includes(r.production_status));
    return rows.filter((r) => r.production_status === filter);
  }, [rows, filter]);

  // Commission attribution mirrors the sales-order rule (businessLogic's
  // commissionRepId): the account owner earns it. An order becomes
  // commissionable once it's linked to a customer whose account has a rep;
  // unlinked orders (or accounts without a rep) are house orders.
  const customerOf = (row) => customers.find((c) => c.id === row.customer_id) || null;
  const commissionRepOf = (row) => {
    const customer = customerOf(row);
    if (!customer || !customer.primary_rep_id) return null;
    return reps.find((r) => r.id === customer.primary_rep_id) || { id: customer.primary_rep_id, name: customer.primary_rep_id };
  };

  const staffApi = async (row, action, values = {}) => {
    setBusyId(row.id); setErr('');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data && data.session && data.session.access_token;
      if (!token) throw new Error('Your staff session expired. Sign in again.');
      const res = await fetch('/.netlify/functions/uniform-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action, order_id: row.id, ...values }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || 'The update was not confirmed.');
      await load();
      if (expandedId === row.id) await loadDetails(row.id, true);
      return json;
    } catch (e) { setErr(e.message || 'The update was not confirmed.'); return null; }
    finally { setBusyId(''); }
  };

  const loadDetails = async (id, force = false) => {
    if (!force && details[id]) return;
    try {
      const [{ data: proofs, error: pErr }, { data: events, error: eErr }] = await Promise.all([
        supabase.from('uniform_order_proofs').select('*').eq('order_id', id).order('version', { ascending: false }),
        supabase.from('uniform_order_events').select('*').eq('order_id', id).order('created_at', { ascending: false }).limit(100),
      ]);
      if (pErr) throw pErr; if (eErr) throw eErr;
      setDetails((d) => ({ ...d, [id]: { proofs: proofs || [], events: events || [] } }));
    } catch (e) { setErr('Could not load order history — ' + (e.message || e)); }
  };

  const toggle = (row) => {
    const open = expandedId === row.id ? '' : row.id;
    setExpandedId(open);
    if (open) {
      setDrafts((d) => ({ ...d, [row.id]: { rep_review_notes: row.rep_review_notes || '', assigned_rep_id: row.assigned_rep_id || '', customer_id: row.customer_id || '', proof_note: '', carrier: row.carrier || '', tracking_number: row.tracking_number || '', tracking_url: row.tracking_url || '', ...(d[row.id] || {}) } }));
      loadDetails(row.id);
    }
  };
  const draft = (row, key, value) => setDrafts((d) => ({ ...d, [row.id]: { ...(d[row.id] || {}), [key]: value } }));

  const downloadRosterCSV = (row) => {
    const lines = [['Player Name', 'Number', 'Size']];
    (row.roster || []).forEach((r) => {
      if (Array.isArray(r.players) && r.players.length) r.players.forEach((pl) => lines.push([pl.name || '', pl.num, r.size || r.label || '']));
      else String(r.nums || '').split(',').map((s) => s.trim()).filter(Boolean).forEach((n) => lines.push(['', n, r.size || r.label || '']));
    });
    const csv = lines.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `${fileBase(row)}-roster.csv`; document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const downloadPDF = async (row) => {
    setBusyId(row.id);
    try {
      const doc = await renderProductionPDF(row.spec, { frontImage: row.thumb, backImage: row.back_thumb, roster: row.roster, bottomSpec: row.bottom_spec || undefined, order: { totalQty: row.total_qty, unitPrice: row.unit_price, total: row.total, publicUnitPrice: row.public_unit_price, discountPercent: row.discount_percent, discountTotal: row.discount_total } });
      doc.save(`${fileBase(row)}-production.pdf`);
    } catch (e) { setErr('PDF export failed — ' + (e.message || e)); }
    setBusyId('');
  };
  const downloadPNG = async (row) => {
    setBusyId(row.id);
    try {
      const url = await renderProductionSheet(row.spec, { width: 1400, frontImage: row.thumb, backImage: row.back_thumb, bottomSpec: row.bottom_spec || undefined });
      const a = document.createElement('a'); a.href = url; a.download = `${fileBase(row)}-production.png`; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { setErr('PNG export failed — ' + (e.message || e)); }
    setBusyId('');
  };

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: '0 0 4px', color: '#1e293b' }}>Uniform Orders</h3>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>Review every order, publish versioned proofs, record approval, lock production, and send tracking from one queue.</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={`btn btn-xs ${view === 'board' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('board')}>Board</button>
            <button className={`btn btn-xs ${view === 'queue' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('queue')}>Queue</button>
          </div>
        </div>
        {err && <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>{err}</div>}

        {view === 'board' && (rows === null ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div> : (
          <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
            {BOARD_LANES.map(([lane, statuses]) => {
              const laneRows = (rows || []).filter((r) => statuses.includes(r.production_status));
              return (
                <div key={lane} style={{ minWidth: 250, width: 250, flexShrink: 0, background: '#f1f5f9', borderRadius: 9, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9, padding: '0 3px' }}>
                    <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: .4, color: '#334155' }}>{lane}</strong>
                    <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', background: '#e2e8f0', borderRadius: 10, padding: '2px 8px' }}>{laneRows.length}</span>
                  </div>
                  {laneRows.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', padding: '10px 3px' }}>Nothing here.</div>}
                  {laneRows.map((row) => {
                    const customer = customerOf(row);
                    const commRep = commissionRepOf(row);
                    const assigned = reps.find((r) => r.id === row.assigned_rep_id);
                    const ageDays = Math.floor((Date.now() - new Date(row.updated_at || row.created_at).getTime()) / 86400000);
                    return (
                      <button key={row.id} onClick={() => { setView('queue'); setFilter('all'); toggle(row); }} style={{ width: '100%', textAlign: 'left', border: '1px solid #dbe1ea', borderRadius: 8, background: '#fff', padding: 10, marginBottom: 8, cursor: 'pointer', display: 'block' }}>
                        <div style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                          <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 5, border: '1px solid #e2e8f0', overflow: 'hidden', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row.thumb ? <img src={row.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 16 }}>🎽</span>}</div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.order_number || 'Pending'} · {row.team_name}</div>
                            <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>{row.total_qty} pcs · {money(row.total)} · {FULFILL_LABEL[row.fulfillment] || row.fulfillment}</div>
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 7 }}>
                          <span style={pill(row.production_status)}>{LABEL[row.production_status] || row.production_status}</span>
                          <span style={{ ...pill(row.payment_status), color: row.payment_status === 'paid' ? '#15803d' : '#92400e', background: row.payment_status === 'paid' ? '#dcfce7' : '#fef3c7' }}>{LABEL[row.payment_status] || row.payment_status}</span>
                          {row.locked_at && <span style={{ ...pill('approved'), color: '#334155', background: '#e2e8f0' }}>🔒</span>}
                        </div>
                        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
                          {customer ? <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>🏷 {customer.name}</div> : <div style={{ color: '#94a3b8' }}>No customer account linked</div>}
                          {commRep ? <div title="Commissionable — account owner earns it once invoiced and paid">💰 Commission: {commRep.name}</div> : <div style={{ color: '#94a3b8' }}>House order (no account rep)</div>}
                          {assigned && <div>👤 Working rep: {assigned.name}</div>}
                          {row.sales_order_id && <div>📄 {row.sales_order_id}</div>}
                          <div style={{ color: '#94a3b8' }}>Proof v{row.proof_version || 0} · {ageDays === 0 ? 'today' : `${ageDays}d in stage`}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        ))}

        {view === 'queue' && <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {['open', 'all', ...PRODUCTION].map((value) => <button key={value} className={`btn btn-xs ${filter === value ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(value)}>{value === 'open' ? 'Open' : value === 'all' ? 'All' : LABEL[value]}</button>)}
        </div>}

        {view === 'queue' && (rows === null ? <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div> : filtered.length === 0 ? <div style={{ color: '#64748b', fontSize: 13 }}>No orders in this view.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((row) => {
              const open = expandedId === row.id;
              const d = drafts[row.id] || {};
              const detail = details[row.id] || { proofs: [], events: [] };
              const working = busyId === row.id;
              const commRep = commissionRepOf(row);
              return (
                <div key={row.id} style={{ border: '1px solid #dbe1ea', borderRadius: 9, background: '#fff', overflow: 'hidden' }}>
                  <button onClick={() => toggle(row)} style={{ width: '100%', border: 0, background: '#fff', padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start', textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ width: 68, height: 68, flexShrink: 0, borderRadius: 6, border: '1px solid #e2e8f0', overflow: 'hidden', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{row.thumb ? <img src={row.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 22 }}>🎽</span>}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 5 }}>
                        <strong style={{ fontSize: 15, color: '#1e293b' }}>{row.order_number || 'Pending number'} · {row.team_name}</strong>
                        <span style={pill(row.production_status)}>{LABEL[row.production_status] || row.production_status}</span>
                        <span style={{ ...pill(row.payment_status), color: row.payment_status === 'paid' ? '#15803d' : '#92400e', background: row.payment_status === 'paid' ? '#dcfce7' : '#fef3c7' }}>{LABEL[row.payment_status] || row.payment_status}</span>
                        {row.locked_at && <span style={{ ...pill('approved'), color: '#334155', background: '#e2e8f0' }}>🔒 Locked</span>}
                        {row.parent_order_id && <span style={{ ...pill('submitted'), color: '#475569', background: '#f1f5f9' }}>Reorder</span>}
                        {commRep && <span title="Commissionable — the account owner earns it once invoiced and paid" style={{ ...pill('approved'), color: '#166534', background: '#dcfce7' }}>💰 {commRep.name}</span>}
                        {row.sales_order_id && <span style={{ ...pill('submitted'), color: '#1d4ed8', background: '#dbeafe' }}>{row.sales_order_id}</span>}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{row.contact_name} · {row.contact_email} · {FULFILL_LABEL[row.fulfillment] || row.fulfillment}</div>
                      <div style={{ fontSize: 12, color: '#334155' }}>{row.total_qty} jerseys · {money(row.total)}{row.po_number ? ` · PO ${row.po_number}` : ''} · Proof v{row.proof_version || 0}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{new Date(row.created_at).toLocaleString()}</div>
                    </div>
                    <span style={{ fontSize: 18, color: '#64748b' }}>{open ? '▴' : '▾'}</span>
                  </button>

                  {open && <div style={{ borderTop: '1px solid #e2e8f0', background: '#f8fafc', padding: 16 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
                      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 10 }}>1 · Rep Review</strong>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5 }}>Assigned rep</label>
                        <select value={d.assigned_rep_id || ''} onChange={(e) => draft(row, 'assigned_rep_id', e.target.value)} style={fieldStyle}><option value="">Unassigned</option>{reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.name}</option>)}</select>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', margin: '10px 0 5px' }}>Internal review notes</label>
                        <textarea value={d.rep_review_notes || ''} onChange={(e) => draft(row, 'rep_review_notes', e.target.value)} style={{ ...fieldStyle, minHeight: 72, resize: 'vertical' }} />
                        <button className="btn btn-xs btn-primary" disabled={working} style={{ marginTop: 9 }} onClick={() => staffApi(row, 'staff_update', { assigned_rep_id: d.assigned_rep_id || null, rep_review_notes: d.rep_review_notes || '', production_status: row.production_status === 'submitted' ? 'rep_review' : row.production_status })}>Save Review</button>
                      </section>

                      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 10 }}>2 · Proof & Approval</strong>
                        <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>Latest version: <strong>{row.proof_version || 'Not published'}</strong>{row.approved_proof_version ? ` · v${row.approved_proof_version} approved` : ''}</div>
                        {row.last_customer_note && <div style={{ fontSize: 12, color: '#991b1b', background: '#fef2f2', padding: 8, borderRadius: 5, marginBottom: 8 }}><strong>Coach note:</strong> {row.last_customer_note}</div>}
                        <textarea placeholder="Message shown with this proof" value={d.proof_note || ''} onChange={(e) => draft(row, 'proof_note', e.target.value)} style={{ ...fieldStyle, minHeight: 60, resize: 'vertical' }} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 9, flexWrap: 'wrap' }}>
                          <button className="btn btn-xs btn-primary" disabled={working || !!row.locked_at} onClick={() => staffApi(row, 'staff_publish_proof', { note: d.proof_note || '', front_image: row.thumb, back_image: row.back_thumb })}>{row.proof_version ? 'Publish Revised Proof' : 'Publish Proof'}</button>
                          <button className="btn btn-xs btn-secondary" disabled={working || !!row.locked_at || row.approved_proof_version !== row.proof_version} onClick={() => staffApi(row, 'staff_lock')}>🔒 Lock Approved Proof</button>
                        </div>
                      </section>

                      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 10 }}>3 · Payment & Production</strong>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5 }}>Payment</label>
                        <select value={row.payment_status || 'unpaid'} disabled={working} onChange={(e) => staffApi(row, 'staff_update', { payment_status: e.target.value })} style={fieldStyle}>{PAYMENTS.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
                        <label style={{ display: 'block', fontSize: 11, color: '#64748b', margin: '10px 0 5px' }}>Production</label>
                        <select value={row.production_status} disabled={working} onChange={(e) => staffApi(row, 'staff_update', { production_status: e.target.value })} style={fieldStyle}>{PRODUCTION.map((s) => <option key={s} value={s} disabled={(s === 'production' && !row.locked_at) || s === 'proof_ready' || s === 'approved' || s === 'changes_requested'}>{LABEL[s]}</option>)}</select>
                        {!row.locked_at && <div style={{ fontSize: 11, color: '#92400e', marginTop: 7 }}>Production stays unavailable until the latest proof is approved and locked.</div>}
                      </section>

                      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 10 }}>4 · Shipping</strong>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 7 }}>
                          <input placeholder="Carrier" value={d.carrier || ''} onChange={(e) => draft(row, 'carrier', e.target.value)} style={fieldStyle} />
                          <input placeholder="Tracking number" value={d.tracking_number || ''} onChange={(e) => draft(row, 'tracking_number', e.target.value)} style={fieldStyle} />
                        </div>
                        <input placeholder="Tracking link (optional)" value={d.tracking_url || ''} onChange={(e) => draft(row, 'tracking_url', e.target.value)} style={{ ...fieldStyle, marginTop: 7 }} />
                        <button className="btn btn-xs btn-primary" disabled={working || !String(d.tracking_number || '').trim()} style={{ marginTop: 9 }} onClick={() => staffApi(row, 'staff_update', { carrier: d.carrier, tracking_number: d.tracking_number, tracking_url: d.tracking_url, production_status: 'shipped' })}>Save & Mark Shipped</button>
                      </section>

                      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 10 }}>5 · Sales Order Handoff</strong>
                        {row.sales_order_id ? (
                          <div style={{ padding: '10px 11px', borderRadius: 6, background: '#ecfdf5', color: '#166534', fontSize: 12 }}>
                            Created as <strong>{row.sales_order_id}</strong>{row.converted_at ? ` · ${new Date(row.converted_at).toLocaleString()}` : ''}
                          </div>
                        ) : (
                          <>
                            <label style={{ display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5 }}>Customer account</label>
                            <select value={d.customer_id || ''} onChange={(e) => draft(row, 'customer_id', e.target.value)} style={fieldStyle}>
                              <option value="">Choose customer…</option>
                              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.alpha_tag ? ` · ${customer.alpha_tag}` : ''}</option>)}
                            </select>
                            <button className="btn btn-xs btn-primary" disabled={working || !d.customer_id || !row.locked_at || row.approved_proof_version !== row.proof_version} style={{ marginTop: 9 }} onClick={() => staffApi(row, 'staff_convert', { customer_id: d.customer_id })}>Create Sales Order</button>
                            {(!row.locked_at || row.approved_proof_version !== row.proof_version) && <div style={{ fontSize: 11, color: '#92400e', marginTop: 7 }}>The latest proof must be approved and locked first.</div>}
                          </>
                        )}
                      </section>
                    </div>

                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                      <button className="btn btn-xs btn-secondary" disabled={working} onClick={() => downloadPDF(row)}>Download Production PDF</button>
                      <button className="btn btn-xs btn-secondary" disabled={working} onClick={() => downloadPNG(row)}>Download Production PNG</button>
                      <button className="btn btn-xs btn-secondary" onClick={() => downloadRosterCSV(row)}>Download Roster CSV</button>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 11.5, lineHeight: 1.5, color: '#64748b' }}><strong>Roster:</strong> {rosterSummary(row.roster)}</div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12, marginTop: 14 }}>
                      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 8 }}>Proof History</strong>
                        {detail.proofs.length ? detail.proofs.map((proof) => <div key={proof.id} style={{ padding: '7px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}><strong>Version {proof.version}</strong> · {proof.customer_decision ? LABEL[proof.customer_decision] || proof.customer_decision.replace('_', ' ') : proof.sent_at ? 'Waiting for coach' : 'Draft'}<div style={{ color: '#94a3b8', marginTop: 2 }}>{new Date(proof.created_at).toLocaleString()}</div></div>) : <div style={{ fontSize: 12, color: '#94a3b8' }}>No proof published yet.</div>}
                      </div>
                      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 7, padding: 13 }}>
                        <strong style={{ display: 'block', fontSize: 12, textTransform: 'uppercase', color: '#1e293b', marginBottom: 8 }}>Audit Trail</strong>
                        {detail.events.length ? detail.events.slice(0, 12).map((event) => <div key={event.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12 }}><strong>{event.message || event.event_type.replace(/_/g, ' ')}</strong><div style={{ color: '#94a3b8', marginTop: 2 }}>{new Date(event.created_at).toLocaleString()} · {event.actor_type}</div></div>) : <div style={{ fontSize: 12, color: '#94a3b8' }}>No lifecycle events yet.</div>}
                      </div>
                    </div>
                  </div>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
