/* eslint-disable */
// ─────────────────────────────────────────────────────────────────────────────
// Sheets — a lightweight, Smartsheet-style grid built into the portal.
//
// Goals vs. Smartsheet: faster, no row caps, instant search, typed columns with
// colored status pills, keyboard-driven editing, one-click CSV in/out, and the
// whole thing lives next to the rest of your data instead of in a separate SaaS.
//
// Persistence is graceful: it syncs each sheet to a Supabase `sheets` table when
// that table exists (run supabase_migration_062_sheets.sql), and otherwise falls
// back to localStorage so it's fully usable offline / before the migration runs.
//
// Props: { supabase, cu, nf }
//   supabase — shared client (may be a placeholder; we feature-detect the table)
//   cu       — current user { id, name, ... } for created_by / updated_by stamps
//   nf       — toast helper: nf(message, 'success'|'error'|'warn')
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const LS_KEY = 'nsa_sheets_v1';
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

const COLOR_SWATCHES = ['#64748b', '#dc2626', '#ea580c', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#db2777'];

const COL_TYPES = [
  { type: 'text', label: 'Text', icon: 'T' },
  { type: 'longtext', label: 'Long text', icon: '¶' },
  { type: 'number', label: 'Number', icon: '#' },
  { type: 'currency', label: 'Currency', icon: '$' },
  { type: 'date', label: 'Date', icon: '📅' },
  { type: 'checkbox', label: 'Checkbox', icon: '☑' },
  { type: 'select', label: 'Status / dropdown', icon: '▾' },
  { type: 'person', label: 'Person', icon: '@' },
  { type: 'link', label: 'Link', icon: '🔗' },
];
const typeLabel = (t) => (COL_TYPES.find(x => x.type === t) || {}).label || t;

// ── A starter sheet so a brand-new workbook isn't an empty void ──────────────
const starterSheet = (name = 'My First Sheet') => {
  const statusCol = {
    id: uid(), name: 'Status', type: 'select', width: 150,
    options: [
      { id: uid(), label: 'Not started', color: '#64748b' },
      { id: uid(), label: 'In progress', color: '#2563eb' },
      { id: uid(), label: 'Blocked', color: '#dc2626' },
      { id: uid(), label: 'Done', color: '#16a34a' },
    ],
  };
  const columns = [
    { id: uid(), name: 'Task', type: 'text', width: 280 },
    statusCol,
    { id: uid(), name: 'Owner', type: 'person', width: 150 },
    { id: uid(), name: 'Due', type: 'date', width: 130 },
    { id: uid(), name: 'Cost', type: 'currency', width: 120 },
    { id: uid(), name: 'Done', type: 'checkbox', width: 70 },
  ];
  const mkRow = (vals) => ({ id: uid(), cells: columns.reduce((a, c, i) => (a[c.id] = vals[i] ?? '', a), {}) });
  return {
    id: uid(), name, archived: false, columns,
    rows: [
      mkRow(['Kick off project', statusCol.options[1].label, 'Sam', '', 0, false]),
      mkRow(['Draft proposal', statusCol.options[0].label, '', '', 0, false]),
      mkRow(['', '', '', '', 0, false]),
    ],
    updated_at: new Date().toISOString(),
  };
};

// ── Cell display formatting ──────────────────────────────────────────────────
const fmtCurrency = (v) => {
  const n = Number(v);
  if (v === '' || v == null || isNaN(n)) return '';
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const cellText = (col, v) => {
  if (v == null || v === '') return '';
  if (col.type === 'currency') return fmtCurrency(v);
  if (col.type === 'checkbox') return v ? '✓' : '';
  return String(v);
};

// ─────────────────────────────────────────────────────────────────────────────
export default function Sheets({ supabase, cu, nf }) {
  const toast = useCallback((m, t) => { try { nf && nf(m, t); } catch {} }, [nf]);

  const [sheets, setSheets] = useState([]);        // [{...full sheet}]
  const [activeId, setActiveId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cloud, setCloud] = useState(false);       // true once we confirm the `sheets` table exists
  const [saving, setSaving] = useState(false);

  // Grid interaction state
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(null);          // { colId, dir }
  const [sel, setSel] = useState(null);            // { rowId, colId } selected cell
  const [editing, setEditing] = useState(null);    // { rowId, colId } cell in edit mode
  const [editVal, setEditVal] = useState('');
  const [checked, setChecked] = useState(() => new Set()); // selected row ids
  const [colMenu, setColMenu] = useState(null);    // colId whose header menu is open
  const [addColOpen, setAddColOpen] = useState(false);

  const saveTimers = useRef({});
  const fileRef = useRef(null);
  const gridRef = useRef(null);

  const active = useMemo(() => sheets.find(s => s.id === activeId) || null, [sheets, activeId]);

  // ── Persistence layer ──────────────────────────────────────────────────────
  const readLocal = useCallback(() => {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return JSON.parse(raw); } catch {}
    return null;
  }, []);
  const writeLocal = useCallback((list) => {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ sheets: list })); } catch {}
  }, []);

  // Probe the cloud table once; fall back to local on any error.
  useEffect(() => {
    let alive = true;
    (async () => {
      let list = null, isCloud = false;
      if (supabase) {
        try {
          const { data, error } = await supabase.from('sheets').select('*').eq('archived', false).order('updated_at', { ascending: false });
          if (!error && Array.isArray(data)) {
            isCloud = true;
            list = data.map(r => ({ id: r.id, name: r.name, archived: r.archived, updated_at: r.updated_at, ...(r.data || {}) }))
                       .map(s => ({ columns: [], rows: [], ...s }));
          }
        } catch {}
      }
      if (!isCloud) {
        const local = readLocal();
        list = (local && local.sheets) || null;
      }
      if (!list || !list.length) list = [starterSheet()];
      if (!alive) return;
      setCloud(isCloud);
      setSheets(list);
      setActiveId(list[0].id);
      setLoading(false);
      if (!isCloud) writeLocal(list);
    })();
    return () => { alive = false; };
  }, [supabase, readLocal, writeLocal]);

  // Persist a single sheet (debounced per-sheet). Always mirrors to localStorage.
  const persist = useCallback((sheet, nextAll) => {
    writeLocal(nextAll);
    if (!cloud || !supabase) return;
    clearTimeout(saveTimers.current[sheet.id]);
    saveTimers.current[sheet.id] = setTimeout(async () => {
      setSaving(true);
      try {
        const { columns, rows, name, archived, id } = sheet;
        const { error } = await supabase.from('sheets').upsert({
          id, name, archived: !!archived, data: { columns, rows },
          updated_by: cu?.id || null, updated_at: new Date().toISOString(),
        });
        if (error) throw error;
      } catch (e) { toast('Cloud save failed — kept locally', 'warn'); }
      finally { setSaving(false); }
    }, 700);
  }, [cloud, supabase, cu, writeLocal, toast]);

  // Apply a mutation to the active sheet and persist it.
  const mutate = useCallback((fn) => {
    setSheets(prev => {
      const next = prev.map(s => {
        if (s.id !== activeId) return s;
        const updated = { ...fn(s), updated_at: new Date().toISOString() };
        return updated;
      });
      const changed = next.find(s => s.id === activeId);
      if (changed) persist(changed, next);
      return next;
    });
  }, [activeId, persist]);

  // ── Sheet (document) operations ─────────────────────────────────────────────
  const newSheet = () => {
    const s = starterSheet('Untitled Sheet');
    s.columns = [{ id: uid(), name: 'Name', type: 'text', width: 280 }, { id: uid(), name: 'Notes', type: 'longtext', width: 320 }];
    s.rows = [0, 1, 2].map(() => ({ id: uid(), cells: {} }));
    setSheets(prev => { const next = [s, ...prev]; persist(s, next); return next; });
    setActiveId(s.id);
    toast('New sheet created', 'success');
  };
  const renameSheet = () => {
    const name = window.prompt('Sheet name:', active?.name || '');
    if (name == null) return;
    mutate(s => ({ ...s, name: name.trim() || 'Untitled Sheet' }));
  };
  const deleteSheet = async () => {
    if (!active) return;
    if (!window.confirm(`Delete sheet "${active.name}"? This can't be undone.`)) return;
    const id = active.id;
    setSheets(prev => {
      const next = prev.filter(s => s.id !== id);
      const ensured = next.length ? next : [starterSheet()];
      writeLocal(ensured);
      setActiveId(ensured[0].id);
      return ensured;
    });
    if (cloud && supabase) { try { await supabase.from('sheets').delete().eq('id', id); } catch {} }
    toast('Sheet deleted', 'success');
  };
  const duplicateSheet = () => {
    if (!active) return;
    const copy = { ...active, id: uid(), name: active.name + ' (copy)',
      columns: active.columns.map(c => ({ ...c })),
      rows: active.rows.map(r => ({ id: uid(), cells: { ...r.cells } })) };
    setSheets(prev => { const next = [copy, ...prev]; persist(copy, next); return next; });
    setActiveId(copy.id);
  };

  // ── Row operations ──────────────────────────────────────────────────────────
  const addRow = () => mutate(s => ({ ...s, rows: [...s.rows, { id: uid(), cells: {} }] }));
  const deleteRow = (rowId) => mutate(s => ({ ...s, rows: s.rows.filter(r => r.id !== rowId) }));
  const deleteChecked = () => {
    if (!checked.size) return;
    if (!window.confirm(`Delete ${checked.size} row${checked.size === 1 ? '' : 's'}?`)) return;
    mutate(s => ({ ...s, rows: s.rows.filter(r => !checked.has(r.id)) }));
    setChecked(new Set());
  };
  const setCell = (rowId, colId, value) =>
    mutate(s => ({ ...s, rows: s.rows.map(r => r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r) }));

  // ── Column operations ───────────────────────────────────────────────────────
  const addColumn = (type) => {
    const col = { id: uid(), name: typeLabel(type), type, width: type === 'longtext' ? 320 : 160 };
    if (type === 'select') col.options = [{ id: uid(), label: 'Option 1', color: COLOR_SWATCHES[4] }];
    mutate(s => ({ ...s, columns: [...s.columns, col] }));
    setAddColOpen(false);
  };
  const renameColumn = (colId) => {
    const col = active.columns.find(c => c.id === colId);
    const name = window.prompt('Column name:', col?.name || '');
    if (name == null) return;
    mutate(s => ({ ...s, columns: s.columns.map(c => c.id === colId ? { ...c, name: name.trim() || c.name } : c) }));
  };
  const changeColType = (colId, type) => {
    mutate(s => ({ ...s, columns: s.columns.map(c => {
      if (c.id !== colId) return c;
      const nc = { ...c, type };
      if (type === 'select' && !nc.options) nc.options = [{ id: uid(), label: 'Option 1', color: COLOR_SWATCHES[4] }];
      return nc;
    }) }));
    setColMenu(null);
  };
  const deleteColumn = (colId) => {
    if (active.columns.length <= 1) { toast('A sheet needs at least one column', 'warn'); return; }
    if (!window.confirm('Delete this column and its data?')) return;
    mutate(s => ({ ...s, columns: s.columns.filter(c => c.id !== colId),
      rows: s.rows.map(r => { const cells = { ...r.cells }; delete cells[colId]; return { ...r, cells }; }) }));
    setColMenu(null);
  };
  const moveColumn = (colId, dir) => {
    mutate(s => {
      const i = s.columns.findIndex(c => c.id === colId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.columns.length) return s;
      const cols = s.columns.slice();
      [cols[i], cols[j]] = [cols[j], cols[i]];
      return { ...s, columns: cols };
    });
  };
  const setColWidth = (colId, width) =>
    mutate(s => ({ ...s, columns: s.columns.map(c => c.id === colId ? { ...c, width: Math.max(60, width) } : c) }));

  // Select-column option editing
  const updateOptions = (colId, options) =>
    mutate(s => ({ ...s, columns: s.columns.map(c => c.id === colId ? { ...c, options } : c) }));

  // ── Sorting + filtering (view only; underlying order preserved) ─────────────
  const viewRows = useMemo(() => {
    if (!active) return [];
    let rows = active.rows;
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter(r => active.columns.some(c => cellText(c, r.cells[c.id]).toLowerCase().includes(q)));
    if (sort) {
      const col = active.columns.find(c => c.id === sort.colId);
      if (col) {
        const dir = sort.dir === 'desc' ? -1 : 1;
        rows = rows.slice().sort((a, b) => {
          let av = a.cells[col.id], bv = b.cells[col.id];
          if (col.type === 'number' || col.type === 'currency') { av = Number(av) || 0; bv = Number(bv) || 0; return (av - bv) * dir; }
          if (col.type === 'checkbox') { return ((av ? 1 : 0) - (bv ? 1 : 0)) * dir; }
          return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true }) * dir;
        });
      }
    }
    return rows;
  }, [active, search, sort]);

  // Column summary (sum for numeric/currency, checked-count for checkbox)
  const colSummary = (col) => {
    if (col.type === 'number' || col.type === 'currency') {
      const sum = viewRows.reduce((a, r) => a + (Number(r.cells[col.id]) || 0), 0);
      return col.type === 'currency' ? fmtCurrency(sum) : (Math.round(sum * 100) / 100).toLocaleString();
    }
    if (col.type === 'checkbox') {
      const n = viewRows.filter(r => r.cells[col.id]).length;
      return `${n}/${viewRows.length}`;
    }
    return '';
  };

  // ── Editing helpers ─────────────────────────────────────────────────────────
  const beginEdit = (rowId, colId, initial) => {
    const col = active.columns.find(c => c.id === colId);
    if (!col) return;
    if (col.type === 'checkbox') { setCell(rowId, colId, !active.rows.find(r => r.id === rowId)?.cells[colId]); return; }
    const cur = active.rows.find(r => r.id === rowId)?.cells[colId];
    setEditing({ rowId, colId });
    // For dropdowns, a typed character shouldn't seed the value (it wouldn't match an option).
    setEditVal(col.type === 'select' ? (cur ?? '') : (initial != null ? initial : (cur ?? '')));
  };
  const commitEdit = (move) => {
    if (!editing) return;
    const { rowId, colId } = editing;
    const col = active.columns.find(c => c.id === colId);
    let val = editVal;
    if (col && (col.type === 'number' || col.type === 'currency')) val = val === '' ? '' : Number(val);
    setCell(rowId, colId, val);
    setEditing(null);
    if (move === 'down') {
      const idx = viewRows.findIndex(r => r.id === rowId);
      const nextRow = viewRows[idx + 1];
      if (nextRow) setSel({ rowId: nextRow.id, colId });
    }
  };

  // Keyboard navigation on the grid
  const onGridKey = (e) => {
    if (editing) return; // inputs handle their own keys
    if (!sel || !active) return;
    const cols = active.columns;
    const ci = cols.findIndex(c => c.id === sel.colId);
    const ri = viewRows.findIndex(r => r.id === sel.rowId);
    if (ri < 0 || ci < 0) return;
    const go = (r, c) => { const row = viewRows[r], col = cols[c]; if (row && col) { e.preventDefault(); setSel({ rowId: row.id, colId: col.id }); } };
    if (e.key === 'ArrowDown') go(ri + 1, ci);
    else if (e.key === 'ArrowUp') go(ri - 1, ci);
    else if (e.key === 'ArrowRight' || e.key === 'Tab') go(ri, Math.min(ci + 1, cols.length - 1));
    else if (e.key === 'ArrowLeft') go(ri, ci - 1);
    else if (e.key === 'Enter') { e.preventDefault(); beginEdit(sel.rowId, sel.colId); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); setCell(sel.rowId, sel.colId, cols[ci].type === 'checkbox' ? false : ''); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) { beginEdit(sel.rowId, sel.colId, e.key); }
  };

  // ── CSV import / export ─────────────────────────────────────────────────────
  const exportCsv = () => {
    if (!active) return;
    const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const header = active.columns.map(c => esc(c.name)).join(',');
    const body = viewRows.map(r => active.columns.map(c => esc(cellText(c, r.cells[c.id]))).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (active.name || 'sheet').replace(/[^\w.-]+/g, '_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const importCsv = async (file) => {
    if (!file) return;
    let Papa;
    try { Papa = (await import('papaparse')).default; } catch { toast('CSV parser unavailable', 'error'); return; }
    Papa.parse(file, {
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data;
        if (!rows.length) { toast('Empty file', 'warn'); return; }
        const headers = rows[0].map(h => String(h || '').trim() || 'Column');
        const columns = headers.map((h, i) => ({ id: uid(), name: h, type: 'text', width: 180 }));
        const dataRows = rows.slice(1).map(cells => ({
          id: uid(), cells: columns.reduce((a, c, i) => (a[c.id] = cells[i] ?? '', a), {}),
        }));
        const s = { id: uid(), name: file.name.replace(/\.csv$/i, '') || 'Imported', archived: false, columns, rows: dataRows, updated_at: new Date().toISOString() };
        setSheets(prev => { const next = [s, ...prev]; persist(s, next); return next; });
        setActiveId(s.id);
        toast(`Imported ${dataRows.length} rows`, 'success');
      },
      error: () => toast('Could not parse CSV', 'error'),
    });
  };

  // close popovers on outside click
  useEffect(() => {
    const h = () => { setColMenu(null); setAddColOpen(false); };
    if (colMenu || addColOpen) { document.addEventListener('click', h); return () => document.removeEventListener('click', h); }
  }, [colMenu, addColOpen]);

  if (loading) return <div style={{ padding: 40, color: '#64748b' }}>Loading sheets…</div>;

  // ── Render ──────────────────────────────────────────────────────────────────
  const allChecked = viewRows.length > 0 && viewRows.every(r => checked.has(r.id));

  return (
    <div ref={gridRef} style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 170px)', outline: 'none' }} onKeyDown={onGridKey} tabIndex={-1}>
      {/* Header / toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 20, color: '#1e293b', cursor: 'pointer' }} onClick={renameSheet} title="Click to rename">
          {active?.name || 'Sheets'} <span style={{ fontSize: 12, color: '#94a3b8' }}>✎</span>
        </h2>
        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999,
          background: cloud ? '#dcfce7' : '#fef9c3', color: cloud ? '#166534' : '#854d0e' }}>
          {cloud ? (saving ? '☁ Saving…' : '☁ Synced') : '● Local only'}
        </span>
        <div style={{ flex: 1 }} />
        <input className="form-input" placeholder="🔎 Search…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ width: 200, height: 32 }} />
        {checked.size > 0 &&
          <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={deleteChecked}>🗑 {checked.size}</button>}
        <button className="btn btn-sm btn-secondary" onClick={exportCsv}>⬇ CSV</button>
        <button className="btn btn-sm btn-secondary" onClick={() => fileRef.current?.click()}>⬆ Import</button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
          onChange={e => { importCsv(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {!cloud &&
        <div style={{ fontSize: 12, color: '#854d0e', background: '#fef9c3', border: '1px solid #fde68a',
          borderRadius: 8, padding: '6px 12px', marginBottom: 10 }}>
          Working in local-only mode. Apply <code>supabase_migration_062_sheets.sql</code> to sync sheets to the cloud and share them across the team.
        </div>}

      {/* Grid */}
      <div className="card" style={{ flex: 1, overflow: 'auto', padding: 0 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: 'max-content', minWidth: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...thStyle, width: 40, minWidth: 40, position: 'sticky', left: 0, zIndex: 3 }}>
                <input type="checkbox" checked={allChecked}
                  onChange={e => setChecked(e.target.checked ? new Set(viewRows.map(r => r.id)) : new Set())} />
              </th>
              {active.columns.map((col, idx) => (
                <th key={col.id} style={{ ...thStyle, width: col.width, minWidth: col.width, position: 'relative' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ cursor: 'pointer', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      onClick={() => setSort(s => s && s.colId === col.id ? (s.dir === 'asc' ? { colId: col.id, dir: 'desc' } : null) : { colId: col.id, dir: 'asc' })}
                      title="Click to sort">
                      {col.name}{sort && sort.colId === col.id ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </span>
                    <span style={{ cursor: 'pointer', color: '#94a3b8', padding: '0 2px' }}
                      onClick={(e) => { e.stopPropagation(); setColMenu(colMenu === col.id ? null : col.id); }}>⋯</span>
                  </div>
                  {/* resize handle */}
                  <span onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    const startX = e.clientX, startW = col.width || 160;
                    const mv = (ev) => setColWidth(col.id, startW + (ev.clientX - startX));
                    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
                    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
                  }} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize' }} />
                  {colMenu === col.id &&
                    <ColumnMenu col={col} onRename={() => renameColumn(col.id)} onType={(t) => changeColType(col.id, t)}
                      onDelete={() => deleteColumn(col.id)} onMove={(d) => { moveColumn(col.id, d); }}
                      onOptions={(opts) => updateOptions(col.id, opts)} canLeft={idx > 0} canRight={idx < active.columns.length - 1} />}
                </th>
              ))}
              <th style={{ ...thStyle, width: 44, minWidth: 44 }}>
                <span style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700, position: 'relative' }}
                  onClick={(e) => { e.stopPropagation(); setAddColOpen(o => !o); }} title="Add column">＋
                  {addColOpen &&
                    <div style={menuStyle} onClick={e => e.stopPropagation()}>
                      <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 10px' }}>NEW COLUMN</div>
                      {COL_TYPES.map(t =>
                        <div key={t.type} style={menuItem} onClick={() => addColumn(t.type)}>
                          <span style={{ width: 18, display: 'inline-block', color: '#64748b' }}>{t.icon}</span>{t.label}
                        </div>)}
                    </div>}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {viewRows.map((row, ri) => (
              <tr key={row.id} style={{ background: checked.has(row.id) ? '#eff6ff' : 'white' }}>
                <td style={{ ...tdStyle, position: 'sticky', left: 0, zIndex: 1, background: 'inherit', textAlign: 'center', color: '#94a3b8' }}>
                  <span className="row-num" style={{ fontSize: 11 }}>{ri + 1}</span>
                  <input type="checkbox" style={{ marginLeft: 4 }} checked={checked.has(row.id)}
                    onChange={e => setChecked(prev => { const n = new Set(prev); e.target.checked ? n.add(row.id) : n.delete(row.id); return n; })} />
                </td>
                {active.columns.map(col => {
                  const isSel = sel && sel.rowId === row.id && sel.colId === col.id;
                  const isEdit = editing && editing.rowId === row.id && editing.colId === col.id;
                  return (
                    <td key={col.id}
                      onClick={() => { if (!isEdit) { setSel({ rowId: row.id, colId: col.id }); gridRef.current?.focus(); } }}
                      onDoubleClick={() => beginEdit(row.id, col.id)}
                      style={{ ...tdStyle, width: col.width, minWidth: col.width, maxWidth: col.width,
                        outline: isSel ? '2px solid #2563eb' : 'none', outlineOffset: -2, cursor: 'cell',
                        textAlign: col.type === 'number' || col.type === 'currency' ? 'right' : (col.type === 'checkbox' ? 'center' : 'left') }}>
                      {isEdit
                        ? <CellEditor col={col} value={editVal} setValue={setEditVal}
                            commit={commitEdit} cancel={() => setEditing(null)} />
                        : <CellView col={col} value={row.cells[col.id]}
                            onToggle={() => beginEdit(row.id, col.id)}
                            onPick={(v) => setCell(row.id, col.id, v)} />}
                    </td>
                  );
                })}
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <span style={{ cursor: 'pointer', color: '#cbd5e1' }} title="Delete row"
                    onClick={() => deleteRow(row.id)}>✕</span>
                </td>
              </tr>
            ))}
            {/* summary footer */}
            <tr>
              <td style={{ ...tdStyle, position: 'sticky', left: 0, background: '#f8fafc' }} />
              {active.columns.map(col =>
                <td key={col.id} style={{ ...tdStyle, background: '#f8fafc', fontWeight: 700, color: '#475569',
                  textAlign: col.type === 'number' || col.type === 'currency' ? 'right' : 'left' }}>{colSummary(col)}</td>)}
              <td style={{ ...tdStyle, background: '#f8fafc' }} />
            </tr>
          </tbody>
        </table>
        <div style={{ padding: 8 }}>
          <button className="btn btn-sm btn-secondary" onClick={addRow}>＋ Add row</button>
          <span style={{ marginLeft: 12, fontSize: 12, color: '#94a3b8' }}>
            {viewRows.length} row{viewRows.length === 1 ? '' : 's'}{search ? ` (filtered from ${active.rows.length})` : ''}
          </span>
        </div>
      </div>

      {/* Sheet tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {sheets.map(s =>
          <button key={s.id} onClick={() => { setActiveId(s.id); setSel(null); setEditing(null); setSearch(''); setSort(null); setChecked(new Set()); }}
            style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 700,
              border: '1px solid ' + (s.id === activeId ? '#1e3a8a' : '#e2e8f0'),
              background: s.id === activeId ? '#1e3a8a' : 'white', color: s.id === activeId ? 'white' : '#475569' }}>
            {s.name}
          </button>)}
        <button onClick={newSheet} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 6, border: '1px dashed #cbd5e1',
          background: 'white', color: '#2563eb', cursor: 'pointer', fontWeight: 700 }}>＋ Sheet</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-sm btn-secondary" onClick={duplicateSheet}>Duplicate</button>
        <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={deleteSheet}>Delete sheet</button>
      </div>
    </div>
  );
}

// ── Cell display (non-editing) ───────────────────────────────────────────────
function CellView({ col, value, onToggle, onPick }) {
  if (col.type === 'checkbox')
    return <input type="checkbox" checked={!!value} onChange={onToggle} onClick={e => e.stopPropagation()} />;
  if (col.type === 'select') {
    const opt = (col.options || []).find(o => o.label === value);
    if (!value) return <span style={{ color: '#cbd5e1' }}>—</span>;
    return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700,
      color: 'white', background: opt?.color || '#64748b' }}>{value}</span>;
  }
  if (col.type === 'link' && value)
    return <a href={/^https?:\/\//.test(value) ? value : 'https://' + value} target="_blank" rel="noreferrer"
      onClick={e => e.stopPropagation()} style={{ color: '#2563eb' }}>{value}</a>;
  if (col.type === 'person' && value)
    return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 20, height: 20, borderRadius: 999, background: '#1e3a8a', color: 'white', fontSize: 10,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
        {String(value).trim().charAt(0).toUpperCase()}</span>{value}</span>;
  const text = cellText(col, value);
  return <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: col.type === 'longtext' ? 'normal' : 'nowrap' }}>
    {text || <span style={{ color: '#e2e8f0' }}>&nbsp;</span>}</span>;
}

// ── Cell editor (active edit) ────────────────────────────────────────────────
function CellEditor({ col, value, setValue, commit, cancel }) {
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); if (ref.current?.select) try { ref.current.select(); } catch {} }, []);
  const key = (e) => {
    if (e.key === 'Enter' && col.type !== 'longtext') { e.preventDefault(); commit('down'); }
    else if (e.key === 'Enter' && e.shiftKey) { /* newline in longtext */ }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Tab') { e.preventDefault(); commit(); }
  };
  const common = { ref, value: value ?? '', onChange: e => setValue(e.target.value), onBlur: () => commit(), onKeyDown: key,
    style: { width: '100%', border: 'none', outline: 'none', font: 'inherit', background: 'transparent', padding: 0 } };
  if (col.type === 'select')
    return <select {...common} onChange={e => { setValue(e.target.value); }} >
      <option value="">—</option>
      {(col.options || []).map(o => <option key={o.id} value={o.label}>{o.label}</option>)}
    </select>;
  if (col.type === 'longtext')
    return <textarea {...common} rows={3} style={{ ...common.style, resize: 'vertical' }} />;
  if (col.type === 'date') return <input {...common} type="date" />;
  if (col.type === 'number' || col.type === 'currency') return <input {...common} type="number" step="any" />;
  return <input {...common} type="text" />;
}

// ── Column header menu ───────────────────────────────────────────────────────
function ColumnMenu({ col, onRename, onType, onDelete, onMove, onOptions, canLeft, canRight }) {
  const [tab, setTab] = useState('main');
  return (
    <div style={{ ...menuStyle, right: 0, left: 'auto', minWidth: 200 }} onClick={e => e.stopPropagation()}>
      {tab === 'main' && <>
        <div style={menuItem} onClick={onRename}>✎ Rename</div>
        <div style={menuItem} onClick={() => setTab('type')}>⇄ Type: <b style={{ marginLeft: 4 }}>{typeLabel(col.type)}</b></div>
        {col.type === 'select' && <div style={menuItem} onClick={() => setTab('opts')}>🎨 Edit options</div>}
        <div style={{ ...menuItem, opacity: canLeft ? 1 : 0.4, pointerEvents: canLeft ? 'auto' : 'none' }} onClick={() => onMove(-1)}>← Move left</div>
        <div style={{ ...menuItem, opacity: canRight ? 1 : 0.4, pointerEvents: canRight ? 'auto' : 'none' }} onClick={() => onMove(1)}>→ Move right</div>
        <div style={{ ...menuItem, color: '#dc2626' }} onClick={onDelete}>🗑 Delete column</div>
      </>}
      {tab === 'type' && <>
        <div style={{ ...menuItem, color: '#64748b' }} onClick={() => setTab('main')}>← Back</div>
        {COL_TYPES.map(t => <div key={t.type} style={{ ...menuItem, fontWeight: t.type === col.type ? 700 : 400 }}
          onClick={() => onType(t.type)}><span style={{ width: 18, display: 'inline-block', color: '#64748b' }}>{t.icon}</span>{t.label}</div>)}
      </>}
      {tab === 'opts' && <OptionEditor col={col} onOptions={onOptions} back={() => setTab('main')} />}
    </div>
  );
}

function OptionEditor({ col, onOptions, back }) {
  const opts = col.options || [];
  const set = (next) => onOptions(next);
  return (
    <div style={{ padding: 6 }}>
      <div style={{ ...menuItem, color: '#64748b' }} onClick={back}>← Back</div>
      {opts.map((o, i) =>
        <div key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 6px' }}>
          <select value={o.color} onChange={e => set(opts.map(x => x.id === o.id ? { ...x, color: e.target.value } : x))}
            style={{ width: 26, height: 22, padding: 0, background: o.color, border: 'none', borderRadius: 4 }}>
            {COLOR_SWATCHES.map(c => <option key={c} value={c} style={{ background: c }}>{c}</option>)}
          </select>
          <input value={o.label} onChange={e => set(opts.map(x => x.id === o.id ? { ...x, label: e.target.value } : x))}
            className="form-input" style={{ height: 24, fontSize: 12, flex: 1 }} />
          <span style={{ cursor: 'pointer', color: '#dc2626' }} onClick={() => set(opts.filter(x => x.id !== o.id))}>✕</span>
        </div>)}
      <div style={{ ...menuItem, color: '#2563eb' }}
        onClick={() => set([...opts, { id: uid(), label: 'New option', color: COLOR_SWATCHES[opts.length % COLOR_SWATCHES.length] }])}>＋ Add option</div>
    </div>
  );
}

// ── Inline style constants ───────────────────────────────────────────────────
const thStyle = { position: 'sticky', top: 0, zIndex: 2, background: '#f1f5f9', borderBottom: '1px solid #e2e8f0',
  borderRight: '1px solid #e2e8f0', padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' };
const tdStyle = { borderBottom: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9', padding: '5px 8px',
  height: 30, overflow: 'hidden', verticalAlign: 'middle' };
const menuStyle = { position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'white', border: '1px solid #e2e8f0',
  borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 180, padding: 4, textAlign: 'left', fontWeight: 400, color: '#1e293b' };
const menuItem = { padding: '6px 10px', fontSize: 13, cursor: 'pointer', borderRadius: 6, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 };
