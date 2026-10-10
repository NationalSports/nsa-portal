import React, { useEffect, useMemo, useState } from 'react';
import { buildAtOnceReport, reportCsv, STAGES } from './atOnceMetrics';
import './AtOnceDashboard.css';

const money = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
const compact = value => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const dateLabel = date => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const CHANNELS = { direct: 'Direct', all_school: '24/7 stores', webstore: 'Other / unclassified webstores', omg: 'OMG' };
function Delta({ current, previous }) {
  if (!previous) return <span className="ao-muted">{current ? 'No prior-period baseline' : 'No change from prior period'}</span>;
  const delta = (current - previous) / previous * 100;
  return <span className="ao-muted"><b className={delta >= 0 ? 'ao-positive' : ''}>{delta >= 0 ? '+' : ''}{delta.toFixed(1)}%</b> vs previous period</span>;
}

function IntakeChart({ rows }) {
  const [active, setActive] = useState(null);
  const [compare, setCompare] = useState(true);
  const selected = rows[Math.min(active ?? rows.length - 1, rows.length - 1)];
  const max = Math.max(1, ...rows.flatMap(r => compare ? [r.value, r.previous] : [r.value]));
  const x = i => 48 + i / Math.max(1, rows.length - 1) * 700;
  const y = value => 208 - value / max * 175;
  const line = key => rows.map((r, i) => `${i ? 'L' : 'M'}${x(i)},${y(r[key])}`).join(' ');
  return <>
    <div className="ao-chart-meta"><div><strong>{money(selected.value)}</strong><span>{dateLabel(selected.date)} · {selected.count} orders</span></div><button type="button" className="ao-legend" aria-pressed={compare} onClick={() => setCompare(!compare)}><i className={compare ? 'is-visible' : ''}/> Previous period {compare ? 'on' : 'off'}</button></div>
    <svg className="ao-chart" viewBox="0 0 780 245" role="img" aria-label="Daily order intake. Use the day slider below to inspect values.">
      <defs><linearGradient id="ao-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4e7b71" stopOpacity=".22"/><stop offset="100%" stopColor="#4e7b71" stopOpacity="0"/></linearGradient></defs>
      {[0, .25, .5, .75, 1].map(t => <g key={t}><line x1="48" x2="748" y1={y(max * t)} y2={y(max * t)} stroke="#e7ece9" strokeDasharray="3 5"/><text x="38" y={y(max * t) + 4} textAnchor="end">{compact(max * t)}</text></g>)}
      <path d={`${line('value')} L748,208 L48,208 Z`} fill="url(#ao-area)"/>
      {compare && <path d={line('previous')} fill="none" stroke="#aab5b0" strokeWidth="2" strokeDasharray="5 5"/>}
      <path d={line('value')} fill="none" stroke="#327763" strokeWidth="2.7" strokeLinejoin="round"/>
      {rows.map((r, i) => <rect key={i} x={x(i) - 350 / rows.length} y="20" width={700 / rows.length + 2} height="191" fill="transparent" onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}/>)}
      {active !== null && <g pointerEvents="none"><line x1={x(Math.min(active, rows.length - 1))} x2={x(Math.min(active, rows.length - 1))} y1="24" y2="208" stroke="#327763" strokeDasharray="3 4"/><circle cx={x(Math.min(active, rows.length - 1))} cy={y(selected.value)} r="5" fill="#327763" stroke="white" strokeWidth="2"/></g>}
      {[0, Math.floor((rows.length - 1) / 2), rows.length - 1].map(i => <text key={i} x={x(i)} y="235" textAnchor={i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle'}>{dateLabel(rows[i].date)}</text>)}
    </svg>
    <div className="ao-chart-controls"><label>Inspect day<input aria-label="Inspect daily order intake" type="range" min="0" max={rows.length - 1} value={active ?? rows.length - 1} onChange={e => setActive(+e.target.value)}/></label><span aria-live="polite">{compare ? `${dateLabel(selected.previousDate)}: ${money(selected.previous)}` : 'Order value · USD'}</span></div>
    <details className="ao-data"><summary>View chart data</summary><div className="ao-table-scroll"><table><thead><tr><th>Date</th><th>Orders</th><th>Intake</th><th>Prior date</th><th>Prior intake</th></tr></thead><tbody>{rows.map(r => <tr key={r.date.toISOString()}><td>{dateLabel(r.date)}</td><td>{r.count}</td><td>{money(r.value)}</td><td>{dateLabel(r.previousDate)}</td><td>{money(r.previous)}</td></tr>)}</tbody></table></div></details>
  </>;
}

export default function AtOnceDashboard({ orders = [], customers = [], stores: suppliedStores, supabase, calcStatus, calcValue, onOpenOrder, now }) {
  const [stores, setStores] = useState(suppliedStores || []);
  const [storeState, setStoreState] = useState(suppliedStores ? 'ready' : 'loading');
  const [retry, setRetry] = useState(0);
  const [days, setDays] = useState(30);
  const [source, setSource] = useState('all');
  const [storeId, setStoreId] = useState('all');
  const [queue, setQueue] = useState('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (suppliedStores) { setStores(suppliedStores); setStoreState('ready'); return; }
    if (!supabase) { setStoreState('unavailable'); return; }
    let cancelled = false;
    setStoreState('loading');
    (async () => {
      try {
        // Fetch only stores represented in this user's loaded orders; no unbounded catalog query.
        const ids = [...new Set(orders.map(o => o.webstore_id).filter(Boolean))], result = [];
        for (let i = 0; i < ids.length; i += 100) {
          const { data, error } = await supabase.from('webstores').select('id,name,org_type').in('id', ids.slice(i, i + 100));
          if (error) throw error;
          result.push(...(data || []));
        }
        if (!cancelled) { setStores(result); setStoreState(result.length === ids.length ? 'ready' : 'partial'); }
      } catch { if (!cancelled) setStoreState('error'); }
    })();
    return () => { cancelled = true; };
  }, [supabase, orders, suppliedStores, retry]);
  useEffect(() => { if (['error', 'partial', 'unavailable'].includes(storeState) && source === 'all_school') { setSource('all'); setStoreId('all'); } }, [storeState, source]);
  const report = useMemo(() => buildAtOnceReport({ orders, customers, stores, calcStatus, calcValue, days, source, storeId, now }), [orders, customers, stores, calcStatus, calcValue, days, source, storeId, now]);
  useEffect(() => { setPage(0); }, [queue, source, storeId, search, days]);
  const queueRows = (queue === 'period' ? report.period : queue === 'overdue' ? report.overdue : queue === 'open' ? report.open : report.open.filter(r => r.status === queue)).filter(r => `${r.id} ${r.customer} ${r.store} ${r.order.memo || ''}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) || String(a.id).localeCompare(String(b.id)));
  const safePage = Math.min(page, Math.max(0, Math.ceil(queueRows.length / 12) - 1));
  const exportRows = () => {
    const blob = new Blob(['\uFEFF' + reportCsv(queueRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = `at-once-${queue}-${days}d.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const chooseQueue = value => { setQueue(value); setSearch(''); setPage(0); };
  return <section className="ao-dashboard" aria-label="At-Once operations dashboard">
    <header className="ao-heading"><div><div className="ao-eyebrow"><span/> OPERATIONS OVERVIEW</div><h1>At-Once, at a glance<span>.</span></h1><p>From incoming orders to the final handoff.</p></div><div className="ao-period" aria-label="Reporting period">{[7, 30, 90].map(n => <button type="button" key={n} aria-pressed={days === n} onClick={() => setDays(n)}>{n} days</button>)}</div></header>
    <div className="ao-toolbar"><div className="ao-filters"><label>Channel<select aria-label="Channel" value={source} onChange={e => { setSource(e.target.value); setStoreId('all'); }}><option value="all">All At-Once orders</option><option value="all_school" disabled={storeState !== 'ready'}>24/7 stores</option><option value="webstores">All native webstores</option><option value="direct">Direct orders</option><option value="omg">OMG orders</option></select></label><label>Store<select aria-label="Store" value={storeId} onChange={e => setStoreId(e.target.value)} disabled={source === 'direct' || source === 'omg'}><option value="all">All stores</option>{stores.filter(s => source !== 'all_school' || s.org_type === 'all_school').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div><span className="ao-scope">{dateLabel(report.start)} – {dateLabel(new Date(report.end.getTime() - 1))} <span>· Intake period</span></span></div>
    {storeState !== 'ready' && <div className="ao-notice" role="status">{storeState === 'loading' ? 'Loading store classification…' : 'Store classification is unavailable or incomplete. All-order totals still work; the 24/7-only filter is unavailable.'}{['error', 'partial'].includes(storeState) && <button type="button" onClick={() => setRetry(r => r + 1)}>Retry</button>}</div>}
    <div className="ao-metrics">
      <button type="button" className="ao-metric ao-metric-featured" onClick={() => chooseQueue('period')}><span>Order intake <i>↗</i></span><strong>{money(report.intake)}</strong><Delta current={report.intake} previous={report.previousIntake}/><small>Orders created in this period</small></button>
      <button type="button" className="ao-metric" onClick={() => chooseQueue('period')}><span>New orders <i>↗</i></span><strong>{report.period.length.toLocaleString()}</strong><Delta current={report.period.length} previous={report.previous.length}/><small>{report.period.length ? money(report.intake / report.period.length) : '—'} average order value</small></button>
      <button type="button" className="ao-metric" onClick={() => chooseQueue('open')}><span>Open workload <i>↗</i></span><strong>{report.open.length.toLocaleString()}</strong><span className="ao-muted">{money(report.openValue)} order value</span><small>All dates · current open orders</small></button>
      <button type="button" className={`ao-metric ${report.overdue.length ? 'ao-metric-alert' : ''}`} onClick={() => chooseQueue('overdue')}><span>Past need-by date <i>↗</i></span><strong>{report.overdue.length.toLocaleString()}</strong><span className="ao-muted">{report.overdue.length ? 'Review the affected orders below' : 'No dated open orders are overdue'}</span><small>{report.open.filter(r => !r.due).length} open orders have no need-by date</small></button>
    </div>
    <div className="ao-main-grid"><article className="ao-panel"><div className="ao-panel-heading"><div><h2>Order intake</h2><p>Daily order value · USD</p></div><span className="ao-tag">LAST {days} DAYS</span></div><IntakeChart rows={report.daily}/></article><article className="ao-panel ao-pipeline"><div className="ao-panel-heading"><div><h2>Work in progress</h2><p>Current open orders · all dates</p></div><span className="ao-total">{report.open.length}</span></div><div className="ao-stage-strip" aria-hidden="true">{report.stages.map(s => <span key={s.id} style={{ flex: s.rows.length, background: s.color }}/>)}</div>{report.stages.filter(s => s.id !== 'unknown' || s.rows.length).map(s => <button type="button" className={`ao-stage ${queue === s.id ? 'is-active' : ''}`} key={s.id} onClick={() => chooseQueue(s.id)}><span><i style={{ background: s.color }}/>{s.label}</span><b>{s.rows.length}<span> →</span></b></button>)}<p className="ao-footnote">Shared sales-order stages. Production prep can still require artwork or DTF readiness; it does not mean released.</p></article></div>
    <div className="ao-bottom-grid"><article className="ao-panel ao-queue"><div className="ao-panel-heading"><div><h2>Order workbench</h2><p>{queue === 'period' ? 'Orders created in the selected intake period' : 'Current workload across all order dates'} · {queueRows.length} orders</p></div><button type="button" className="ao-button" onClick={exportRows} disabled={!queueRows.length}>↓ Export CSV</button></div><div className="ao-queue-controls"><select aria-label="Workbench queue" value={queue} onChange={e => chooseQueue(e.target.value)}><option value="open">All open orders</option><option value="overdue">Past need-by date</option><option value="period">New in period</option>{report.stages.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select><input aria-label="Search workbench" placeholder="Search orders, customers, stores…" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="ao-table-scroll"><table><thead><tr><th>Order / customer</th><th>Stage</th><th>Need by</th><th className="ao-numeric">Value</th></tr></thead><tbody>{queueRows.slice(safePage * 12, safePage * 12 + 12).map(r => <tr key={r.id}><td><button type="button" className="ao-order-link" onClick={() => onOpenOrder(r.order)}>{r.id} <span>↗</span></button><small>{r.customer}</small><small>{r.store || CHANNELS[r.channel]}</small></td><td><span className="ao-status"><i style={{ background: STAGES.find(s => s[0] === r.status)?.[2] }}/>{STAGES.find(s => s[0] === r.status)?.[1]}</span></td><td className={r.overdue ? 'ao-overdue' : ''}>{r.due ? dateLabel(r.due) : 'Not set'}{r.overdue && <small>Past due</small>}</td><td className="ao-numeric">{r.value === null ? 'Unavailable' : money(r.value)}</td></tr>)}</tbody></table>{!queueRows.length && <div className="ao-empty"><span>✓</span><h3>{search ? 'No matching orders' : 'No orders in this view'}</h3><p>{search ? 'Try a different order number, customer, or store.' : 'Change the channel or queue to explore other orders.'}</p></div>}</div><div className="ao-pagination"><span>{queueRows.length ? `${safePage * 12 + 1}–${Math.min(queueRows.length, safePage * 12 + 12)} of ${queueRows.length}` : '0 orders'}</span><div><button type="button" aria-label="Previous page" disabled={!safePage} onClick={() => setPage(safePage - 1)}>←</button><button type="button" aria-label="Next page" disabled={(safePage + 1) * 12 >= queueRows.length} onClick={() => setPage(safePage + 1)}>→</button></div></div></article><article className="ao-panel ao-contributors"><div className="ao-panel-heading"><div><h2>Where orders come from</h2><p>Top stores & channels · intake period</p></div></div>{report.groups.slice(0, 6).map((group, index) => <div className="ao-contributor" key={group.key}><div><span><b>{String(index + 1).padStart(2, '0')}</b>{group.name}</span><strong>{money(group.value)}</strong></div><div className="ao-contributor-bar"><span style={{ width: `${Math.max(0, Math.min(100, group.value / Math.max(1, report.groups[0]?.value) * 100))}%` }}/></div><small>{group.count} orders · {report.intake > 0 ? Math.round(group.value / report.intake * 100) : 0}% of intake</small></div>)}{!report.groups.length && <p className="ao-empty">Store and channel performance will appear as orders arrive.</p>}<div className="ao-definition"><h3>One operational flow</h3><p>Purchasing → receiving & picking → production → fulfillment.</p><p>Paid 24/7 checkouts are accounted for automatically. This dashboard does not require an invoice action to advance them.</p></div></article></div>
    <footer className="ao-report-note">Order intake uses the shared sales-order sales value (shipping and tax excluded); it is not collected cash or recognized revenue. Cancelled and booking orders are excluded. Completed means the shared order status is closed, not proof of delivery.{report.missingDates > 0 && ` ${report.missingDates} orders without a valid creation date are excluded from period reporting.`}{report.missingValues > 0 && ` ${report.missingValues} period orders have unavailable values and are excluded from value totals.`}</footer>
  </section>;
}
