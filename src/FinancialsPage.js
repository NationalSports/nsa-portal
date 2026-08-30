// ═══════════════════════════════════════════════════════════════════
// FinancialsPage — admin-only financial suite: digest, matched P&L,
// receivables, and forecast. All computation lives in lib/financeEngine
// (pure, unit-tested); this file is presentation.
//
// Revenue basis notes (mirrors the sales dashboard):
//   "Billed" = NetSuite invoice history + portal invoices, deduped by
//   document id, gross unless marked net-of-tax. The matched P&L is
//   portal-only: invoice revenue net of tax against pro-rata order cost.
// ═══════════════════════════════════════════════════════════════════
import React, { useMemo, useState } from 'react';
import { useAppData } from './AppContext';
import { supabase } from './lib/supabase';
import { calcOrderMargin } from './pricing';
import { calcSOStatus, isCommissionRep } from './businessLogic';
import {
  billedByMonth, matchedPL, backlogSchedule,
  forecastRevenue, cashForecast, insights, monthKey,
  portalStatement, combineStatement, profitByEntity, forecastAccuracy, buildSnapshotRows,
  receivablesDashboard, staleOrdersReport,
} from './lib/financeEngine';
import { LEGACY_STATEMENTS } from './data/legacyStatements';
import ARWorkspace from './ARWorkspace';
// Mounted in `adminReports` mode: the SAME component the Commissions page uses, showing
// only its admin-only report tabs. Reusing it (rather than moving the tabs' code here)
// keeps one copy of the commission math — rep pay and these reports can never disagree.
const CommissionsPage = React.lazy(() => import('./CommissionsPage'));

// ── Portal look (Reports palette) + validated chart palette ─────────
const FD = "'Barlow Condensed','Arial Narrow',sans-serif";
const NAVY = '#192853';
const INK = '#1e293b', INK2 = '#475569', INK3 = '#94a3b8';
const GRID = '#eef1f6', HAIR = '#e2e8f0';
// Categorical order is fixed (never cycled): current-year, last-year, derived/forecast, pending.
const C1 = '#3056c0', C2 = '#dc2626', C3 = '#0d9488', C4 = '#b45309';
const GOOD = '#059669', WARN = '#b45309', CRIT = '#dc2626';

const $0 = (n) => '$' + Math.round(n || 0).toLocaleString();
const $k = (n) => {
  const v = Math.abs(n || 0);
  if (v >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
  return '$' + Math.round(n || 0);
};
const pct1 = (f) => (f * 100).toFixed(1) + '%';
const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monLabel = (key) => { const [y, m] = key.split('-'); return MONTHS_S[+m - 1] + ' ' + y.slice(2); };

// ── Tiny chart kit (dataviz specs: thin marks, 4px rounded data-end,
//    2px surface gaps, hairline grid, hover tooltip, legend for ≥2 series) ──
function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 4, 5, 7.5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function Tooltip({ tip }) {
  if (!tip) return null;
  return (
    <div style={{
      position: 'absolute', left: Math.max(4, tip.x - 70), top: tip.y - (34 + tip.rows.length * 17),
      background: '#fff', border: '1px solid ' + HAIR, borderRadius: 8, padding: '7px 10px',
      boxShadow: '0 4px 14px rgba(15,23,42,.12)', pointerEvents: 'none', zIndex: 5, minWidth: 130,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: INK2, textTransform: 'uppercase', letterSpacing: 0.4 }}>{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
          <span style={{ width: 10, height: 0, borderTop: '3px solid ' + r.color, borderRadius: 2 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
          <span style={{ fontSize: 11, color: INK2 }}>{r.label}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }) {
  if (items.length < 2) return null;
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6 }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: INK2 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: it.color, opacity: it.wash ? 0.25 : 1, border: it.wash ? '1px solid ' + it.color : 'none' }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// Grouped/stacked monthly bars. series: [{label,color,get(row)->number,stack?}]
// monthFmt lets the same chart label non-month categories (customer / rep names).
function MonthBars({ rows, series, height = 170, labelEvery = 1, valueFmt = $k, monthFmt = monLabel }) {
  const [tip, setTip] = useState(null);
  const W = Math.max(320, rows.length * 44), H = height, padB = 20, padT = 8;
  const plotH = H - padB - padT;
  const stacked = series.some((s) => s.stack);
  const maxV = niceMax(Math.max(...rows.map((r) => stacked
    ? series.reduce((a, s) => a + Math.max(0, s.get(r)), 0)
    : Math.max(...series.map((s) => Math.max(0, s.get(r))))), 1));
  const y = (v) => padT + plotH * (1 - Math.max(0, v) / maxV);
  const band = W / rows.length;
  const gW = stacked ? Math.min(24, band * 0.55) : Math.min(24, (band * 0.7) / series.length - 2);
  const ticks = [0, 0.5, 1].map((f) => maxV * f);
  return (
    <div style={{ position: 'relative', overflowX: 'auto' }}>
      <svg width={W} height={H} style={{ display: 'block' }} role="img">
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={0} x2={W} y1={y(t)} y2={y(t)} stroke={i === 0 ? HAIR : GRID} strokeWidth={1} />
            {i > 0 && <text x={2} y={y(t) - 3} fontSize={9} fill={INK3}>{valueFmt(t)}</text>}
          </g>
        ))}
        {rows.map((r, ri) => {
          const cx = ri * band + band / 2;
          let acc = 0;
          return (
            <g key={r.month}
              onMouseMove={(e) => {
                const rect = e.currentTarget.ownerSVGElement.parentNode.getBoundingClientRect();
                setTip({
                  x: e.clientX - rect.left, y: e.clientY - rect.top, title: monthFmt(r.month),
                  rows: series.map((s) => ({ color: s.color, value: valueFmt(s.get(r)), label: s.label })),
                });
              }}
              onMouseLeave={() => setTip(null)}>
              <rect x={ri * band} y={0} width={band} height={H} fill="transparent" />
              {series.map((s, si) => {
                const v = Math.max(0, s.get(r));
                if (stacked) {
                  const y1 = y(acc + v), y0 = y(acc); acc += v;
                  const h = Math.max(0, y0 - y1 - (acc > v ? 2 : 0)); // 2px surface gap between segments
                  return <rect key={si} x={cx - gW / 2} y={y1} width={gW} height={h}
                    rx={si === series.length - 1 ? 4 : 0} fill={s.color} opacity={s.wash ? 0.25 : 1} />;
                }
                const x0 = cx - ((series.length * (gW + 2)) - 2) / 2 + si * (gW + 2);
                return <rect key={si} x={x0} y={y(v)} width={gW} height={Math.max(0, y(0) - y(v))} rx={4} fill={s.color} opacity={s.wash ? 0.35 : 1} />;
              })}
              {ri % labelEvery === 0 && (
                <text x={cx} y={H - 6} fontSize={9.5} fill={INK2} textAnchor="middle">
                  {(() => { const t = monthFmt(r.month); return t.length > 12 ? t.slice(0, 11) + '\u2026' : t; })()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
      <Legend items={series.map((s) => ({ label: s.label, color: s.color, wash: s.wash }))} />
    </div>
  );
}

function Spark({ values, color = C1, width = 110, height = 30 }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values, 1), min = Math.min(...values, 0);
  const x = (i) => (i / (values.length - 1)) * (width - 8) + 4;
  const y = (v) => 3 + (height - 10) * (1 - (v - min) / Math.max(1, max - min));
  const d = values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
  const lx = x(values.length - 1), ly = y(values[values.length - 1]);
  return (
    <svg width={width} height={height} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={4} fill={color} stroke="#fff" strokeWidth={2} />
    </svg>
  );
}

function Tile({ label, value, sub, subColor, spark }) {
  return (
    <div style={{ background: '#fff', border: '1px solid ' + HAIR, borderRadius: 12, padding: '12px 16px', minWidth: 158, flex: '1 1 160px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: INK2 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, justifyContent: 'space-between' }}>
        <div style={{ fontFamily: FD, fontSize: 27, fontWeight: 700, color: NAVY, lineHeight: 1.15 }}>{value}</div>
        {spark}
      </div>
      {sub && <div style={{ fontSize: 11, color: subColor || INK2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const LEVEL_META = {
  good: { color: GOOD, icon: '▲', label: 'Good' },
  info: { color: NAVY, icon: '●', label: 'Note' },
  warn: { color: WARN, icon: '▲', label: 'Watch' },
  critical: { color: CRIT, icon: '■', label: 'Action' },
};

export default function FinancialsPage() {
  const {
    sos, invs, histInvs, cu, cust, REPS,
    msgs = [], setMsgs, assignedTodos = [], setAssignedTodos, nf,
    setESO, setESOC, setPg, setSelC, setInvF,
  } = useAppData();
  const [tab, setTab] = useState('overview');
  const legacyKeys = useMemo(() => Object.keys(LEGACY_STATEMENTS).sort(), []);
  const [stmtKey, setStmtKey] = useState(legacyKeys[legacyKeys.length - 1]);
  const [profitBy, setProfitBy] = useState('customer');
  const [snaps, setSnaps] = useState(null);        // saved forecast snapshots (null = loading)
  const [snapNote, setSnapNote] = useState('');
  const [staleFilter, setStaleFilter] = useState('all');
  const [staleRep, setStaleRep] = useState('all');
  const [staleSearch, setStaleSearch] = useState('');
  const [staleSelectedId, setStaleSelectedId] = useState(null);
  const [staleChat, setStaleChat] = useState('');
  const [staleTaskTitle, setStaleTaskTitle] = useState('');
  const [staleTaskOwner, setStaleTaskOwner] = useState('');
  const [staleTaskDue, setStaleTaskDue] = useState('');
  const [arAccountFilter, setArAccountFilter] = useState('all');
  const isAdmin = cu?.role === 'admin' || cu?.role === 'super_admin';

  const today = useMemo(() => new Date(), []);
  const thisKey = monthKey(today);
  const calcMargin = useMemo(() => {
    const cache = new Map();
    return (o) => {
      let m = cache.get(o.id);
      if (!m) { m = calcOrderMargin(o, sos); cache.set(o.id, m); }
      return m;
    };
  }, [sos]);

  const model = useMemo(() => {
    if (!isAdmin) return null;
    const billed = billedByMonth({ histInvs, invs });
    const pl = matchedPL({ sos, invs, calcMargin });
    const salesReps = (REPS || []).filter(isCommissionRep);
    const ar = receivablesDashboard({ invs, histInvs, sos, customers: cust || [], reps: salesReps, asOf: today });
    const aging = ar.aging;
    const stale = staleOrdersReport({
      sos, invs, histInvs, customers: cust || [], calcMargin, calcStatus: calcSOStatus, asOf: today,
    });
    const backlog = backlogSchedule({ sos, invs, calcMargin, asOf: today });
    const rev = forecastRevenue({ billedHistory: billed, backlog, sos, calcMargin, asOf: today, horizon: 4 });
    const cash = cashForecast({ aging, revForecast: rev, asOf: today });
    const notes = insights({ pl, aging, backlog, billedHistory: billed, asOf: today });
    const legacy = LEGACY_STATEMENTS[stmtKey];
    const stmtPortal = portalStatement({ sos, invs, calcMargin, through: stmtKey });
    const statement = legacy ? combineStatement({ legacy, portal: stmtPortal }) : null;
    const profit = profitByEntity({ sos, invs, calcMargin, customers: cust || [], groupBy: profitBy });
    return { billed, pl, aging, ar, stale, backlog, rev, cash, notes, statement, stmtPortal, legacy, profit };
  }, [isAdmin, histInvs, invs, sos, calcMargin, today, stmtKey, cust, profitBy, REPS]);


  // Forecast snapshots: load the saved history, then record THIS month's forecast
  // once (idempotent upsert on as_of_month+target_month) so the model builds a
  // track record without anyone remembering to press a button. Read-only failure
  // is non-fatal — the tab still renders, just without accuracy history.
  React.useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('finance_snapshots').select('*').order('target_month', { ascending: true });
        if (error) throw error;
        if (cancelled) return;
        setSnaps(data || []);
        const rows = buildSnapshotRows({ revForecast: rev, aging, backlog, pl, asOf: today });
        if (!rows.length) return;
        const { error: upErr } = await supabase
          .from('finance_snapshots').upsert(rows, { onConflict: 'as_of_month,target_month' });
        if (cancelled) return;
        if (upErr) { setSnapNote('Could not save this month\u2019s forecast: ' + upErr.message); return; }
        setSnapNote('This month\u2019s forecast recorded ' + rows[0].as_of_date + ' \u00b7 ' + rows.length + ' months');
        const merged = new Map((data || []).map((r) => [r.as_of_month + '|' + r.target_month, r]));
        for (const r of rows) merged.set(r.as_of_month + '|' + r.target_month, r);
        setSnaps([...merged.values()]);
      } catch (e) {
        if (!cancelled) { setSnaps([]); setSnapNote('Snapshot history unavailable: ' + (e?.message || e)); }
      }
    })();
    return () => { cancelled = true; };
    // Intentionally keyed on isAdmin alone: this records the forecast once per
    // mount. The model values it reads (rev/aging/backlog/pl) are recomputed on
    // every render, so depending on them would re-upsert the same row constantly.
  }, [isAdmin]);

  if (!isAdmin) {
    return <div className="card"><div className="card-body"><h2>Admins only</h2><p>The Financials suite is limited to admin accounts.</p></div></div>;
  }
  if (!model) return null;
  const { billed, pl, aging, ar, stale, backlog, rev, cash, notes, statement, stmtPortal, legacy, profit } = model;

  // ── Derived display data ──────────────────────────────────────────
  const year = today.getFullYear();
  const billedThisYr = billed.filter((r) => r.month.startsWith(String(year)));
  const billedLastYr = billed.filter((r) => r.month.startsWith(String(year - 1)));
  const lyByMon = new Map(billedLastYr.map((r) => [+r.month.split('-')[1], r]));
  const yoyRows = billedThisYr.map((r) => ({
    month: r.month, cur: r.net, ly: lyByMon.get(+r.month.split('-')[1])?.net || 0,
  }));
  const ytdNet = billedThisYr.filter((r) => r.month <= thisKey).reduce((a, r) => a + r.net, 0);
  const ytdLyNet = billedLastYr.filter((r) => +r.month.split('-')[1] <= +thisKey.split('-')[1]).reduce((a, r) => a + r.net, 0);
  const monthRow = billed.find((r) => r.month === thisKey);
  const plYtd = pl.months.filter((r) => r.month.startsWith(String(year)));
  const ytdRev = plYtd.reduce((a, r) => a + r.revenue, 0);
  const ytdGp = plYtd.reduce((a, r) => a + r.gp, 0);
  const actualByMonth = new Map(billed.map((r) => [r.month, r.net]));
  const accuracy = forecastAccuracy({ snapshots: snaps || [], actualByMonth, asOf: today });
  const repName = (id) => (REPS || []).find((r) => r.id === id)?.name || id || '\u2014';
  const custName = (id) => (cust || []).find((c) => c.id === id)?.name || id || '\u2014';
  const staleRows = stale.rows.filter((r) => {
    if (staleFilter !== 'all' && r.category !== staleFilter && r.severity !== staleFilter) return false;
    if (staleRep !== 'all' && r.repId !== staleRep) return false;
    const q = staleSearch.trim().toLowerCase();
    return !q || `${r.id} ${r.customerName} ${r.so?.memo || ''} ${r.reasons.join(' ')}`.toLowerCase().includes(q);
  });
  const arAccountRows = ar.accountRows.filter((r) => {
    if (arAccountFilter === 'past_due') return r.pastDue > 0;
    if (arAccountFilter === '60plus') return r.d60plus > 0;
    if (arAccountFilter === 'missing_billing') return !r.billingEmail;
    return true;
  });
  const repPayById = new Map(ar.repPayRows.map((r) => [r.repId, r]));
  const openSO = (row) => {
    if (!row?.so) return;
    setESO?.(row.so); setESOC?.((cust || []).find((c) => c.id === row.customerId) || null); setPg?.('orders');
  };
  const openAccount = (row) => {
    const c = (cust || []).find((x) => x.id === row?.customerId);
    if (!c) return;
    setSelC?.(c.parent_id ? (cust || []).find((x) => x.id === c.parent_id) || c : c); setPg?.('customers');
  };
  const openAccountInvoices = (row) => {
    setInvF?.((f) => ({ ...f, search: row?.name || '', status: 'open', group: 'list', aging: 'all', rep: 'all' }));
    setPg?.('invoices');
  };
  const staleSelected = staleSelectedId ? stale.rows.find((r) => r.id === staleSelectedId) || null : null;
  const staleMessages = staleSelected ? msgs.filter((m) => (m.entity_type || 'so') === 'so' && (m.entity_id === staleSelected.id || m.so_id === staleSelected.id)).sort((a, b) => new Date(b.ts) - new Date(a.ts)) : [];
  const staleTasks = staleSelected ? assignedTodos.filter((t) => t.so_id === staleSelected.id).sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))) : [];
  const openStaleWorkspace = (row) => {
    setStaleSelectedId(row.id); setStaleChat(''); setStaleTaskTitle(''); setStaleTaskOwner(row.repId || ''); setStaleTaskDue('');
    if (setMsgs && cu?.id) setMsgs((prev) => prev.map((m) => ((m.entity_type || 'so') === 'so' && (m.entity_id === row.id || m.so_id === row.id) && !(m.read_by || []).includes(cu.id)) ? { ...m, read_by: [...(m.read_by || []), cu.id] } : m));
  };
  const postStaleChat = () => {
    const text = staleChat.trim(); if (!text || !staleSelected) return;
    const tagged = [staleSelected.repId].filter((id) => id && id !== cu?.id);
    const msg = { id: 'm' + Date.now(), so_id: staleSelected.id, author_id: cu?.id, text, ts: new Date().toLocaleString(), read_by: [cu?.id].filter(Boolean), dept: 'accounting', tagged_members: tagged, entity_type: 'so', entity_id: staleSelected.id };
    setMsgs?.((prev) => [...prev, msg]); setStaleChat(''); nf?.('Message posted and the assigned rep was notified.', 'success');
  };
  const addStaleTask = () => {
    if (!staleTaskTitle.trim() || !staleTaskOwner || !staleSelected) { nf?.('Add a task and choose an owner.', 'error'); return; }
    const now = new Date().toISOString();
    const todo = { id: 'todo-stale-' + Date.now(), title: staleTaskTitle.trim(), description: 'Stale-order follow-up for ' + staleSelected.id + ' · ' + staleSelected.customerName, created_by: cu?.id, assigned_to: staleTaskOwner, so_id: staleSelected.id, customer_id: staleSelected.customerId || null, priority: staleSelected.severity === 'critical' ? 2 : 1, status: 'open', due_date: staleTaskDue || null, created_at: now, updated_at: now, comments: [] };
    setAssignedTodos?.((prev) => [todo, ...prev]); setStaleTaskTitle(''); setStaleTaskDue(''); nf?.('Stale-order action item assigned.', 'success');
  };

  const tabs = [
    ['overview', 'Overview'], ['pl', 'P&L'], ['statement', 'Statement'],
    ['profit', 'Profitability'], ['stale', 'Stale Orders'], ['ar', 'Receivables'], ['forecast', 'Forecast'],
    ['comm', 'Commission Reports'],
  ];
  const S = { h2: { fontFamily: FD, fontSize: 17, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: NAVY, margin: '0 0 8px' } };
  const card = { background: '#fff', border: '1px solid ' + HAIR, borderRadius: 12, padding: 16 };
  const th = { fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: INK2, textAlign: 'right', padding: '6px 8px', borderBottom: '1px solid ' + HAIR };
  const td = { fontSize: 12.5, color: INK, textAlign: 'right', padding: '5px 8px', borderBottom: '1px solid ' + GRID, fontVariantNumeric: 'tabular-nums' };
  const tdL = { ...td, textAlign: 'left', fontVariantNumeric: 'normal' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header + tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: FD, fontSize: 26, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: NAVY, margin: 0 }}>Financials</h1>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: '#f1f5f9', borderRadius: 9, padding: 3 }}>
          {tabs.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              border: 'none', cursor: 'pointer', borderRadius: 7, padding: '5px 13px',
              fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
              background: tab === id ? NAVY : 'transparent', color: tab === id ? '#fff' : INK2,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: INK3 }}>
          Billed = NetSuite history + portal, net of tax · Matched P&L = portal revenue vs pro-rata order cost
        </div>
      </div>

      {/* KPI tiles (always visible) */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Tile label={MONTHS_S[today.getMonth()] + ' billed (net)'} value={$k(monthRow?.net || 0)}
          sub={(() => { const ly = lyByMon.get(today.getMonth() + 1)?.net || 0; if (!ly) return 'no prior-year data'; const d = ((monthRow?.net || 0) / ly - 1) * 100; return (d >= 0 ? '+' : '') + d.toFixed(0) + '% vs last ' + MONTHS_S[today.getMonth()]; })()}
          subColor={(monthRow?.net || 0) >= (lyByMon.get(today.getMonth() + 1)?.net || 0) ? GOOD : CRIT}
          spark={<Spark values={billedThisYr.map((r) => r.net)} color={C1} />} />
        <Tile label="YTD billed (net)" value={$k(ytdNet)}
          sub={ytdLyNet ? ((ytdNet / ytdLyNet - 1) * 100 >= 0 ? '+' : '') + ((ytdNet / ytdLyNet - 1) * 100).toFixed(0) + '% vs LY $' + Math.round(ytdLyNet / 1000) + 'K' : ''}
          subColor={ytdNet >= ytdLyNet ? GOOD : CRIT} />
        <Tile label="Portal GP margin YTD" value={ytdRev > 0 ? pct1(ytdGp / ytdRev) : '—'} sub={$k(ytdGp) + ' gross profit on ' + $k(ytdRev)} />
        <Tile label="Open receivables (assumed)" value={$k(aging.total)}
          sub={$k(aging.buckets.d61_90 + aging.buckets.d90plus) + ' over 60 days'}
          subColor={(aging.buckets.d61_90 + aging.buckets.d90plus) / Math.max(1, aging.total) > 0.1 ? WARN : INK2} />
        <Tile label="Open order book" value={$k(backlog.totalValue)} sub={backlog.orders + ' orders · ' + $k(backlog.totalGp) + ' GP inside'} />
        <Tile label="WIP cost (unbilled work)" value={$k(pl.wip)} sub="cost on orders not yet invoiced" />
      </div>

      {tab === 'overview' && (
        <>
          <div style={card}>
            <h2 style={S.h2}>Billed by month — {year} vs {year - 1} (net of tax)</h2>
            <MonthBars rows={yoyRows} labelEvery={1} series={[
              { label: String(year), color: C1, get: (r) => r.cur },
              { label: String(year - 1), color: C2, wash: true, get: (r) => r.ly },
            ]} />
          </div>
          <div style={card}>
            <h2 style={S.h2}>What needs your attention</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {notes.length === 0 && <div style={{ fontSize: 13, color: INK2 }}>Nothing flagged — all monitors quiet.</div>}
              {notes.map((n, i) => {
                const meta = LEVEL_META[n.level] || LEVEL_META.info;
                return (
                  <div key={i} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                    <span style={{ color: meta.color, fontSize: 10 }} aria-hidden="true">{meta.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: meta.color, textTransform: 'uppercase', minWidth: 44 }}>{meta.label}</span>
                    <span style={{ fontSize: 13, color: INK }}>{n.text}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {tab === 'pl' && (
        <>
          <div style={card}>
            <h2 style={S.h2}>Matched P&L by month — portal business</h2>
            <div style={{ fontSize: 11.5, color: INK2, marginBottom: 8 }}>
              Revenue is invoiced work net of sales tax; cost is each order's garment + decoration cost recognized
              in step with its invoicing. Cost on in-production orders stays in WIP ({$0(pl.wip)} today), so margins
              here are real, not timing noise.
            </div>
            <MonthBars rows={pl.months.slice(-8)} series={[
              { label: 'Revenue', color: C1, get: (r) => r.revenue },
              { label: 'Gross profit', color: C3, get: (r) => r.gp },
            ]} />
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 480 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>Revenue</th>
                  <th style={th}>COGS</th><th style={th}>Gross profit</th><th style={th}>Margin</th>
                </tr></thead>
                <tbody>
                  {pl.months.slice(-8).map((r) => (
                    <tr key={r.month}>
                      <td style={tdL}>{monLabel(r.month)}{r.month === thisKey ? ' (MTD)' : ''}</td>
                      <td style={td}>{$0(r.revenue)}</td><td style={td}>{$0(r.cogs)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{$0(r.gp)}</td><td style={td}>{pct1(r.gpPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={card}>
            <h2 style={S.h2}>Where billed revenue comes from</h2>
            <MonthBars rows={billedThisYr} series={[
              { label: 'NetSuite (legacy)', color: C2, wash: true, stack: true, get: (r) => r.ns - (r.ns / Math.max(1, r.gross)) * r.tax },
              { label: 'Portal', color: C1, stack: true, get: (r) => r.portal - (r.portal / Math.max(1, r.gross)) * r.tax },
            ]} />
            <div style={{ fontSize: 11.5, color: INK2, marginTop: 4 }}>
              The two invoice streams are deduplicated by document number — a NetSuite-billed invoice the portal
              captured never counts twice.
            </div>
          </div>
        </>
      )}

      {tab === 'statement' && statement && (
        <div style={{ ...card, maxWidth: 720 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <h2 style={S.h2}>Income Statement — combined</h2>
            <select value={stmtKey} onChange={(e) => setStmtKey(e.target.value)} style={{ fontSize: 12, padding: '3px 8px', borderRadius: 6, border: '1px solid ' + HAIR, background: '#fff', color: INK2 }}>
              {legacyKeys.map((k) => <option key={k} value={k}>{LEGACY_STATEMENTS[k].periodLabel}</option>)}
            </select>
          </div>
          <div style={{ fontSize: 11.5, color: INK2, marginBottom: 10 }}>
            NetSuite (legacy ledger, imported {legacy.runDate}) plus live portal activity through the period —
            portal revenue net of sales tax, portal cost matched to invoiced work. The two invoice streams share
            no document numbers, so nothing counts twice.
          </div>
          {(() => {
            const rowLine = (r, i) => (
              <tr key={i}>
                <td style={{ ...tdL, paddingLeft: 8 + (r.indent ? 18 : 0) + (r.kind ? 0 : 10), fontWeight: r.kind ? 700 : 400 }}>{r.label}</td>
                <td style={{ ...td, fontWeight: r.kind === 'subtotal' ? 700 : 400 }}>
                  {r.amount == null ? '' : (r.amount < 0 ? '($' + Math.abs(r.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ')' : '$' + r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }))}
                  {r.portalAmount != null && <span style={{ fontSize: 10, color: C3, marginLeft: 6 }}>incl. portal {$k(r.portalAmount)}</span>}
                  {r.portalLine && <span style={{ fontSize: 10, color: C3, marginLeft: 6 }}>live</span>}
                </td>
              </tr>
            );
            const totalRow = (label, v, strong) => (
              <tr>
                <td style={{ ...tdL, fontWeight: 700, borderTop: '2px solid ' + INK, background: strong ? '#ecfdf5' : undefined }}>{label}</td>
                <td style={{ ...td, fontWeight: 700, borderTop: '2px solid ' + INK, background: strong ? '#ecfdf5' : undefined }}>
                  {'$' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
              </tr>
            );
            const header = (label) => (
              <tr><td colSpan={2} style={{ ...tdL, fontWeight: 700 }}>{label}</td></tr>
            );
            return (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
                  <thead><tr>
                    <th style={{ ...th, textAlign: 'left' }}>Financial row</th><th style={th}>Amount</th>
                  </tr></thead>
                  <tbody>
                    {header('Income')}
                    {statement.income.map(rowLine)}
                    {totalRow('Total - Income', statement.totalIncome)}
                    {header('Cost Of Sales')}
                    {statement.cogs.map(rowLine)}
                    {totalRow('Total - Cost Of Sales', statement.totalCogs)}
                    {totalRow('Gross Profit', statement.grossProfit)}
                    {header('Expense')}
                    {statement.expense.map(rowLine)}
                    {totalRow('Total - Expense', statement.totalExpense)}
                    {totalRow('Net Income', statement.netIncome, true)}
                  </tbody>
                </table>
              </div>
            );
          })()}
          <div style={{ fontSize: 11, color: INK3, marginTop: 10 }}>
            Portal side this period: sales {$0(stmtPortal.sales)} + shipping {$0(stmtPortal.shipping)} billed,
            matched cost {$0(stmtPortal.cogs)}. Expenses are the legacy ledger's (payroll, rent, overhead cover the
            whole company). Legacy figures update by importing the latest NetSuite statement — automatic once
            QuickBooks reporting is connected.
          </div>
        </div>
      )}

      {tab === 'profit' && (
        <>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
              <h2 style={S.h2}>Profitability by {profitBy === 'rep' ? 'rep' : 'customer'}</h2>
              <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 8, padding: 3 }}>
                {[['customer', 'By customer'], ['rep', 'By rep']].map(([id, label]) => (
                  <button key={id} onClick={() => setProfitBy(id)} style={{
                    border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 11px',
                    fontSize: 11.5, fontWeight: 700, letterSpacing: 0.3, textTransform: 'uppercase',
                    background: profitBy === id ? NAVY : 'transparent', color: profitBy === id ? '#fff' : INK2,
                  }}>{label}</button>
                ))}
              </div>
            </div>
            <div style={{ fontSize: 11.5, color: INK2, marginBottom: 10 }}>
              Ranked by gross profit earned, not by billings. Revenue is what has actually been invoiced;
              cost is the matching share of each order&rsquo;s cost, so a half-shipped order counts half.
              &ldquo;Open&rdquo; is order value still to invoice &mdash; profit not yet earned.
            </div>
            {profit.length === 0 ? (
              <div style={{ fontSize: 13, color: INK2 }}>No invoiced work yet in this view.</div>
            ) : (
              <>
                <MonthBars
                  rows={profit.slice(0, 12).map((r) => ({ month: r.key, ...r }))}
                  labelEvery={1}
                  series={[
                    { label: 'Revenue', color: C1, get: (r) => r.revenue },
                    { label: 'Gross profit', color: C3, get: (r) => r.gp },
                  ]}
                  monthFmt={(k) => (profitBy === 'rep' ? repName(k) : custName(k))}
                />
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ borderCollapse: 'collapse', minWidth: 660 }}>
                    <thead><tr>
                      <th style={{ ...th, textAlign: 'left' }}>{profitBy === 'rep' ? 'Rep' : 'Customer'}</th>
                      <th style={th}>Revenue</th><th style={th}>COGS</th><th style={th}>Gross profit</th>
                      <th style={th}>Margin</th><th style={th}>Orders</th>
                      <th style={th}>Open to invoice</th><th style={th}>Unpaid</th>
                    </tr></thead>
                    <tbody>
                      {profit.slice(0, 40).map((r) => (
                        <tr key={r.key}>
                          <td style={tdL}>{profitBy === 'rep' ? repName(r.key) : custName(r.key)}</td>
                          <td style={td}>{$0(r.revenue)}</td>
                          <td style={td}>{$0(r.cogs)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{$0(r.gp)}</td>
                          <td style={{ ...td, color: r.gpPct < 0.25 ? CRIT : r.gpPct < 0.35 ? WARN : INK }}>{pct1(r.gpPct)}</td>
                          <td style={td}>{r.orders}</td>
                          <td style={td}>{$0(r.openValue)}</td>
                          <td style={{ ...td, color: r.openBalance > 0 ? WARN : INK3 }}>{$0(r.openBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {profit.length > 40 && (
                  <div style={{ fontSize: 11, color: INK3, marginTop: 6 }}>
                    Showing the top 40 of {profit.length} by gross profit.
                  </div>
                )}
              </>
            )}
          </div>
          <div style={card}>
            <h2 style={S.h2}>Thin-margin work worth a look</h2>
            {(() => {
              const thin = profit.filter((r) => r.revenue > 2000 && r.gpPct < 0.30).slice(0, 10);
              if (!thin.length) return <div style={{ fontSize: 13, color: INK2 }}>Nothing under a 30% margin on meaningful volume &mdash; margins are holding.</div>;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                  {thin.map((r) => (
                    <div key={r.key} style={{ display: 'flex', alignItems: 'baseline', gap: 9, fontSize: 13 }}>
                      <span style={{ color: r.gpPct < 0.2 ? CRIT : WARN, fontSize: 10 }} aria-hidden="true">&#9632;</span>
                      <b style={{ minWidth: 180 }}>{profitBy === 'rep' ? repName(r.key) : custName(r.key)}</b>
                      <span style={{ color: INK2 }}>{pct1(r.gpPct)} margin on {$0(r.revenue)} invoiced ({$0(r.gp)} gross profit)</span>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </>
      )}

      {tab === 'stale' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Potential billing" value={$k(stale.summary.value)} sub={stale.summary.count + ' sales orders need review'} subColor={stale.summary.count ? WARN : GOOD} />
            <Tile label="Ready / production done" value={stale.summary.readyCount} sub="operational completion signal" />
            <Tile label="Likely system mismatch" value={stale.summary.mismatchCount} sub="finished work vs fulfillment data" subColor={stale.summary.mismatchCount ? CRIT : GOOD} />
            <Tile label="Old non-booking" value={stale.summary.oldCount} sub="open more than 30 days" subColor={stale.summary.oldCount ? WARN : GOOD} />
            <Tile label="Critical" value={stale.summary.criticalCount} sub="shipped/complete or 90+ days" subColor={stale.summary.criticalCount ? CRIT : GOOD} />
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 420px' }}>
                <h2 style={S.h2}>Stale sales orders that may be ready to invoice</h2>
                <div style={{ fontSize: 11.5, color: INK2, maxWidth: 850 }}>
                  Includes every uninvoiced order with a completion signal, plus every non-booking order still open after 30 days.
                  Finished jobs are intentionally allowed through even when receiving or shipping data is incomplete &mdash; those rows are marked
                  as a likely system mismatch instead of being hidden.
                </div>
              </div>
              <input value={staleSearch} onChange={(e) => setStaleSearch(e.target.value)} placeholder="Search SO, account, memo…"
                style={{ width: 220, padding: '7px 9px', border: '1px solid ' + HAIR, borderRadius: 7, fontSize: 12 }} />
              <select value={staleRep} onChange={(e) => setStaleRep(e.target.value)} style={{ padding: '7px 9px', border: '1px solid ' + HAIR, borderRadius: 7, fontSize: 12, background: '#fff' }}>
                <option value="all">All reps</option>
                {(REPS || []).filter(isCommissionRep).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 12, marginBottom: 10 }}>
              {[
                ['all', 'All ' + stale.summary.count], ['critical', 'Critical ' + stale.summary.criticalCount],
                ['ready', 'Ready ' + stale.summary.readyCount], ['system_mismatch', 'Mismatch ' + stale.summary.mismatchCount],
                ['old_open', 'Old open ' + stale.summary.oldCount],
              ].map(([id, label]) => <button key={id} onClick={() => setStaleFilter(id)} style={{
                border: '1px solid ' + (staleFilter === id ? NAVY : HAIR), borderRadius: 7, padding: '4px 9px', cursor: 'pointer',
                background: staleFilter === id ? NAVY : '#fff', color: staleFilter === id ? '#fff' : INK2, fontSize: 11.5, fontWeight: 700,
              }}>{label}</button>)}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1120 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Priority / order</th>
                  <th style={{ ...th, textAlign: 'left' }}>Account / rep</th>
                  <th style={th}>Age / expected</th><th style={{ ...th, textAlign: 'left' }}>System state</th>
                  <th style={th}>Fulfillment</th><th style={th}>Invoice coverage</th>
                  <th style={th}>Open to invoice</th><th style={{ ...th, textAlign: 'left' }}>Why it is here</th>
                </tr></thead>
                <tbody>
                  {staleRows.map((r) => {
                    const color = r.severity === 'critical' ? CRIT : r.severity === 'high' ? WARN : C1;
                    return <tr key={r.id} style={{ background: r.category === 'system_mismatch' ? '#fff7ed' : undefined }}>
                      <td style={tdL}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ color, fontSize: 9 }}>&#9632;</span>
                          <button onClick={() => openSO(r)} style={{ border: 0, background: 'none', color: C1, fontWeight: 800, cursor: 'pointer', padding: 0 }}>{r.id}</button>
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color }}>{r.severity}</span>
                        </div>
                        <div title={r.so?.memo || ''} style={{ color: INK3, fontSize: 10.5, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.so?.memo || 'No memo'}</div>
                        <div style={{ display: 'flex', gap: 5, marginTop: 5 }}><button onClick={() => openStaleWorkspace(r)} style={{ border: '1px solid ' + NAVY, borderRadius: 6, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 10, padding: '3px 7px', cursor: 'pointer' }}>Chat / TODO</button><button onClick={() => openSO(r)} style={{ border: '1px solid ' + HAIR, borderRadius: 6, background: '#fff', color: NAVY, fontWeight: 700, fontSize: 10, padding: '3px 7px', cursor: 'pointer' }}>Review SO</button></div>
                      </td>
                      <td style={tdL}>
                        <button onClick={() => openAccount(r)} style={{ border: 0, background: 'none', color: INK, fontWeight: 700, cursor: 'pointer', padding: 0 }}>{r.customerName}</button>
                        <div style={{ color: INK3, fontSize: 10.5 }}>{repName(r.repId)}{r.isBooking ? ' · booking' : ''}</div>
                      </td>
                      <td style={td}>
                        <b style={{ color: r.ageDays > 90 ? CRIT : r.ageDays > 30 ? WARN : INK }}>{r.ageDays}d open</b>
                        <div style={{ color: r.daysLate ? CRIT : INK3, fontSize: 10.5 }}>{r.expected ? (r.daysLate ? r.daysLate + 'd late' : r.expected.toLocaleDateString()) : 'no expected date'}</div>
                      </td>
                      <td style={tdL}>
                        <div style={{ fontWeight: 700 }}>{String(r.status || '').replace(/_/g, ' ')}</div>
                        {r.storedStatus && r.storedStatus !== r.status && <div style={{ fontSize: 10.5, color: INK3 }}>stored: {r.storedStatus}</div>}
                      </td>
                      <td style={td}>
                        <div>{r.fulfilledUnits}/{r.totalUnits} units</div>
                        <div style={{ color: r.mismatch ? CRIT : INK3, fontSize: 10.5 }}>{r.doneJobs}/{r.jobCount} jobs done</div>
                      </td>
                      <td style={td}>
                        <div>{Math.round(r.invoicePct * 100)}%</div>
                        <div style={{ color: INK3, fontSize: 10.5 }}>{r.invoiceCount} invoice{r.invoiceCount === 1 ? '' : 's'} · {$0(r.invoiced)}</div>
                      </td>
                      <td style={{ ...td, fontWeight: 800, color }}>{$0(r.openToInvoice)}</td>
                      <td style={{ ...tdL, minWidth: 280 }}>
                        {r.reasons.map((reason, i) => <div key={i} style={{ fontSize: 11.5, color: i === 0 ? INK : INK2, marginBottom: 2 }}>
                          <span style={{ color: i === 0 ? color : INK3, marginRight: 5 }}>&bull;</span>{reason}
                        </div>)}
                      </td>
                    </tr>;
                  })}
                </tbody>
              </table>
              {!staleRows.length && <div style={{ padding: 24, textAlign: 'center', color: INK2 }}>No stale orders match these filters.</div>}
            </div>
          </div>
          {staleSelected && <div style={{ position: 'fixed', inset: 0, zIndex: 125, background: 'rgba(15,23,42,.38)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) setStaleSelectedId(null); }}><aside style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 'min(720px,96vw)', background: '#fff', boxShadow: '-16px 0 44px rgba(15,23,42,.22)', overflowY: 'auto' }}>
            <div style={{ position: 'sticky', top: 0, zIndex: 2, background: NAVY, color: '#fff', padding: '15px 18px' }}><div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}><div style={{ flex: 1 }}><div style={{ fontFamily: FD, fontSize: 23, fontWeight: 800, textTransform: 'uppercase' }}>{staleSelected.id} · {staleSelected.customerName}</div><div style={{ color: '#cbd5e1', fontSize: 11 }}>{repName(staleSelected.repId)} · {staleSelected.ageDays}d open · {$0(staleSelected.openToInvoice)} potentially billable</div></div><button onClick={() => setStaleSelectedId(null)} aria-label="Close stale-order workspace" style={{ border: 0, borderRadius: 7, width: 30, height: 30, background: 'rgba(255,255,255,.13)', color: '#fff', cursor: 'pointer', fontSize: 18 }}>&times;</button></div></div>
            <div style={{ padding: 16 }}>
              <div style={{ ...card, marginBottom: 12 }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}><div><b style={{ color: NAVY }}>Why this order needs attention</b>{staleSelected.reasons.map((reason, i) => <div key={i} style={{ fontSize: 11.5, color: INK2, marginTop: 5 }}>&bull; {reason}</div>)}</div><button onClick={() => openSO(staleSelected)} style={{ border: '1px solid ' + NAVY, borderRadius: 6, background: '#fff', color: NAVY, fontWeight: 700, fontSize: 11, padding: '5px 9px', cursor: 'pointer', whiteSpace: 'nowrap' }}>Open sales order</button></div></div>
              <div style={{ ...card, marginBottom: 12 }}><h2 style={S.h2}>Chat with the assigned rep</h2><textarea value={staleChat} onChange={(e) => setStaleChat(e.target.value)} placeholder={'Message ' + repName(staleSelected.repId) + ' about ' + staleSelected.id + '…'} rows={4} style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + HAIR, borderRadius: 7, padding: 9, font: 'inherit', fontSize: 12 }} /><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7 }}><span style={{ fontSize: 10.5, color: INK3 }}>Saved in the sales-order conversation and notifies the rep.</span><button onClick={postStaleChat} disabled={!staleChat.trim()} style={{ border: 0, borderRadius: 6, background: NAVY, color: '#fff', fontWeight: 700, fontSize: 11, padding: '6px 10px', cursor: staleChat.trim() ? 'pointer' : 'default', opacity: staleChat.trim() ? 1 : .5 }}>Post message</button></div></div>
              <div style={{ ...card, marginBottom: 12 }}><h2 style={S.h2}>Assign a follow-up</h2><input value={staleTaskTitle} onChange={(e) => setStaleTaskTitle(e.target.value)} placeholder="What needs to happen before invoicing?" style={{ width: '100%', boxSizing: 'border-box', border: '1px solid ' + HAIR, borderRadius: 7, padding: 8, fontSize: 12, marginBottom: 8 }} /><div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px,1fr) minmax(130px,.7fr) auto', gap: 8 }}><select value={staleTaskOwner} onChange={(e) => setStaleTaskOwner(e.target.value)} style={{ border: '1px solid ' + HAIR, borderRadius: 7, padding: 8, background: '#fff' }}><option value="">Assign to…</option>{(REPS || []).filter((r) => r.is_active !== false).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select><input type="date" value={staleTaskDue} onChange={(e) => setStaleTaskDue(e.target.value)} style={{ border: '1px solid ' + HAIR, borderRadius: 7, padding: 8 }} /><button onClick={addStaleTask} style={{ border: 0, borderRadius: 6, background: C1, color: '#fff', fontWeight: 700, fontSize: 11, padding: '6px 10px', cursor: 'pointer' }}>Assign TODO</button></div></div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 12 }}><div style={card}><h2 style={S.h2}>Order conversation</h2>{staleMessages.length ? staleMessages.map((m) => <div key={m.id} style={{ borderLeft: '3px solid ' + C1, padding: '7px 9px', marginBottom: 8, background: '#f8fafc' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 10, color: INK3 }}><b style={{ color: NAVY }}>{repName(m.author_id)}</b><span>{m.ts ? new Date(m.ts).toLocaleDateString() : ''}</span></div><div style={{ fontSize: 11.5, whiteSpace: 'pre-wrap', marginTop: 3 }}>{m.text}</div></div>) : <div style={{ color: INK3, fontSize: 11.5 }}>No conversation yet.</div>}</div><div style={card}><h2 style={S.h2}>Open action items</h2>{staleTasks.length ? staleTasks.map((t) => <div key={t.id} style={{ padding: '7px 0', borderBottom: '1px solid ' + GRID }}><div style={{ fontSize: 11.5, fontWeight: 700, textDecoration: ['complete', 'completed'].includes(t.status) ? 'line-through' : 'none' }}>{t.title}</div><div style={{ color: INK3, fontSize: 10 }}>{repName(t.assigned_to)}{t.due_date ? ' · due ' + new Date(t.due_date + 'T00:00:00').toLocaleDateString() : ''} · {t.status || 'open'}</div></div>) : <div style={{ color: INK3, fontSize: 11.5 }}>No order-linked action items.</div>}</div></div>
            </div>
          </aside></div>}
        </>
      )}

      {tab === 'comm' && (
        <div style={card}>
          <h2 style={S.h2}>Commission reports</h2>
          <div style={{ fontSize: 11.5, color: INK2, marginBottom: 12 }}>
            The admin-only side of Commissions — per-rep monthly statements and the company
            dashboard. Reps still use the Commissions page for their own statements; this is the
            same live report, mounted here so the admin views sit with the rest of the financials.
          </div>
          <React.Suspense fallback={<div style={{ fontSize: 13, color: INK2 }}>Loading commission reports&hellip;</div>}>
            <CommissionsPage adminReports />
          </React.Suspense>
        </div>
      )}

      {tab === 'ar' && <ARWorkspace mode="admin" />}

      {false && tab === 'ar' && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <Tile label="Total open AR" value={$k(ar.kpis.total)} sub={ar.aging.count + ' invoices · portal + NetSuite'} />
            <Tile label="Past due" value={$k(ar.kpis.pastDue)} sub={pct1(ar.kpis.pastDuePct) + ' of open AR'} subColor={ar.kpis.pastDuePct > 0.25 ? CRIT : ar.kpis.pastDuePct > 0.1 ? WARN : INK2} />
            <Tile label="60+ days past due" value={$k(ar.kpis.d60plus)} sub={$k(ar.kpis.d90plus) + ' is 90+'} subColor={ar.kpis.d60plus ? CRIT : GOOD} />
            <Tile label="Due in next 7 days" value={$k(ar.kpis.dueNext7)} sub="collection runway" />
            <Tile label="No billing email" value={$k(ar.kpis.noBillingExposure)} sub="open AR without a billing contact" subColor={ar.kpis.noBillingExposure ? CRIT : GOOD} />
            <Tile label="Top-5 concentration" value={pct1(ar.kpis.top5Pct)} sub="share of AR in five accounts" subColor={ar.kpis.top5Pct > 0.5 ? WARN : INK2} />
          </div>
          <div style={card}>
            <h2 style={S.h2}>Receivables aging by due date — {$0(aging.total)} open across {aging.count} invoices</h2>
            <div style={{ fontSize: 11.5, color: INK2, marginBottom: 10 }}>
              Combines live portal invoices with NetSuite invoice history, deduplicated by invoice number. &ldquo;Current&rdquo; means still inside the account&rsquo;s payment terms;
              the remaining buckets are days past the calculated or stored due date.
            </div>
            {(() => {
              const b = aging.buckets;
              const items = [
                ['Current', b.current, C1], ['1–30 late', b.d1_30, C1],
                ['31–60 late', b.d31_60, C4], ['61–90 late', b.d61_90, WARN], ['90+ late', b.d90plus, CRIT],
              ];
              const max = Math.max(...items.map((i) => i[1]), 1);
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, maxWidth: 560 }}>
                  {items.map(([label, v, color]) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 70, fontSize: 12, fontWeight: 700, color: INK2 }}>{label}</div>
                      <div style={{ flex: 1, background: GRID, borderRadius: 6, height: 16, position: 'relative', overflow: 'hidden' }}>
                        <div style={{ position: 'absolute', inset: '0 auto 0 0', width: Math.max(2, (v / max) * 100) + '%', background: color, borderRadius: 6, opacity: label === 'Current' ? 0.55 : 1 }} />
                      </div>
                      <div style={{ width: 76, textAlign: 'right', fontSize: 12.5, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{$0(v)}</div>
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
          <div style={card}>
            <h2 style={S.h2}>Open account totals by sales rep</h2>
            <div style={{ fontSize: 11.5, color: INK2, marginBottom: 8 }}>
              Every commission-eligible rep is listed, including zero-balance reps. Invoice overrides are honored; otherwise AR follows the account&rsquo;s current primary rep.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 980 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Sales rep</th><th style={th}>Total open</th><th style={th}>Current</th>
                  <th style={th}>Past due</th><th style={th}>60+</th><th style={th}>90+</th><th style={th}>Accounts / invoices</th>
                  <th style={th}>Oldest</th><th style={th}>Avg days to pay</th><th style={{ ...th, textAlign: 'left' }}>Slowest account</th>
                </tr></thead>
                <tbody>
                  {ar.repRows.map((r) => {
                    const pay = repPayById.get(r.repId);
                    return <tr key={r.repId}>
                      <td style={{ ...tdL, fontWeight: 700 }}>{r.name}</td>
                      <td style={{ ...td, fontWeight: 800 }}>{$0(r.total)}</td><td style={td}>{$0(r.current)}</td>
                      <td style={{ ...td, color: r.pastDue ? WARN : INK3 }}>{$0(r.pastDue)}</td>
                      <td style={{ ...td, color: r.d61_90 + r.d90plus ? CRIT : INK3 }}>{$0(r.d61_90 + r.d90plus)}</td>
                      <td style={{ ...td, color: r.d90plus ? CRIT : INK3 }}>{$0(r.d90plus)}</td>
                      <td style={td}>{r.accountCount} / {r.invoiceCount}</td>
                      <td style={{ ...td, color: r.oldestDays > 60 ? CRIT : r.oldestDays > 30 ? WARN : INK }}>{r.oldestDays ? r.oldestDays + 'd' : '—'}</td>
                      <td style={td}>{pay?.avgDays == null ? '—' : Math.round(pay.avgDays) + 'd'}{pay?.count ? <div style={{ color: INK3, fontSize: 10 }}>{pay.count} paid invoice{pay.count === 1 ? '' : 's'}</div> : null}</td>
                      <td style={tdL}>{pay?.worstAccount ? <><b>{pay.worstAccount.name}</b><div style={{ color: INK3, fontSize: 10 }}>{Math.round(pay.worstAccount.avgDays)}d avg · {pay.worstAccount.maxDays}d worst</div></> : '—'}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div style={card}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <h2 style={S.h2}>Collections worklist by account</h2>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {[
                  ['all', 'All'], ['past_due', 'Past due'], ['60plus', '60+ days'], ['missing_billing', 'Missing billing email'],
                ].map(([id, label]) => <button key={id} onClick={() => setArAccountFilter(id)} style={{
                  border: '1px solid ' + (arAccountFilter === id ? NAVY : HAIR), borderRadius: 6, padding: '3px 8px', cursor: 'pointer',
                  background: arAccountFilter === id ? NAVY : '#fff', color: arAccountFilter === id ? '#fff' : INK2, fontSize: 11, fontWeight: 700,
                }}>{label}</button>)}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1050 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Account / rep</th><th style={th}>Open balance</th><th style={th}>Past due</th>
                  <th style={th}>60+</th><th style={th}>90+</th><th style={th}>Oldest</th><th style={th}>Invoices</th>
                  <th style={th}>Avg / worst pay</th><th style={{ ...th, textAlign: 'left' }}>Contact readiness</th><th style={th}>Action</th>
                </tr></thead>
                <tbody>
                  {arAccountRows.slice(0, 80).map((r) => <tr key={r.customerId || r.name}>
                    <td style={tdL}><button onClick={() => openAccount(r)} disabled={!r.customerId} style={{ border: 0, padding: 0, background: 'none', color: r.customerId ? C1 : INK, cursor: r.customerId ? 'pointer' : 'default', fontWeight: 800 }}>{r.name}</button><div style={{ color: INK3, fontSize: 10.5 }}>{repName(r.repId)}</div></td>
                    <td style={{ ...td, fontWeight: 800 }}>{$0(r.total)}</td><td style={{ ...td, color: r.pastDue ? WARN : INK3 }}>{$0(r.pastDue)}</td>
                    <td style={{ ...td, color: r.d60plus ? CRIT : INK3 }}>{$0(r.d60plus)}</td><td style={{ ...td, color: r.d90plus ? CRIT : INK3 }}>{$0(r.d90plus)}</td>
                    <td style={{ ...td, color: r.oldestDays > 60 ? CRIT : r.oldestDays > 30 ? WARN : INK }}>{r.oldestDays ? r.oldestDays + 'd' : '—'}</td>
                    <td style={td}>{r.invoiceCount}</td>
                    <td style={td}>{r.avgPayDays == null ? '—' : Math.round(r.avgPayDays) + 'd avg'}{r.maxPayDays != null && <div style={{ color: INK3, fontSize: 10 }}>{r.maxPayDays}d worst</div>}</td>
                    <td style={tdL}>
                      <div style={{ color: r.billingEmail ? GOOD : CRIT, fontSize: 11 }}>{r.billingEmail ? '✓ Billing: ' + r.billingEmail : '✗ No billing email'}</div>
                      <div style={{ color: r.coachEmail ? GOOD : WARN, fontSize: 11 }}>{r.coachEmail ? '✓ Coach: ' + r.coachEmail : (r.coachUsesStaffEmail ? '✗ Coach email is a rep/staff address' : '✗ No coach email')}</div>
                    </td>
                    <td style={td}><button onClick={() => openAccountInvoices(r)} style={{ border: '1px solid ' + HAIR, borderRadius: 6, background: '#fff', color: NAVY, fontWeight: 700, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}>Open invoices</button></td>
                  </tr>)}
                </tbody>
              </table>
              {arAccountRows.length > 80 && <div style={{ fontSize: 11, color: INK3, marginTop: 6 }}>Showing the first 80 of {arAccountRows.length}; use a filter to narrow the worklist.</div>}
              {!arAccountRows.length && <div style={{ padding: 20, color: INK2, textAlign: 'center' }}>No accounts match this filter.</div>}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.15fr) minmax(0, .85fr)', gap: 14 }}>
            <div style={card}>
              <h2 style={S.h2}>Accounts that need contact or ownership information</h2>
              <div style={{ fontSize: 11.5, color: INK2, marginBottom: 8 }}>
                Audits every active account, not only accounts with open invoices. A coach address must be a valid non-staff email; billing contacts inherited from a parent account count.
              </div>
              <div style={{ maxHeight: 430, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 620 }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Account / rep</th><th style={th}>Open AR</th><th style={{ ...th, textAlign: 'left' }}>Missing information</th><th style={th}>Action</th></tr></thead>
                  <tbody>{ar.accountsNeedingInfo.slice(0, 100).map((r) => <tr key={r.customerId}>
                    <td style={tdL}><b>{r.name}</b><div style={{ color: INK3, fontSize: 10.5 }}>{repName(r.repId)}</div></td>
                    <td style={{ ...td, color: r.exposure ? CRIT : INK3, fontWeight: r.exposure ? 800 : 400 }}>{$0(r.exposure)}</td>
                    <td style={tdL}>{r.issues.map((issue) => <span key={issue} style={{ display: 'inline-block', margin: '1px 4px 1px 0', padding: '2px 6px', borderRadius: 8, background: issue.includes('billing') || issue.includes('staff') ? '#fee2e2' : '#fef3c7', color: issue.includes('billing') || issue.includes('staff') ? '#991b1b' : '#92400e', fontSize: 10.5, fontWeight: 700 }}>{issue}</span>)}</td>
                    <td style={td}><button onClick={() => openAccount(r)} style={{ border: '1px solid ' + HAIR, borderRadius: 6, background: '#fff', color: NAVY, fontWeight: 700, fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}>Fix account</button></td>
                  </tr>)}</tbody>
                </table>
              </div>
              {ar.accountsNeedingInfo.length > 100 && <div style={{ fontSize: 11, color: INK3, marginTop: 6 }}>Showing 100 of {ar.accountsNeedingInfo.length}, prioritized by open exposure.</div>}
            </div>
            <div style={card}>
              <h2 style={S.h2}>Slowest-paying accounts</h2>
              <div style={{ fontSize: 11.5, color: INK2, marginBottom: 8 }}>
                Based on {ar.kpis.paySampleCount} portal invoices with an observable final-payment date. NetSuite paid history is excluded because it has no paid date.
                {ar.kpis.payFallbackCount > 0 && <> {ar.kpis.payFallbackCount} older record{ar.kpis.payFallbackCount === 1 ? ' uses' : 's use'} the invoice&rsquo;s last-updated date as the legacy fallback.</>}
              </div>
              <div style={{ maxHeight: 430, overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
                  <thead><tr><th style={{ ...th, textAlign: 'left' }}>Account</th><th style={th}>Avg</th><th style={th}>Worst</th><th style={th}>Terms</th><th style={th}>Samples</th></tr></thead>
                  <tbody>{ar.accountPayRows.slice(0, 40).map((r) => <tr key={r.customerId}>
                    <td style={tdL}><button onClick={() => openAccount(r)} style={{ border: 0, padding: 0, background: 'none', color: C1, cursor: 'pointer', fontWeight: 700 }}>{r.name}</button></td>
                    <td style={{ ...td, color: r.avgDays > r.termsDays ? CRIT : INK, fontWeight: 700 }}>{Math.round(r.avgDays)}d</td>
                    <td style={{ ...td, color: r.maxDays > r.termsDays * 2 ? CRIT : WARN }}>{r.maxDays}d</td><td style={td}>{r.termsDays}d</td><td style={td}>{r.count}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </div>
          </div>
          <div style={card}>
            <h2 style={S.h2}>Largest open invoices</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Invoice / source</th><th style={{ ...th, textAlign: 'left' }}>Account / rep</th>
                  <th style={th}>Invoice date</th><th style={th}>Due date</th><th style={th}>Past due</th><th style={th}>Open balance</th>
                </tr></thead>
                <tbody>{[...ar.openInvoices].sort((a, b) => b.balance - a.balance).slice(0, 25).map((i) => <tr key={i.source + ':' + i.id}>
                  <td style={tdL}><b>{i.id}</b><div style={{ color: INK3, fontSize: 10 }}>{i.source}</div></td>
                  <td style={tdL}>{i.customerName}<div style={{ color: INK3, fontSize: 10 }}>{repName(i.repId)}</div></td>
                  <td style={td}>{i.invoiceDate ? i.invoiceDate.toLocaleDateString() : '—'}</td><td style={td}>{i.dueDate ? i.dueDate.toLocaleDateString() : '—'}</td>
                  <td style={{ ...td, color: i.daysPastDue > 60 ? CRIT : i.daysPastDue > 0 ? WARN : INK3 }}>{i.daysPastDue ? i.daysPastDue + 'd' : 'Current'}</td>
                  <td style={{ ...td, fontWeight: 800 }}>{$0(i.balance)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'forecast' && (
        <>
          <div style={card}>
            <h2 style={S.h2}>Revenue outlook — next 4 months</h2>
            <div style={{ fontSize: 11.5, color: INK2, marginBottom: 8 }}>
              Two layers, both explainable: <b>committed</b> is the open order book scheduled into the month it should
              bill (dated orders on their dates; undated on the {backlog.medianLag}-day median completion lag), and{' '}
              <b>expected new business</b> is the trailing-13-week order intake reshaped by prior years' seasonality.
              Low = committed only · High = base +15%.
            </div>
            <MonthBars rows={rev.months} series={[
              { label: 'Committed (order book)', color: C1, stack: true, get: (r) => r.committed },
              { label: 'Expected new business', color: C3, stack: true, get: (r) => r.newBusiness },
            ]} />
            <div style={{ overflowX: 'auto', marginTop: 10 }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 480 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>Committed</th>
                  <th style={th}>New business</th><th style={th}>Low</th><th style={th}>Base</th><th style={th}>High</th>
                </tr></thead>
                <tbody>
                  {rev.months.map((r) => (
                    <tr key={r.month}>
                      <td style={tdL}>{monLabel(r.month)}</td>
                      <td style={td}>{$0(r.committed)}</td><td style={td}>{$0(r.newBusiness)}</td>
                      <td style={td}>{$0(r.low)}</td><td style={{ ...td, fontWeight: 700 }}>{$0(r.base)}</td><td style={td}>{$0(r.high)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={card}>
            <h2 style={S.h2}>How accurate has this forecast been?</h2>
            {snaps === null ? (
              <div style={{ fontSize: 13, color: INK2 }}>Loading snapshot history&hellip;</div>
            ) : accuracy.scored === 0 ? (
              <div style={{ fontSize: 13, color: INK2 }}>
                No completed month has been scored yet. Each visit records the current forecast, so the
                first score appears once a forecast month finishes &mdash; check back after month end
                before leaning on these numbers for cash planning.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                  <Tile label="Avg error" value={pct1(accuracy.mape)} sub={'across ' + accuracy.scored + ' scored forecast' + (accuracy.scored === 1 ? '' : 's')}
                    subColor={accuracy.mape > 0.2 ? WARN : GOOD} />
                  <Tile label="Bias" value={(accuracy.bias >= 0 ? '+' : '') + pct1(accuracy.bias)}
                    sub={accuracy.bias >= 0 ? 'runs high \u2014 trim before planning' : 'runs low \u2014 upside likely'}
                    subColor={Math.abs(accuracy.bias) > 0.1 ? WARN : GOOD} />
                  <Tile label="Landed in range" value={pct1(accuracy.hitRate)} sub="actual fell between low and high" />
                </div>
                <MonthBars rows={accuracy.rows.map((r) => ({ month: r.targetMonth, ...r }))} series={[
                  { label: 'Forecast', color: C4, wash: true, get: (r) => r.forecast },
                  { label: 'Actual billed', color: C1, get: (r) => r.actual },
                ]} />
                <div style={{ overflowX: 'auto', marginTop: 10 }}>
                  <table style={{ borderCollapse: 'collapse', minWidth: 540 }}>
                    <thead><tr>
                      <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>Forecast made</th>
                      <th style={th}>Forecast</th><th style={th}>Actual</th><th style={th}>Miss</th><th style={th}>In range</th>
                    </tr></thead>
                    <tbody>
                      {accuracy.rows.map((r) => (
                        <tr key={r.targetMonth + '|' + r.asOfMonth}>
                          <td style={tdL}>{monLabel(r.targetMonth)}</td>
                          <td style={td}>{monLabel(r.asOfMonth)}{r.horizon ? ' (+' + r.horizon + 'mo)' : ' (same mo)'}</td>
                          <td style={td}>{$0(r.forecast)}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{$0(r.actual)}</td>
                          <td style={{ ...td, color: Math.abs(r.errorPct) > 0.15 ? CRIT : Math.abs(r.errorPct) > 0.07 ? WARN : GOOD }}>
                            {(r.error >= 0 ? '+' : '') + $0(r.error)} ({(r.errorPct >= 0 ? '+' : '') + pct1(r.errorPct)})
                          </td>
                          <td style={{ ...td, color: r.withinBand ? GOOD : WARN }}>{r.withinBand ? 'yes' : 'no'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 11.5, color: INK2, marginTop: 8 }}>
                  Actuals are billed revenue net of tax (both invoice streams). Only completed months are
                  scored &mdash; a month still in progress would always read as a miss. A positive bias means
                  the model forecasts more than lands.
                </div>
              </>
            )}
            {snapNote && <div style={{ fontSize: 11, color: INK3, marginTop: 8 }}>{snapNote}</div>}
          </div>
          <div style={card}>
            <h2 style={S.h2}>Cash coming in — next 3 months</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 460 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Month</th><th style={th}>From today's AR</th>
                  <th style={th}>From forecast billing</th><th style={th}>Total expected</th>
                </tr></thead>
                <tbody>
                  {cash.months.map((r) => (
                    <tr key={r.month}>
                      <td style={tdL}>{monLabel(r.month)}</td>
                      <td style={td}>{$0(r.fromAR)}</td><td style={td}>{$0(r.fromNewBilling)}</td>
                      <td style={{ ...td, fontWeight: 700 }}>{$0(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: INK2, marginTop: 8 }}>
              Assumes 55% of billing collects in its own month, 30% the next, 10% the one after — tune once QuickBooks
              payment history is connected. {$0(cash.excluded90plus)} of 90+ day AR is excluded until collected.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
