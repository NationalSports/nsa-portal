/* eslint-disable */
// Admin page for the M&R hot-folder queue: GM/PM visibility,
// retry failed rows, cancel pending, see bridge liveness.

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from './lib/supabase';

const STATUS_COLORS = {
  pending:   { bg: '#fef3c7', fg: '#92400e', label: 'Pending' },
  delivered: { bg: '#dcfce7', fg: '#166534', label: 'Delivered' },
  failed:    { bg: '#fee2e2', fg: '#991b1b', label: 'Failed' },
  cancelled: { bg: '#e2e8f0', fg: '#475569', label: 'Cancelled' },
};

function fmtTs(ts) {
  if (!ts) return '—';
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function minutesAgo(ts) {
  if (!ts) return null;
  try {
    const diffSec = (Date.now() - new Date(ts).getTime()) / 1000;
    if (diffSec < 60) return `${Math.floor(diffSec)}s ago`;
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    return `${Math.floor(diffSec / 3600)}h ago`;
  } catch { return null; }
}

function ProductionQueueView({ nf }) {
  const [rows, setRows] = useState([]);
  const [heartbeats, setHeartbeats] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      if (!supabase) throw new Error('Supabase not configured');
      const [qRes, hRes] = await Promise.all([
        supabase.from('production_queue').select('*').order('created_at', { ascending: false }).limit(250),
        supabase.from('bridge_heartbeats').select('*').order('last_seen', { ascending: false }),
      ]);
      if (qRes.error) throw new Error(qRes.error.message);
      setRows(qRes.data || []);
      setHeartbeats(hRes.data || []);
    } catch (e) {
      setErr(e.message || String(e));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const retry = async (row) => {
    try {
      await supabase.from('production_queue').update({
        hot_folder_status: 'pending',
        error_message: null,
        retry_count: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      nf && nf('Retrying ' + row.barcode_value);
      load();
    } catch (e) { nf && nf('Retry failed: ' + e.message, 'error'); }
  };

  const cancel = async (row) => {
    try {
      await supabase.from('production_queue').update({
        hot_folder_status: 'cancelled',
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      nf && nf('Cancelled ' + row.barcode_value);
      load();
    } catch (e) { nf && nf('Cancel failed: ' + e.message, 'error'); }
  };

  const counts = rows.reduce((acc, r) => {
    acc[r.hot_folder_status] = (acc[r.hot_folder_status] || 0) + 1;
    acc.all = (acc.all || 0) + 1;
    return acc;
  }, {});

  const filtered = filter === 'all' ? rows : rows.filter(r => r.hot_folder_status === filter);

  return (
    <>
      <div className="stats-row" style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        <div className="stat-card" style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div className="stat-label" style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Pending</div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, color: '#92400e' }}>{counts.pending || 0}</div>
        </div>
        <div className="stat-card" style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div className="stat-label" style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Delivered</div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, color: '#166534' }}>{counts.delivered || 0}</div>
        </div>
        <div className="stat-card" style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div className="stat-label" style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Failed</div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, color: '#991b1b' }}>{counts.failed || 0}</div>
        </div>
        <div className="stat-card" style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12 }}>
          <div className="stat-label" style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Bridges</div>
          <div className="stat-value" style={{ fontSize: 28, fontWeight: 800, color: '#1e40af' }}>{heartbeats.length}</div>
        </div>
      </div>

      {heartbeats.length > 0 && (
        <div className="card" style={{ marginBottom: 16, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #e2e8f0', fontWeight: 700, fontSize: 13 }}>Bridge Heartbeats</div>
          <div style={{ padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {heartbeats.map(h => {
              const ago = minutesAgo(h.last_seen);
              const alive = h.last_seen && (Date.now() - new Date(h.last_seen).getTime()) < 2 * 60 * 1000;
              return (
                <div key={h.hostname} style={{ border: '1px solid ' + (alive ? '#bbf7d0' : '#fecaca'), background: alive ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                  <div style={{ fontWeight: 700 }}>{alive ? '🟢' : '🔴'} {h.hostname}</div>
                  <div style={{ color: '#64748b', marginTop: 2 }}>Last seen: {ago || fmtTs(h.last_seen)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {['all', 'pending', 'delivered', 'failed', 'cancelled'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1', fontWeight: 600, fontSize: 12, cursor: 'pointer',
              background: filter === f ? '#1e40af' : '#fff', color: filter === f ? '#fff' : '#1e293b',
            }}
          >
            {f === 'all' ? 'All' : (STATUS_COLORS[f]?.label || f)} ({counts[f] || 0})
          </button>
        ))}
        <button onClick={load} style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>↻ Refresh</button>
      </div>

      {err && <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>{err}</div>}

      <div className="card" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No rows in this view.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead style={{ background: '#f8fafc' }}>
              <tr>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>SO</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Art</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Deco</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>File</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Status</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Queued</th>
                <th style={{ textAlign: 'left', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Delivered</th>
                <th style={{ textAlign: 'right', padding: 10, fontWeight: 700, borderBottom: '1px solid #e2e8f0' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const s = STATUS_COLORS[r.hot_folder_status] || STATUS_COLORS.pending;
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: 10, fontWeight: 700, color: '#1e40af', fontFamily: 'monospace' }}>{r.so_id}</td>
                    <td style={{ padding: 10 }}>{r.art_name || '—'}</td>
                    <td style={{ padding: 10 }}>{r.deco_type === 'embroidery' ? '🧵 Emb' : '🎨 Screen'}</td>
                    <td style={{ padding: 10 }}>
                      {r.file_url ? <a href={r.file_url} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>{r.file_name}</a> : r.file_name}
                      {r.ticket_pdf_url && <> · <a href={r.ticket_pdf_url} target="_blank" rel="noopener noreferrer" style={{ color: '#7c3aed', fontSize: 11 }}>ticket</a></>}
                    </td>
                    <td style={{ padding: 10 }}>
                      <span style={{ background: s.bg, color: s.fg, padding: '2px 8px', borderRadius: 10, fontWeight: 700, fontSize: 11 }}>{s.label}</span>
                      {r.retry_count > 0 && <span style={{ marginLeft: 6, fontSize: 10, color: '#64748b' }}>retries: {r.retry_count}</span>}
                      {r.error_message && <div style={{ color: '#991b1b', fontSize: 10, marginTop: 2, maxWidth: 260, wordBreak: 'break-word' }}>{r.error_message}</div>}
                    </td>
                    <td style={{ padding: 10, color: '#64748b' }}>{fmtTs(r.created_at)}</td>
                    <td style={{ padding: 10, color: '#64748b' }}>
                      {r.delivered_at ? fmtTs(r.delivered_at) : '—'}
                      {r.delivered_by && <div style={{ fontSize: 10, color: '#94a3b8' }}>by {r.delivered_by}</div>}
                    </td>
                    <td style={{ padding: 10, textAlign: 'right' }}>
                      {r.hot_folder_status === 'failed' && (
                        <button onClick={() => retry(r)} style={{ padding: '4px 10px', fontSize: 11, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', marginRight: 4 }}>Retry</button>
                      )}
                      {r.hot_folder_status === 'pending' && (
                        <button onClick={() => cancel(r)} style={{ padding: '4px 10px', fontSize: 11, background: '#fff', color: '#991b1b', border: '1px solid #fca5a5', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

export default ProductionQueueView;
