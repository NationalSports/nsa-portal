/* eslint-disable */
// Settings → Uniform Orders — the queue every "Complete Your Order" path in
// the Pro Configurator lands in (card / school PO / manual), so staff work
// from one list regardless of how the coach checked out.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { renderProductionPDF, renderProductionSheet } from './renderCanvas';

const STATUSES = ['queued', 'pending_payment', 'po_submitted', 'processing', 'paid', 'completed', 'cancelled'];
const STATUS_COLOR = {
  queued: '#92400e', pending_payment: '#92400e', po_submitted: '#1d4ed8',
  processing: '#1d4ed8', paid: '#15803d', completed: '#15803d', cancelled: '#64748b',
};
const STATUS_BG = {
  queued: '#fef3c7', pending_payment: '#fef3c7', po_submitted: '#dbeafe',
  processing: '#dbeafe', paid: '#dcfce7', completed: '#dcfce7', cancelled: '#f1f5f9',
};
const FULFILL_LABEL = { card: '💳 Card', po: '🏫 School PO', manual: '📋 Queue' };

function fileBase(o) { return (o.team_name || 'order').toLowerCase().replace(/\s+/g, '-'); }
function rosterSummary(roster) { return (roster || []).map((r) => `${r.label || r.size} ×${r.qty} (#${r.nums})`).join('; ') || '—'; }

export default function UniformOrdersAdmin() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [busyId, setBusyId] = useState('');

  const load = async () => {
    try {
      const { data, error } = await supabase.from('uniform_order_requests')
        .select('id,team_name,sport,contact_name,contact_email,config,spec,bottom_spec,roster,total_qty,unit_price,total,fulfillment,status,po_number,po_contact,thumb,created_at')
        .order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      setRows(data || []); setErr('');
    } catch (e) { setRows([]); setErr('Could not load orders — ' + (e.message || e)); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (filter === 'all') return rows;
    if (filter === 'open') return rows.filter((r) => !['completed', 'cancelled'].includes(r.status));
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const setStatus = async (row, status) => {
    setBusyId(row.id);
    try {
      const { error } = await supabase.from('uniform_order_requests').update({ status }).eq('id', row.id);
      if (error) throw error;
      setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status } : r)));
    } catch (e) { setErr('Could not update status — ' + (e.message || e)); }
    setBusyId('');
  };

  const downloadRosterCSV = (row) => {
    const rows2 = [['Player Name', 'Number', 'Size']];
    (row.roster || []).forEach((r) => String(r.nums || '').split(',').map((s) => s.trim()).filter(Boolean)
      .forEach((n) => rows2.push(['', n, r.size || r.label || ''])));
    const csv = rows2.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${fileBase(row)}-roster.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const downloadPDF = async (row) => {
    setBusyId(row.id);
    try {
      const doc = await renderProductionPDF(row.spec, {
        roster: row.roster, bottomSpec: row.bottom_spec || undefined,
        order: { totalQty: row.total_qty, unitPrice: row.unit_price, total: row.total },
      });
      doc.save(`${fileBase(row)}-production.pdf`);
    } catch (e) { setErr('PDF export failed — ' + (e.message || e)); }
    setBusyId('');
  };
  const downloadPNG = async (row) => {
    setBusyId(row.id);
    try {
      const url = await renderProductionSheet(row.spec, { width: 1400, bottomSpec: row.bottom_spec || undefined });
      const a = document.createElement('a'); a.href = url; a.download = `${fileBase(row)}-production.png`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { setErr('PNG export failed — ' + (e.message || e)); }
    setBusyId('');
  };

  return (
    <div className="card">
      <div className="card-body" style={{ padding: 20 }}>
        <h3 style={{ margin: '0 0 4px', color: '#1e293b' }}>Uniform Builder — Order Queue</h3>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Every order — paid by card, submitted as a school PO, or queued with no payment yet — lands here.
        </div>
        {err && <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>{err}</div>}

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {['all', 'open', ...STATUSES].filter((v, i, a) => a.indexOf(v) === i).map((f) => (
            <button key={f} className={`btn btn-xs ${filter === f ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'open' ? 'Open' : f.replace('_', ' ')}
            </button>
          ))}
        </div>

        {rows === null ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>No orders in this view.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((row) => (
              <div key={row.id} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, display: 'flex', gap: 14, alignItems: 'flex-start', background: '#fff' }}>
                <div style={{ width: 64, height: 64, flexShrink: 0, borderRadius: 6, border: '1px solid #e2e8f0', overflow: 'hidden', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {row.thumb ? <img src={row.thumb} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <span style={{ fontSize: 20 }}>🎽</span>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 15, color: '#1e293b' }}>{row.team_name}</span>
                    {row.sport && <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>· {row.sport}</span>}
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: '#f1f5f9', color: '#475569' }}>{FULFILL_LABEL[row.fulfillment] || row.fulfillment}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: STATUS_BG[row.status] || '#f1f5f9', color: STATUS_COLOR[row.status] || '#475569', textTransform: 'capitalize' }}>{(row.status || '').replace('_', ' ')}</span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{row.contact_name} · {row.contact_email}</div>
                  <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>{row.total_qty} jerseys @ ${row.unit_price} = <strong>${Number(row.total).toLocaleString()}</strong>{row.po_number ? ` · PO ${row.po_number}` : ''}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{rosterSummary(row.roster)}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{new Date(row.created_at).toLocaleString()}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, minWidth: 160 }}>
                  <select value={row.status} disabled={busyId === row.id} onChange={(e) => setStatus(row, e.target.value)} style={{ fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                  <button className="btn btn-xs btn-secondary" disabled={busyId === row.id} onClick={() => downloadPDF(row)}>⬇ Production PDF</button>
                  <button className="btn btn-xs btn-secondary" disabled={busyId === row.id} onClick={() => downloadPNG(row)}>⬇ Production PNG</button>
                  <button className="btn btn-xs btn-secondary" onClick={() => downloadRosterCSV(row)}>⬇ Roster CSV</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
