import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './lib/supabase';

// CIFCS section id → name for the dropdowns. Canonical copy (and all the parsing
// logic) lives in src/lib/cifcs.js, which the sync function validates against;
// this is just the UI's picker list. Central (NSA's home) first.
const CIFCS_SECTIONS = [
  { id: 9, name: 'Central Section' },
  { id: 4, name: 'Central Coast Section' },
  { id: 6, name: 'Los Angeles City Section' },
  { id: 7, name: 'North Coast Section' },
  { id: 8, name: 'Northern Section' },
  { id: 2, name: 'Oakland Section' },
  { id: 5, name: 'SAC-Joaquin Section' },
  { id: 3, name: 'San Diego Section' },
  { id: 13, name: 'San Francisco Section' },
  { id: 1, name: 'Southern Section' },
  { id: 10, name: 'FHSAA' },
  { id: 11, name: 'North Carolina' },
  { id: 12, name: 'New Jersey' },
];

// Marketing → Prospects (Phase 1 of the CIFCS → Brevo module).
//
// A staff-only browser over `marketing_contacts` — athletic directors + coaches
// harvested from the public CIFCS directory. This phase is READ + SYNC only: no
// email is sent from here. "Sync from CIFCS" calls the staff-gated cifcs-sync
// function in batches (looping until done) and refreshes the table. Campaigns /
// sending are a later phase.

const LOAD_CAP = 10000;

export default function Marketing() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Filters — section + status are applied server-side; the rest are client-side.
  const [section, setSection] = useState('all');
  const [status, setStatus] = useState('active');
  const [sport, setSport] = useState('all');
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');

  // Sync state.
  const [syncSection, setSyncSection] = useState(String(CIFCS_SECTIONS[0].id));
  const [syncing, setSyncing] = useState(false);
  const [syncProg, setSyncProg] = useState(null); // {processed,total,upserted}
  const [syncMsg, setSyncMsg] = useState(null);
  const [syncErr, setSyncErr] = useState(null);

  const loadRows = useCallback(async () => {
    if (!supabase) { setErr('No DB connection'); return; }
    setLoading(true);
    setErr(null);
    try {
      let q = supabase
        .from('marketing_contacts')
        .select('*')
        .order('section_name', { ascending: true })
        .order('school_name', { ascending: true })
        .order('role', { ascending: true })
        .limit(LOAD_CAP);
      if (status !== 'all') q = q.eq('status', status);
      if (section !== 'all') q = q.eq('section_id', Number(section));
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, section]);

  useEffect(() => { loadRows(); }, [loadRows]);

  // Facets derived from the loaded scope.
  const sportOptions = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => { if (r.sport) s.add(r.sport); });
    return Array.from(s).sort();
  }, [rows]);
  const roleOptions = useMemo(() => {
    const s = new Set();
    rows.forEach((r) => { if (r.role) s.add(r.role); });
    return Array.from(s).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (sport !== 'all' && r.sport !== sport) return false;
      if (role !== 'all' && r.role !== role) return false;
      if (q) {
        const hay = `${r.first_name || ''} ${r.last_name || ''} ${r.email || ''} ${r.school_name || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, sport, role, search]);

  const stats = useMemo(() => {
    const schools = new Set();
    let coaches = 0, faculty = 0;
    filtered.forEach((r) => {
      if (r.school_id != null) schools.add(r.school_id);
      if (r.sport) coaches++; else faculty++;
    });
    return { schools: schools.size, coaches, faculty };
  }, [filtered]);

  const runSync = useCallback(async () => {
    const sectionId = Number(syncSection);
    setSyncing(true);
    setSyncErr(null);
    setSyncMsg(null);
    setSyncProg({ processed: 0, total: 0, upserted: 0 });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      let offset = 0, total = 0, upserted = 0, schoolsWithData = 0, sectionName = '', guard = 0;
      do {
        const res = await fetch(`/.netlify/functions/cifcs-sync?section_id=${sectionId}&offset=${offset}`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + session.access_token },
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        total = j.total;
        sectionName = j.section_name;
        upserted += j.contactsUpserted || 0;
        schoolsWithData += j.schoolsWithData || 0;
        const processed = Math.min(offset + (j.batch || 0), total);
        setSyncProg({ processed, total, upserted });
        offset = j.nextOffset;
        guard++;
      } while (offset != null && guard < 300);
      setSyncMsg(`${sectionName}: ${upserted} contact${upserted === 1 ? '' : 's'} synced from ${schoolsWithData} school${schoolsWithData === 1 ? '' : 's'}.`);
      // If we just synced a section, focus the table on it.
      setSection(String(sectionId));
      await loadRows();
    } catch (e) {
      setSyncErr(e.message || String(e));
    } finally {
      setSyncing(false);
      setSyncProg(null);
    }
  }, [syncSection, loadRows]);

  const exportCsv = useCallback(() => {
    const cols = ['section_name', 'school_name', 'role', 'sport', 'first_name', 'last_name', 'email', 'phone', 'ext', 'school_city', 'school_state', 'school_website'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    filtered.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cifcs-prospects-${section === 'all' ? 'all' : section}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered, section]);

  const toggleArchive = useCallback(async (row) => {
    const next = row.status === 'archived' ? 'active' : 'archived';
    const { error } = await supabase.from('marketing_contacts').update({ status: next }).eq('id', row.id);
    if (error) { setErr(error.message); return; }
    setRows((prev) => (
      // Drop it from view if it no longer matches the status filter; else update in place.
      status !== 'all' && next !== status
        ? prev.filter((r) => r.id !== row.id)
        : prev.map((r) => (r.id === row.id ? { ...r, status: next } : r))
    ));
  }, [status]);

  const pct = syncProg && syncProg.total ? Math.round((syncProg.processed / syncProg.total) * 100) : 0;

  return (
    <div>
      {/* ── Sync panel ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569', display: 'block' }}>Import prospects from CIFCS</label>
            <select className="form-select" value={syncSection} disabled={syncing} onChange={(e) => setSyncSection(e.target.value)}>
              {CIFCS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={runSync} disabled={syncing}>
            {syncing ? 'Syncing…' : 'Sync from CIFCS'}
          </button>
          {syncProg && (
            <div style={{ flex: '1 1 220px', minWidth: 200 }}>
              <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>
                {syncProg.processed} / {syncProg.total || '…'} schools · {syncProg.upserted} contacts
              </div>
              <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#2563eb', transition: 'width .3s' }} />
              </div>
            </div>
          )}
          {syncMsg && !syncing && <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>✓ {syncMsg}</div>}
          {syncErr && <div style={{ fontSize: 12, color: '#b91c1c', fontWeight: 600 }}>Sync error: {syncErr}</div>}
        </div>
        <div className="card-body" style={{ paddingTop: 0, fontSize: 11, color: '#94a3b8' }}>
          Read-only import of the public CIFCS directory (athletic directors + coaches). No email is sent — this builds the prospect list only.
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-body" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 220px', minWidth: 180 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Search</label>
            <input className="form-input" placeholder="Name, email, or school" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Section</label>
            <select className="form-select" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="all">All sections</option>
              {CIFCS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Sport / Role</label>
            <select className="form-select" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="all">All sports</option>
              {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Role</label>
            <select className="form-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">All roles</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Status</label>
            <select className="form-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <button className="btn" onClick={exportCsv} disabled={!filtered.length} title="Export the filtered list as CSV">
            Export CSV
          </button>
        </div>
      </div>

      {err && <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid #dc2626' }}>
        <div className="card-body" style={{ color: '#991b1b', fontSize: 13 }}>Error: {err}</div>
      </div>}

      <div className="card">
        <div className="card-header">
          <h2>
            {loading ? 'Loading…' : `${filtered.length.toLocaleString()} prospect${filtered.length === 1 ? '' : 's'}`}
            {!loading && filtered.length > 0 && (
              <span style={{ fontSize: 12, fontWeight: 400, color: '#64748b', marginLeft: 8 }}>
                {stats.schools} schools · {stats.faculty} faculty · {stats.coaches} coaches
              </span>
            )}
          </h2>
          {rows.length >= LOAD_CAP && (
            <div style={{ fontSize: 11, color: '#b45309' }}>Showing first {LOAD_CAP.toLocaleString()} — narrow by section to see the rest.</div>
          )}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>School</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Role</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Sport</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Email</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Section</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: r.status === 'archived' ? 0.5 : 1 }}>
                  <td style={{ padding: '8px 10px' }}>
                    <div style={{ fontWeight: 600, color: '#1e293b' }}>{r.school_name}</div>
                    {(r.school_city || r.school_state) && (
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{[r.school_city, r.school_state].filter(Boolean).join(', ')}</div>
                    )}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#475569' }}>{r.role}</td>
                  <td style={{ padding: '8px 10px', color: '#64748b' }}>{r.sport || '—'}</td>
                  <td style={{ padding: '8px 10px' }}>{[r.first_name, r.last_name].filter(Boolean).join(' ')}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {r.email ? <a href={`mailto:${r.email}`} style={{ color: '#2563eb', textDecoration: 'none' }}>{r.email}</a> : '—'}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {r.phone || ''}{r.ext ? ` x${r.ext}` : ''}
                  </td>
                  <td style={{ padding: '8px 10px', color: '#64748b', fontSize: 12 }}>{r.section_name}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button
                      className="btn"
                      style={{ fontSize: 11, padding: '2px 8px' }}
                      onClick={() => toggleArchive(r)}
                      title={r.status === 'archived' ? 'Restore to active' : 'Archive this prospect'}
                    >
                      {r.status === 'archived' ? 'Restore' : 'Archive'}
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: '#94a3b8' }}>
                    No prospects yet. Pick a section above and click <strong>Sync from CIFCS</strong> to import.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
