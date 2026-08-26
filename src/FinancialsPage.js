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
import { calcOrderMargin } from './pricing';
import {
  billedByMonth, matchedPL, arAging, backlogSchedule,
  forecastRevenue, cashForecast, insights, monthKey, parseDate,
} from './lib/financeEngine';

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
function MonthBars({ rows, series, height = 170, labelEvery = 1, valueFmt = $k }) {
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
                  x: e.clientX - rect.left, y: e.clientY - rect.top, title: monLabel(r.month),
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
                <text x={cx} y={H - 6} fontSize={9.5} fill={INK2} textAnchor="middle">{monLabel(r.month)}</text>
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
  const { sos, invs, histInvs, cu } = useAppData();
  const [tab, setTab] = useState('overview');
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
    const aging = arAging({ invs, asOf: today });
    const backlog = backlogSchedule({ sos, invs, calcMargin, asOf: today });
    const rev = forecastRevenue({ billedHistory: billed, backlog, sos, calcMargin, asOf: today, horizon: 4 });
    const cash = cashForecast({ aging, revForecast: rev, asOf: today });
    const notes = insights({ pl, aging, backlog, billedHistory: billed, asOf: today });
    return { billed, pl, aging, backlog, rev, cash, notes };
  }, [isAdmin, histInvs, invs, sos, calcMargin, today]);

  if (!isAdmin) {
    return <div className="card"><div className="card-body"><h2>Admins only</h2><p>The Financials suite is limited to admin accounts.</p></div></div>;
  }
  if (!model) return null;
  const { billed, pl, aging, backlog, rev, cash, notes } = model;

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
  const arSorted = invs
    .filter((i) => i && i.status !== 'void' && !i.deleted_at && (Number(i.total) || 0) - (Number(i.paid) || 0) > 0.005)
    .map((i) => ({ ...i, open: (Number(i.total) || 0) - (Number(i.paid) || 0), d: parseDate(i.date) }))
    .sort((a, b) => b.open - a.open);

  const tabs = [
    ['overview', 'Overview'], ['pl', 'P&L'], ['ar', 'Receivables'], ['forecast', 'Forecast'],
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
        <div style={{ display: 'flex', gap: 4, background: '#f1f5f9', borderRadius: 9, padding: 3 }}>
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
        <Tile label="Open receivables" value={$k(aging.total)}
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

      {tab === 'ar' && (
        <>
          <div style={card}>
            <h2 style={S.h2}>Receivables aging — {$0(aging.total)} open across {aging.count} invoices</h2>
            {(() => {
              const b = aging.buckets;
              const items = [
                ['Current', b.current, C1], ['1–30 days', b.d1_30, C1],
                ['31–60', b.d31_60, C4], ['61–90', b.d61_90, WARN], ['90+', b.d90plus, CRIT],
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
            <h2 style={S.h2}>Largest open invoices</h2>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: 520 }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Invoice</th><th style={{ ...th, textAlign: 'left' }}>Order</th>
                  <th style={th}>Date</th><th style={th}>Age</th><th style={th}>Open balance</th>
                </tr></thead>
                <tbody>
                  {arSorted.slice(0, 15).map((i) => {
                    const age = i.d ? Math.max(0, Math.floor((today - i.d) / 86400000)) : null;
                    return (
                      <tr key={i.id}>
                        <td style={tdL}>{i.id}</td><td style={tdL}>{i.so_id || '—'}</td>
                        <td style={td}>{i.d ? i.d.toLocaleDateString() : '—'}</td>
                        <td style={{ ...td, color: age > 60 ? CRIT : age > 30 ? WARN : INK }}>{age == null ? '—' : age + 'd'}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{$0(i.open)}</td>
                      </tr>
                    );
                  })}
                </tbody>
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
