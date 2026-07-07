import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from './lib/supabase';

// Marketing → Prospects (Phase 1 of the CIFCS → Brevo module).
//
// Staff-only browser over `marketing_contacts` — athletic directors + coaches
// harvested from the public CIFCS directory. READ + SYNC only: no email is sent.
// "Sync from CIFCS" calls the staff-gated cifcs-sync function in batches (looping
// until done) and refreshes the table. Campaigns / sending are a later phase.
//
// Styling uses the NSA brand identity (navy #192853 / crimson #962C32, Barlow
// Condensed display + Source Sans 3 body, skewed athletic buttons, hover-lift
// tiles) — matching CoachPortal/QuickMockBuilder. Like those surfaces, the styles
// are injected inline here (there is no global token stylesheet) so the page reads
// as the new look while living inside the admin shell.

const LOAD_CAP = 10000;

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

const MK_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap');
.mk-scope{font-family:'Source Sans 3',system-ui,-apple-system,sans-serif;color:#2A2F3E}
.mk-scope *{box-sizing:border-box}
.mk-eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;color:#962C32;font-size:12px}
.mk-title{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:800;font-size:30px;line-height:1;color:#192853;letter-spacing:.5px;margin:3px 0 4px}
.mk-sub{color:#5A6075;font-size:13px}
.mk-head{margin-bottom:18px}
.mk-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}
.mk-tile{background:#fff;border:1px solid #EEF1F6;border-top:3px solid #192853;border-radius:6px;padding:14px 16px;box-shadow:0 2px 12px rgba(0,0,0,.06);transition:transform .15s,box-shadow .15s}
.mk-tile.click{cursor:pointer}
.mk-tile.click:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(25,40,83,.14)}
.mk-tile.accent{border-top-color:#962C32}
.mk-tile.green{border-top-color:#1F7A3D}
.mk-tile.on{outline:2px solid rgba(25,40,83,.25)}
.mk-tile-label{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.8px;font-weight:700;font-size:12px;color:#5A6075}
.mk-tile-val{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:28px;line-height:1;color:#192853;margin-top:3px}
.mk-tile-sub{font-size:11px;color:#8A90A0;margin-top:3px}
.mk-card{background:#fff;border:1px solid #EEF1F6;border-radius:6px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:16px;overflow:hidden}
.mk-card-h{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #EEF1F6}
.mk-h-title{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:800;font-size:16px;letter-spacing:.5px;color:#192853}
.mk-h-note{font-size:11px;color:#8A90A0;font-weight:600}
.mk-card-b{padding:14px 16px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.mk-field label{display:block;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.6px;font-weight:700;font-size:11px;color:#5A6075;margin-bottom:3px}
.mk-select,.mk-input{font-family:'Source Sans 3',sans-serif;font-size:13px;color:#2A2F3E;background:#fff;border:1px solid #D1D5DE;border-radius:4px;padding:7px 10px;outline:none}
.mk-select:focus,.mk-input:focus{border-color:#192853;box-shadow:0 0 0 3px rgba(25,40,83,.10)}
.mk-search{display:flex;align-items:center;gap:8px;border:1px solid #D1D5DE;border-radius:4px;padding:0 10px;background:#fff}
.mk-search:focus-within{border-color:#192853;box-shadow:0 0 0 3px rgba(25,40,83,.10)}
.mk-search input{flex:1;border:none;outline:none;padding:8px 0;font-size:13px;background:transparent;color:#2A2F3E}
.mk-search svg{color:#8A90A0;flex-shrink:0}
.mk-btn{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.5px;font-weight:700;font-size:13px;padding:8px 16px;border-radius:4px;cursor:pointer;border:1px solid transparent;transform:skewX(-3deg);display:inline-flex;align-items:center;gap:6px}
.mk-btn>span{display:inline-block;transform:skewX(3deg)}
.mk-btn-navy{background:#192853;color:#fff}
.mk-btn-navy:hover:not(:disabled){background:#0F1A38}
.mk-btn-ghost{background:#fff;color:#192853;border-color:#D1D5DE}
.mk-btn-ghost:hover:not(:disabled){background:#F7F8FB}
.mk-btn:disabled{opacity:.45;cursor:not-allowed}
.mk-btn-sm{padding:4px 11px;font-size:12px}
.mk-badge{display:inline-block;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.4px;font-weight:700;font-size:11px;padding:3px 9px;border-radius:3px;transform:skewX(-3deg)}
.mk-badge>span{display:inline-block;transform:skewX(3deg)}
.mk-badge.navy{background:#192853;color:#fff}
.mk-badge.accent{background:#962C32;color:#fff}
.mk-badge.green{background:#1F7A3D;color:#fff}
.mk-badge.slate{background:#EEF1F6;color:#5A6075}
.mk-badge.gold{background:#F2ECE0;color:#7a5c1e}
.mk-progress{height:6px;background:#EEF1F6;border-radius:3px;overflow:hidden}
.mk-progress>div{height:100%;background:#192853;transition:width .3s}
.mk-table-wrap{overflow:auto;max-height:62vh}
.mk-table{width:100%;border-collapse:collapse;font-size:13px}
.mk-table thead th{position:sticky;top:0;background:#fff;z-index:1;text-align:left;padding:9px 12px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.5px;font-weight:700;font-size:11px;color:#5A6075;border-bottom:2px solid #192853;white-space:nowrap}
.mk-table thead th.sortable{cursor:pointer;user-select:none}
.mk-table tbody td{padding:9px 12px;border-bottom:1px solid #F2ECE0;vertical-align:top}
.mk-table tbody tr:hover{background:#F7F8FB}
.mk-link{color:#962C32;text-decoration:none;font-weight:600}
.mk-link:hover{text-decoration:underline}
.mk-empty{text-align:center;padding:44px;color:#8A90A0;font-size:14px}
`;

// Role → badge variant. AD is the primary buyer contact (navy); coaches green;
// front office crimson; support gold.
function roleBadge(role) {
  switch (role) {
    case 'Athletic Director': return 'navy';
    case 'Head Coach': return 'green';
    case 'Assistant Coach': return 'slate';
    case 'Principal':
    case 'Vice Principal': return 'accent';
    default: return 'gold';
  }
}

const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
  </svg>
);

// Skewed athletic button — un-skews its label, matching the brand button idiom.
const Btn = ({ variant = 'ghost', size, children, ...rest }) => (
  <button className={`mk-btn mk-btn-${variant}${size === 'sm' ? ' mk-btn-sm' : ''}`} {...rest}>
    <span>{children}</span>
  </button>
);
const Badge = ({ variant, children }) => (
  <span className={`mk-badge ${variant}`}><span>{children}</span></span>
);

function ProspectsView() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  // Filters — section + status server-side; sport/role/search client-side.
  const [section, setSection] = useState('all');
  const [status, setStatus] = useState('active');
  const [sport, setSport] = useState('all');
  const [role, setRole] = useState('all');
  const [search, setSearch] = useState('');

  // Table controls.
  const [sort, setSort] = useState({ key: 'school_name', dir: 'asc' });
  const [selected, setSelected] = useState(new Set());

  // Sync state.
  const [syncSection, setSyncSection] = useState(String(CIFCS_SECTIONS[0].id));
  const [resumeOffset, setResumeOffset] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncProg, setSyncProg] = useState(null);
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
      setSelected(new Set());
    } catch (e) {
      setErr(e.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [status, section]);

  useEffect(() => { loadRows(); }, [loadRows]);

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

  const sorted = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    const key = sort.key;
    const val = (r) => {
      if (key === 'name') return `${r.last_name || ''} ${r.first_name || ''}`.toLowerCase();
      return String(r[key] == null ? '' : r[key]).toLowerCase();
    };
    return [...filtered].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [filtered, sort]);

  const scopeStats = useMemo(() => {
    const schools = new Set();
    const sections = new Set();
    let ad = 0, headCoach = 0;
    rows.forEach((r) => {
      if (r.school_id != null) schools.add(r.school_id);
      if (r.section_id != null) sections.add(r.section_id);
      if (r.role === 'Athletic Director') ad++;
      if (r.role === 'Head Coach') headCoach++;
    });
    return { total: rows.length, schools: schools.size, ad, headCoach, sections: sections.size };
  }, [rows]);

  const clearFilters = () => { setSport('all'); setRole('all'); setSearch(''); };

  const runSync = useCallback(async () => {
    const sectionId = Number(syncSection);
    setSyncing(true);
    setSyncErr(null);
    setSyncMsg(null);
    setSyncProg({ processed: 0, total: 0, upserted: 0 });
    let offset = resumeOffset, total = 0, upserted = 0, schoolsWithData = 0, sectionName = '';
    let hadError = null;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in');
      let guard = 0;
      while (guard < 500) {
        // Retry a failed batch a few times (the server already retries the origin;
        // this covers a cold function or a dropped connection) before giving up.
        let j = null;
        for (let attempt = 0; attempt < 3 && !j; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 900 * attempt));
          try {
            const res = await fetch(`/.netlify/functions/cifcs-sync?section_id=${sectionId}&offset=${offset}`, {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + session.access_token },
            });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
            j = body;
          } catch (e) {
            if (attempt === 2) throw e;
          }
        }
        total = j.total;
        sectionName = j.section_name;
        upserted += j.contactsUpserted || 0;
        schoolsWithData += j.schoolsWithData || 0;
        setSyncProg({ processed: Math.min(offset + (j.batch || 0), total), total, upserted });
        guard++;
        if (j.nextOffset == null) { offset = null; break; }
        offset = j.nextOffset;
      }
    } catch (e) {
      hadError = e.message || String(e);
    } finally {
      setSyncing(false);
      setSyncProg(null);
      setResumeOffset(hadError ? offset : 0);
      setSection(String(sectionId));
      await loadRows();
      if (hadError) {
        setSyncErr(`Stopped early (${hadError}). ${upserted} contact${upserted === 1 ? '' : 's'} imported so far — click Resume to continue.`);
      } else {
        setSyncMsg(`${sectionName}: ${upserted} contact${upserted === 1 ? '' : 's'} synced from ${schoolsWithData} school${schoolsWithData === 1 ? '' : 's'}.`);
      }
    }
  }, [syncSection, resumeOffset, loadRows]);

  const rowsToCsv = useCallback((list) => {
    const cols = ['section_name', 'school_name', 'role', 'sport', 'first_name', 'last_name', 'email', 'phone', 'ext', 'school_city', 'school_state', 'school_website'];
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.join(',')];
    list.forEach((r) => lines.push(cols.map((c) => esc(r[c])).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cifcs-prospects-${section === 'all' ? 'all' : section}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [section]);

  const setStatusFor = useCallback(async (ids, next) => {
    if (!ids.length) return;
    const { error } = await supabase.from('marketing_contacts').update({ status: next }).in('id', ids);
    if (error) { setErr(error.message); return; }
    const idSet = new Set(ids);
    setRows((prev) => (
      status !== 'all' && next !== status
        ? prev.filter((r) => !idSet.has(r.id))
        : prev.map((r) => (idSet.has(r.id) ? { ...r, status: next } : r))
    ));
    setSelected(new Set());
  }, [status]);

  const allVisibleSelected = sorted.length > 0 && sorted.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) sorted.forEach((r) => next.delete(r.id));
      else sorted.forEach((r) => next.add(r.id));
      return next;
    });
  };
  const toggleOne = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const anySelected = selected.size > 0;

  const SortTh = ({ k, label, style }) => {
    const active = sort.key === k;
    return (
      <th className="sortable" style={style} onClick={() => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'asc' ? 'desc' : 'asc' }))}>
        {label}<span style={{ color: active ? '#192853' : '#cbd5e1', marginLeft: 4 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </th>
    );
  };

  const pct = syncProg && syncProg.total ? Math.round((syncProg.processed / syncProg.total) * 100) : 0;
  const filtersActive = sport !== 'all' || role !== 'all' || !!search;

  return (
    <div className="mk-scope">
      <style>{MK_CSS}</style>

      <div className="mk-head">
        <div className="mk-eyebrow">★ Sales Prospecting ★</div>
        <h1 className="mk-title">CIFCS Prospects</h1>
        <div className="mk-sub">Athletic directors &amp; coaches from the CIFCS directory. Read-only — no email is sent from this page.</div>
      </div>

      {/* ── Stat tiles ── */}
      <div className="mk-tiles">
        <div className="mk-tile click" onClick={clearFilters} title="Show all loaded prospects">
          <div className="mk-tile-label">Prospects</div>
          <div className="mk-tile-val">{scopeStats.total.toLocaleString()}</div>
          <div className="mk-tile-sub">emailable contacts loaded</div>
        </div>
        <div className="mk-tile">
          <div className="mk-tile-label">Schools</div>
          <div className="mk-tile-val">{scopeStats.schools.toLocaleString()}</div>
          <div className="mk-tile-sub">{scopeStats.sections} section{scopeStats.sections === 1 ? '' : 's'} loaded</div>
        </div>
        <div className={`mk-tile accent click${role === 'Athletic Director' ? ' on' : ''}`} onClick={() => setRole('Athletic Director')} title="Filter to athletic directors">
          <div className="mk-tile-label">Athletic Directors</div>
          <div className="mk-tile-val">{scopeStats.ad.toLocaleString()}</div>
          <div className="mk-tile-sub">primary buyer contact</div>
        </div>
        <div className={`mk-tile green click${role === 'Head Coach' ? ' on' : ''}`} onClick={() => setRole('Head Coach')} title="Filter to head coaches">
          <div className="mk-tile-label">Head Coaches</div>
          <div className="mk-tile-val">{scopeStats.headCoach.toLocaleString()}</div>
          <div className="mk-tile-sub">by sport</div>
        </div>
        <div className={`mk-tile${anySelected ? ' click' : ''}`} onClick={() => anySelected && rowsToCsv(selectedRows)} title={anySelected ? 'Export selected' : ''}>
          <div className="mk-tile-label">Selected</div>
          <div className="mk-tile-val" style={anySelected ? undefined : { color: '#cbd5e1' }}>{selected.size.toLocaleString()}</div>
          <div className="mk-tile-sub">{anySelected ? 'click to export' : 'none selected'}</div>
        </div>
      </div>

      {/* ── Sync panel ── */}
      <div className="mk-card">
        <div className="mk-card-h">
          <span className="mk-h-title">Import from CIFCS</span>
          <span className="mk-h-note">Read-only · no email sent</span>
        </div>
        <div className="mk-card-b">
          <div className="mk-field">
            <label>Section</label>
            <select className="mk-select" style={{ width: 220 }} value={syncSection} disabled={syncing}
              onChange={(e) => { setSyncSection(e.target.value); setResumeOffset(0); setSyncErr(null); setSyncMsg(null); }}>
              {CIFCS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <Btn variant="navy" onClick={runSync} disabled={syncing}>{syncing ? 'Syncing…' : resumeOffset > 0 ? 'Resume sync' : 'Sync from CIFCS'}</Btn>
          {syncProg && (
            <div style={{ flex: '1 1 240px', minWidth: 220 }}>
              <div style={{ fontSize: 11, color: '#5A6075', marginBottom: 4, fontWeight: 600 }}>
                {syncProg.processed} / {syncProg.total || '…'} schools · {syncProg.upserted} contacts
              </div>
              <div className="mk-progress"><div style={{ width: `${pct}%` }} /></div>
            </div>
          )}
          {syncMsg && !syncing && <Badge variant="green">✓ {syncMsg}</Badge>}
          {syncErr && <Badge variant="accent">Sync error: {syncErr}</Badge>}
        </div>
      </div>

      {/* ── Filter toolbar ── */}
      <div className="mk-card">
        <div className="mk-card-b">
          <div className="mk-field" style={{ flex: '1 1 240px', minWidth: 200 }}>
            <label>Search</label>
            <div className="mk-search">
              <SearchIcon />
              <input placeholder="Name, email, or school" value={search} onChange={(e) => setSearch(e.target.value)} autoFocus />
            </div>
          </div>
          <div className="mk-field">
            <label>Section</label>
            <select className="mk-select" value={section} onChange={(e) => setSection(e.target.value)}>
              <option value="all">All sections</option>
              {CIFCS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="mk-field">
            <label>Sport</label>
            <select className="mk-select" value={sport} onChange={(e) => setSport(e.target.value)}>
              <option value="all">All sports</option>
              {sportOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="mk-field">
            <label>Role</label>
            <select className="mk-select" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="all">All roles</option>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="mk-field">
            <label>Status</label>
            <select className="mk-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <Btn variant="ghost" onClick={clearFilters} disabled={!filtersActive}>Clear</Btn>
          <Btn variant="ghost" onClick={() => rowsToCsv(sorted)} disabled={!sorted.length}>Export CSV</Btn>
        </div>
      </div>

      {err && <div className="mk-card"><div className="mk-card-b" style={{ color: '#962C32', fontWeight: 600, fontSize: 13 }}>Error: {err}</div></div>}

      {/* ── Table ── */}
      <div className="mk-card">
        <div className="mk-card-h">
          <span className="mk-h-title">
            {loading ? 'Loading…' : `${sorted.length.toLocaleString()} Prospect${sorted.length === 1 ? '' : 's'}`}
            {!loading && rows.length >= LOAD_CAP && (
              <span style={{ fontFamily: "'Source Sans 3',sans-serif", fontSize: 11, fontWeight: 600, color: '#B8333B', marginLeft: 8, textTransform: 'none', letterSpacing: 0 }}>
                first {LOAD_CAP.toLocaleString()} — narrow by section for the rest
              </span>
            )}
          </span>
          {anySelected ? (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#5A6075', fontWeight: 700 }}>{selected.size} selected</span>
              <Btn variant="ghost" size="sm" onClick={() => setStatusFor([...selected], 'archived')}>Archive</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setStatusFor([...selected], 'active')}>Restore</Btn>
              <Btn variant="ghost" size="sm" onClick={() => rowsToCsv(selectedRows)}>Export selected</Btn>
              <Btn variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Btn>
            </div>
          ) : null}
        </div>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="Select all visible" style={{ cursor: 'pointer' }} />
                </th>
                <SortTh k="school_name" label="School" />
                <SortTh k="role" label="Role" />
                <SortTh k="sport" label="Sport" />
                <SortTh k="name" label="Name" />
                <SortTh k="email" label="Email" />
                <th>Phone</th>
                <SortTh k="section_name" label="Section" />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} style={{ opacity: r.status === 'archived' ? 0.55 : 1, background: selected.has(r.id) ? '#F3F5FA' : undefined }}>
                  <td><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleOne(r.id)} style={{ cursor: 'pointer' }} /></td>
                  <td>
                    <div style={{ fontWeight: 600, color: '#192853' }}>{r.school_name}</div>
                    {(r.school_city || r.school_state) && (
                      <div style={{ fontSize: 11, color: '#8A90A0' }}>{[r.school_city, r.school_state].filter(Boolean).join(', ')}</div>
                    )}
                  </td>
                  <td><Badge variant={roleBadge(r.role)}>{r.role}</Badge></td>
                  <td style={{ color: '#5A6075' }}>{r.sport || '—'}</td>
                  <td style={{ color: '#2A2F3E', fontWeight: 500 }}>{[r.first_name, r.last_name].filter(Boolean).join(' ') || '—'}</td>
                  <td>{r.email ? <a href={`mailto:${r.email}`} className="mk-link">{r.email}</a> : '—'}</td>
                  <td style={{ color: '#5A6075', whiteSpace: 'nowrap' }}>{r.phone || ''}{r.ext ? ` x${r.ext}` : ''}</td>
                  <td style={{ color: '#5A6075' }}>{r.section_name}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {r.status === 'archived' && <span style={{ marginRight: 6 }}><Badge variant="slate">archived</Badge></span>}
                    <Btn variant="ghost" size="sm" onClick={() => setStatusFor([r.id], r.status === 'archived' ? 'active' : 'archived')}>
                      {r.status === 'archived' ? 'Restore' : 'Archive'}
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && sorted.length === 0 && (
            <div className="mk-empty">
              No prospects yet. Pick a section above and click <strong>Sync from CIFCS</strong> to import.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Roles offered in the campaign segment picker (mirrors CIFCS athletic-faculty +
// coach roles). "Head Coach"/"Assistant Coach" cover every sport.
const SEGMENT_ROLES = ['Athletic Director', 'Head Coach', 'Assistant Coach', 'Principal', 'Vice Principal', 'Activities Director', 'AD Assistant', 'Athletic Trainer'];
const MERGE_HINT = ['first_name', 'last_name', 'school_name', 'school_city', 'section_name', 'role', 'sport'];

async function authFetchJson(url, opts) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  const res = await fetch(url, { ...opts, headers: { ...(opts && opts.headers), Authorization: 'Bearer ' + session.access_token } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  return j;
}

const BLANK_CAMPAIGN = {
  id: null, name: '', subject: '', html_body: '', sender_email: '', reply_to: '', send_rate: 60,
  segment: { section_id: 'all', role: 'all', sport: '' },
};

function CampaignsView() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [c, setC] = useState(BLANK_CAMPAIGN);
  const [recipientCount, setRecipientCount] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(null); // 'save' | 'test' | 'send'
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);
  const [results, setResults] = useState({}); // campaignId -> {status: count}

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.from('marketing_campaigns').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      setCampaigns(data || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  // Live recipient estimate for the current segment (active, emailable contacts).
  const seg = c.segment;
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let q = supabase.from('marketing_contacts').select('id', { count: 'exact', head: true }).eq('status', 'active').not('email', 'is', null);
        if (seg.section_id !== 'all') q = q.eq('section_id', Number(seg.section_id));
        if (seg.role !== 'all') q = q.eq('role', seg.role);
        if (seg.sport && seg.sport.trim()) q = q.eq('sport', seg.sport.trim());
        const { count } = await q;
        if (!cancelled) setRecipientCount(count == null ? null : count);
      } catch { if (!cancelled) setRecipientCount(null); }
    })();
    return () => { cancelled = true; };
  }, [seg.section_id, seg.role, seg.sport]);

  const setField = (k, v) => setC((prev) => ({ ...prev, [k]: v }));
  const setSeg = (k, v) => setC((prev) => ({ ...prev, segment: { ...prev.segment, [k]: v } }));
  const editExisting = (row) => {
    setC({
      id: row.id, name: row.name || '', subject: row.subject || '', html_body: row.html_body || '',
      sender_email: row.sender_email || '', reply_to: row.reply_to || '', send_rate: row.send_rate || 60,
      segment: { section_id: (row.segment && row.segment.section_id) ?? 'all', role: (row.segment && row.segment.role) ?? 'all', sport: (row.segment && row.segment.sport) || '' },
    });
    setMsg(null); setErr(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveDraft = useCallback(async () => {
    setBusy('save'); setErr(null); setMsg(null);
    try {
      if (!c.name.trim() || !c.subject.trim() || !c.html_body.trim()) throw new Error('Name, subject, and body are required.');
      const payload = {
        name: c.name.trim(), subject: c.subject.trim(), html_body: c.html_body,
        sender_email: c.sender_email.trim() || null, reply_to: c.reply_to.trim() || null,
        send_rate: Math.max(1, Math.min(100, Number(c.send_rate) || 60)),
        segment: { section_id: seg.section_id, role: seg.role, sport: (seg.sport || '').trim() },
        updated_at: new Date().toISOString(),
      };
      let saved;
      if (c.id) {
        const { data, error } = await supabase.from('marketing_campaigns').update(payload).eq('id', c.id).select().single();
        if (error) throw error; saved = data;
      } else {
        const { data, error } = await supabase.from('marketing_campaigns').insert(payload).select().single();
        if (error) throw error; saved = data;
      }
      setC((prev) => ({ ...prev, id: saved.id }));
      setMsg('Draft saved.');
      loadCampaigns();
      return saved;
    } catch (e) { setErr(e.message); return null; }
    finally { setBusy(null); }
  }, [c, seg, loadCampaigns]);

  const sendTest = useCallback(async () => {
    setBusy('test'); setErr(null); setMsg(null);
    try {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testTo.trim())) throw new Error('Enter a valid test email.');
      const saved = await saveDraft();
      if (!saved) throw new Error('Fix the draft first.');
      const j = await authFetchJson('/.netlify/functions/marketing-campaign-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: saved.id, action: 'test', test_to: testTo.trim() }),
      });
      setMsg(`Test sent to ${testTo.trim()} (rendered with ${j.renderedWith}).`);
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }, [testTo, saveDraft]);

  const sendCampaign = useCallback(async () => {
    const n = recipientCount;
    if (!window.confirm(`Queue this campaign to ${n == null ? 'the segment' : n + ' recipient' + (n === 1 ? '' : 's')}? Suppressed/unsubscribed addresses are skipped automatically. This starts real delivery.`)) return;
    setBusy('send'); setErr(null); setMsg(null);
    try {
      const saved = await saveDraft();
      if (!saved) throw new Error('Fix the draft first.');
      const j = await authFetchJson('/.netlify/functions/marketing-campaign-send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: saved.id, action: 'send' }),
      });
      setMsg(`Queued ${j.queued} email${j.queued === 1 ? '' : 's'} (${j.suppressed} suppressed, ${j.alreadyQueued} already queued). Delivering over ~${j.estimatedHours}h via the send queue.`);
      loadCampaigns();
    } catch (e) { setErr(e.message); }
    finally { setBusy(null); }
  }, [recipientCount, saveDraft, loadCampaigns]);

  const loadResults = useCallback(async (id) => {
    try {
      const { data, error } = await supabase.from('marketing_sends').select('status').eq('campaign_id', id).limit(5000);
      if (error) throw error;
      const tally = {};
      (data || []).forEach((r) => { tally[r.status] = (tally[r.status] || 0) + 1; });
      setResults((prev) => ({ ...prev, [id]: tally }));
    } catch (e) { setErr(e.message); }
  }, []);

  const insertToken = (t) => setC((prev) => ({ ...prev, html_body: `${prev.html_body}{{${t}}}` }));
  const canAct = c.name.trim() && c.subject.trim() && c.html_body.trim();

  return (
    <div>
      <div className="mk-head">
        <div className="mk-eyebrow">★ Outreach ★</div>
        <h1 className="mk-title">{c.id ? 'Edit Campaign' : 'New Campaign'}</h1>
        <div className="mk-sub">Compose once, personalize per recipient. Every send carries a one-click unsubscribe + your postal address, skips suppressed addresses, and drips through the send queue — never a blast.</div>
      </div>

      {/* ── Composer ── */}
      <div className="mk-card">
        <div className="mk-card-h"><span className="mk-h-title">Compose</span>
          <span className="mk-h-note">{recipientCount == null ? '' : `${recipientCount.toLocaleString()} recipient${recipientCount === 1 ? '' : 's'} in segment`}</span>
        </div>
        <div className="mk-card-b" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="mk-field" style={{ flex: '2 1 240px' }}>
              <label>Campaign name (internal)</label>
              <input className="mk-input" style={{ width: '100%' }} value={c.name} onChange={(e) => setField('name', e.target.value)} placeholder="Central Section — Spring baseball" />
            </div>
            <div className="mk-field">
              <label>Send rate (/hour)</label>
              <input className="mk-input" type="number" min="1" max="100" style={{ width: 110 }} value={c.send_rate} onChange={(e) => setField('send_rate', e.target.value)} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div className="mk-field"><label>Segment · Section</label>
              <select className="mk-select" value={seg.section_id} onChange={(e) => setSeg('section_id', e.target.value)}>
                <option value="all">All sections</option>
                {CIFCS_SECTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className="mk-field"><label>Segment · Role</label>
              <select className="mk-select" value={seg.role} onChange={(e) => setSeg('role', e.target.value)}>
                <option value="all">All roles</option>
                {SEGMENT_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="mk-field"><label>Segment · Sport (optional)</label>
              <input className="mk-input" value={seg.sport} onChange={(e) => setSeg('sport', e.target.value)} placeholder="e.g. Baseball" />
            </div>
          </div>

          <div className="mk-field" style={{ marginTop: 12 }}>
            <label>Subject</label>
            <input className="mk-input" style={{ width: '100%' }} value={c.subject} onChange={(e) => setField('subject', e.target.value)} placeholder="Team gear for {{school_name}} — a quick idea" />
          </div>

          <div className="mk-field" style={{ marginTop: 12 }}>
            <label>Body — plain text with {'{{merge_fields}}'}; links and line breaks preserved</label>
            <textarea style={{ width: '100%', minHeight: 180, fontFamily: "'Source Sans 3',sans-serif", fontSize: 13, color: '#2A2F3E', border: '1px solid #D1D5DE', borderRadius: 4, padding: 10, outline: 'none', resize: 'vertical' }}
              value={c.html_body} onChange={(e) => setField('html_body', e.target.value)}
              placeholder={'Hi Coach {{last_name}},\n\nWe outfit teams across the {{section_name}} and would love to put together a concept for {{school_name}}...'} />
            <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: '#8A90A0', fontWeight: 600 }}>Insert:</span>
              {MERGE_HINT.map((t) => <button key={t} onClick={() => insertToken(t)} style={{ cursor: 'pointer', fontFamily: "'Source Sans 3',sans-serif", fontSize: 11, border: '1px solid #D1D5DE', background: '#F7F8FB', borderRadius: 3, padding: '2px 7px', color: '#5A6075' }}>{`{{${t}}}`}</button>)}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
            <div className="mk-field" style={{ flex: '1 1 220px' }}>
              <label>From (marketing sender)</label>
              <input className="mk-input" style={{ width: '100%' }} value={c.sender_email} onChange={(e) => setField('sender_email', e.target.value)} placeholder="reachout@team.nationalsportsapparel.com" />
            </div>
            <div className="mk-field" style={{ flex: '1 1 220px' }}>
              <label>Reply-to (optional)</label>
              <input className="mk-input" style={{ width: '100%' }} value={c.reply_to} onChange={(e) => setField('reply_to', e.target.value)} placeholder="your.rep@nationalsportsapparel.com" />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 16, alignItems: 'center' }}>
            <Btn variant="ghost" onClick={saveDraft} disabled={!canAct || !!busy}>{busy === 'save' ? 'Saving…' : c.id ? 'Save changes' : 'Save draft'}</Btn>
            <div className="mk-search" style={{ maxWidth: 260 }}>
              <input placeholder="test@you.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
            </div>
            <Btn variant="ghost" onClick={sendTest} disabled={!canAct || !!busy}>{busy === 'test' ? 'Sending…' : 'Send test'}</Btn>
            <Btn variant="navy" onClick={sendCampaign} disabled={!canAct || !!busy || !recipientCount}>{busy === 'send' ? 'Queuing…' : `Send to ${recipientCount == null ? 'segment' : recipientCount.toLocaleString()}`}</Btn>
            {c.id && <Btn variant="ghost" onClick={() => { setC(BLANK_CAMPAIGN); setMsg(null); setErr(null); }}>New</Btn>}
          </div>
          {msg && <div style={{ marginTop: 10 }}><Badge variant="green">✓ {msg}</Badge></div>}
          {err && <div style={{ marginTop: 10 }}><Badge variant="accent">{err}</Badge></div>}
        </div>
      </div>

      {/* ── Campaign list ── */}
      <div className="mk-card">
        <div className="mk-card-h"><span className="mk-h-title">{loading ? 'Loading…' : `${campaigns.length} Campaign${campaigns.length === 1 ? '' : 's'}`}</span></div>
        <div className="mk-table-wrap">
          <table className="mk-table">
            <thead><tr><th>Name</th><th>Status</th><th>Segment</th><th>Queued</th><th>Created</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
            <tbody>
              {campaigns.map((row) => {
                const r = results[row.id];
                const segTxt = [(row.segment && row.segment.section_id && row.segment.section_id !== 'all') ? (CIFCS_SECTIONS.find((s) => String(s.id) === String(row.segment.section_id)) || {}).name : 'All sections',
                  (row.segment && row.segment.role && row.segment.role !== 'all') ? row.segment.role : null, (row.segment && row.segment.sport) || null].filter(Boolean).join(' · ');
                return (
                  <React.Fragment key={row.id}>
                    <tr>
                      <td style={{ fontWeight: 600, color: '#192853' }}>{row.name}</td>
                      <td><Badge variant={row.status === 'sending' ? 'green' : row.status === 'sent' ? 'navy' : row.status === 'cancelled' ? 'accent' : 'slate'}>{row.status}</Badge></td>
                      <td style={{ color: '#5A6075', fontSize: 12 }}>{segTxt}</td>
                      <td style={{ color: '#5A6075' }}>{(row.counts && row.counts.queued) || 0}</td>
                      <td style={{ color: '#8A90A0', fontSize: 12 }}>{(row.created_at || '').slice(0, 10)}</td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <Btn variant="ghost" size="sm" onClick={() => editExisting(row)}>Edit</Btn>{' '}
                        <Btn variant="ghost" size="sm" onClick={() => loadResults(row.id)}>Results</Btn>
                      </td>
                    </tr>
                    {r && (
                      <tr><td colSpan={6} style={{ background: '#F7F8FB' }}>
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12, color: '#5A6075', padding: '2px 0' }}>
                          {Object.keys(r).length === 0 ? <span>No sends yet.</span> : Object.entries(r).map(([k, v]) => <span key={k}><strong style={{ color: '#192853' }}>{v}</strong> {k}</span>)}
                        </div>
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
              {!loading && campaigns.length === 0 && <tr><td colSpan={6} className="mk-empty">No campaigns yet. Compose one above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase', letterSpacing: '.6px', fontWeight: 700, fontSize: 14,
      padding: '10px 18px', cursor: 'pointer', background: 'none', border: 'none', color: active ? '#192853' : '#8A90A0',
      borderBottom: active ? '3px solid #962C32' : '3px solid transparent', marginBottom: -2,
    }}>{children}</button>
  );
}

export default function Marketing() {
  const [tab, setTab] = useState('prospects');
  return (
    <div className="mk-scope">
      <style>{MK_CSS}</style>
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #EEF1F6', marginBottom: 18 }}>
        <TabBtn active={tab === 'prospects'} onClick={() => setTab('prospects')}>Prospects</TabBtn>
        <TabBtn active={tab === 'campaigns'} onClick={() => setTab('campaigns')}>Campaigns</TabBtn>
      </div>
      {tab === 'prospects' ? <ProspectsView /> : <CampaignsView />}
    </div>
  );
}
