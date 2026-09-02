import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

// Warehouse-dashboard card for the Bagging Station: live queue of batches
// ready to bag (same bagging_list_groups the station's picker uses), with
// ready/in-deco/short counts and one-click into /bagging-station. Light
// portal theme (this renders inside App.js, not the dark kiosk). Refreshes
// every 60s; failures render as a quiet retry row, never a broken card.
function useBaggingGroups() {
  const [groups, setGroups] = useState(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const jwt = data && data.session && data.session.access_token;
        const res = await fetch('/.netlify/functions/bagging-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt || ''}` },
          body: JSON.stringify({ action: 'list_groups' }),
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (json.ok) { setGroups(json.groups || []); setErr(false); } else setErr(true);
      } catch { if (alive) setErr(true); }
    };
    load();
    const t = setInterval(load, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  return { groups, err };
}

export function BaggingQueueTile() {
  const { groups } = useBaggingGroups();
  const totalReady = (groups || []).reduce((a, g) => a + (Number(g.ready) || 0), 0);

  return (
    <button
      type="button"
      onClick={() => window.open('/bagging-station', '_blank', 'noopener,noreferrer')}
      style={{
        padding: '14px 12px', borderRadius: 10, border: '1px solid #e2e8f0',
        background: '#fff', color: '#0f172a', cursor: 'pointer',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)', display: 'flex',
        flexDirection: 'column', alignItems: 'center', gap: 4,
        transition: 'all 0.15s', borderLeft: '4px solid #7c3aed',
      }}
      aria-label="Open Bagging Queue"
    >
      <div style={{ fontSize: 22, lineHeight: 1 }}>🛍️</div>
      <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1, color: '#7c3aed' }}>
        {groups ? totalReady : '—'}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, textAlign: 'center', opacity: 0.8 }}>Bagging Queue ↗</div>
    </button>
  );
}

export default function BaggingDashCard() {
  const { groups, err } = useBaggingGroups();

  const KIND = { so: 'Club batch', store: 'OMG school', backorders: 'Backorders' };
  const totalReady = (groups || []).reduce((a, g) => a + (Number(g.ready) || 0), 0);
  const totalShorts = (groups || []).reduce((a, g) => a + (Number(g.open_shorts) || 0), 0);
  const totalMins = (groups || []).reduce((a, g) => a + (Number(g.est_minutes) || 0), 0);
  const totalUnits = (groups || []).reduce((a, g) => a + (Number(g.ready_units) || 0), 0);
  const fmtM = (m) => (m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm');

  return (
    <div className="card" style={{ borderLeft: '3px solid #7c3aed' }}>
      <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>🛍️ Bagging Queue{groups ? ` (${totalReady} orders ready)` : ''}</h2>
        <a className="btn btn-sm btn-secondary" href="/bagging-station" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
          Open Station ↗
        </a>
      </div>
      <div className="card-body" style={{ padding: 0, maxHeight: 400, overflow: 'auto' }}>
        {!err && groups && totalMins > 0 && (
          <div style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#4c1d95', background: '#f5f3ff', borderBottom: '1px solid #ede9fe' }}>
            Today’s packing workload: {totalUnits} units · est <b>{fmtM(totalMins)}</b> for one packer
            {totalMins >= 90 ? <> · ~{fmtM(Math.ceil(totalMins / 2))} with two</> : null}
            <span style={{ color: '#7c3aed' }}> — learned from your team’s actual pace</span>
          </div>
        )}
        {err && (
          <div style={{ padding: 14, fontSize: 12, color: '#94a3b8' }}>Couldn’t load the bagging queue — retrying…</div>
        )}
        {!err && groups && groups.length === 0 && (
          <div className="empty" style={{ padding: 16, fontSize: 13 }}>Nothing waiting to be bagged. 🎉</div>
        )}
        {!err && !groups && (
          <div style={{ padding: 14, fontSize: 12, color: '#94a3b8' }}>Loading…</div>
        )}
        {(groups || []).map((g) => {
          const inDeco = Math.max(0, (Number(g.total) || 0) - (Number(g.bagged) || 0) - (Number(g.ready) || 0));
          return (
            <div key={g.kind + ':' + g.group_id} style={{ padding: '9px 14px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.store_name}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {KIND[g.kind] || g.kind}{g.kind === 'so' ? ' · ' + g.group_id : ''} · {g.bagged}/{g.total} bagged
                  {inDeco > 0 ? ` · ${inDeco} in deco` : ''}
                  {g.earliest_eta ? ` · ETA ${g.earliest_eta}` : ''}
                  {g.est_minutes > 0 ? ` · ⏱ ${fmtM(g.est_minutes)}` : ''}
                </div>
              </div>
              {Number(g.open_shorts) > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#fef3c7', color: '#92400e', whiteSpace: 'nowrap' }}>
                  {g.open_shorts} short
                </span>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#ede9fe', color: '#6d28d9', whiteSpace: 'nowrap' }}>
                {g.ready} ready
              </span>
            </div>
          );
        })}
        {!err && groups && totalShorts > 0 && (
          <div style={{ padding: '8px 14px', fontSize: 11, fontWeight: 600, color: '#92400e', background: '#fffbeb' }}>
            ⚠ {totalShorts} open short{totalShorts === 1 ? '' : 's'} across the queue — stores can’t ship until resolved (station → tap the shorts banner).
          </div>
        )}
      </div>
    </div>
  );
}
