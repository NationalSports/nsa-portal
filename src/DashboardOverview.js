import React, { useState } from 'react';
import './dashboardOverview.css';

// New-UI homepage ("Connect" redesign). Sales-first layout:
//   1. Hero: one headline number (sold this month) + pace vs the same point last month
//   2. Stat tiles: billed, open quote pipeline, win rate, needs attention
//   3. Priority to-do (unchanged data from App.js)
//   4. Sold vs billed — 6 months, one axis, hover + table twin
//   5. Quote pipeline by stage + quotes going stale (who to call today)
//   6. Top accounts (12 months) + where work lives now
// Colors were checked with the dataviz palette validator: sold/billed pair passes CVD separation;
// the workflow stages are ordered, so they use one ordinal navy ramp instead of five hues.

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const SOLD = '#2a4a9b';
const BILLED = '#d1873a';
const LAST_YEAR = '#9aa3b5'; // de-emphasis gray: last year is context, this year is the story
const STAGE_RAMP = ['#9db2e3', '#7392d6', '#4f73c2', '#3557a6', '#1f3a7a'];
const QUOTE_RAMP = ['#9db2e3', '#4f73c2', '#1f3a7a'];
const DAY = 864e5;

const parsePortalDate = (value) => {
  if (!value) return null;
  const raw = String(value);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    return new Date(year, Number(us[1]) - 1, Number(us[2]));
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isLiveRecord = (record) =>
  record && record.status !== 'cancelled' && record.status !== 'deleted' && !record.deleted_at;

const isSameMonth = (date, month) =>
  date && date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();

const pctChange = (current, previous) => {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const formatCompact = (value) => {
  const amount = Number(value) || 0;
  const abs = Math.abs(amount);
  if (abs >= 1000000) return `$${(amount / 1000000).toFixed(abs >= 10000000 ? 1 : 2).replace(/\.?0+$/, '')}M`;
  if (abs >= 1000) return `$${(amount / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '')}K`;
  return MONEY.format(amount);
};

const tickStep = (max) => {
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
};

// Quoted value of an estimate: the shared margin calc when it accepts the estimate,
// otherwise a plain garment sell sum (sizes, or est_qty when sizes aren't broken out).
const estimateValue = (estimate, calcMargin, orders) => {
  try {
    const rev = Number(calcMargin?.(estimate, orders)?.rev);
    if (Number.isFinite(rev) && rev > 0) return rev;
  } catch { /* fall through */ }
  return (estimate.items || []).reduce((sum, item) => {
    const sized = Object.values(item.sizes || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const qty = sized > 0 ? sized : Number(item.est_qty) || 0;
    return sum + qty * (Number(item.unit_sell) || 0);
  }, 0);
};

function Delta({ value, label }) {
  if (value === null) return <span className="dov2-delta is-new">New <em>{label}</em></span>;
  const tone = value > 0 ? 'is-up' : value < 0 ? 'is-down' : 'is-flat';
  const arrow = value > 0 ? '▲' : value < 0 ? '▼' : '–';
  return (
    <span className={`dov2-delta ${tone}`}>
      <span aria-hidden="true">{arrow}</span> {value > 0 ? '+' : ''}{value}% <em>{label}</em>
    </span>
  );
}

function Sparkline({ values }) {
  const w = 132, h = 40, pad = 4;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => [
    pad + (values.length > 1 ? i / (values.length - 1) : 0) * (w - pad * 2),
    h - pad - (v / max) * (h - pad * 2),
  ]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="dov2-spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={`${line} L${last[0]} ${h} L${pts[0][0]} ${h} Z`} fill="rgba(255,255,255,.10)" />
      <path d={line} fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="4.5" fill="#fff" stroke="#192853" strokeWidth="2" />
    </svg>
  );
}

export default function DashboardOverview({
  view,
  user,
  customers = [],
  estimates = [],
  orders = [],
  invoices = [],
  historicalInvoices = [],
  jobs = [],
  actionCount = 0,
  unreadCount = 0,
  priorityItems = [],
  calcStatus,
  calcMargin,
  onNavigate,
  onOpenPriority,
  onOpenEstimate,
  onOpenCustomer,
  onOpenOrder,
  onOpenInvoice,
  artItems = [],
  priorityTotal,
  defaultChartMode = 'yoy',
}) {
  const [hoverMonth, setHoverMonth] = useState(null);
  const [sideTab, setSideTab] = useState('invoice'); // right of the to-do: 'invoice' | 'pastdue' | 'art'
  const [chartMode, setChartMode] = useState(defaultChartMode); // 'yoy' = billed this year vs last (default) | 'sold' = sold vs billed
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfMonth = now.getDate();

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const orderRepId = (order) =>
    customerById.get(order?.customer_id)?.primary_rep_id || order?.created_by || null;
  const scopedToUser = view === 'sales';
  const scopedOrders = orders.filter(
    (order) => isLiveRecord(order) && (!scopedToUser || orderRepId(order) === user?.id),
  );
  const scopedEstimates = estimates.filter(
    (estimate) => isLiveRecord(estimate) && (!scopedToUser || estimate.created_by === user?.id),
  );
  const scopedJobs = jobs.filter((job) => {
    if (!scopedToUser) return true;
    const parent = orderById.get(job.so_id || job._soId);
    return parent ? orderRepId(parent) === user?.id : true;
  });
  const orderRev = (order) => {
    try {
      return Number(calcMargin?.(order, orders)?.rev) || 0;
    } catch {
      return 0;
    }
  };

  // ── Sold / billed by month (same rules as before: SO created date; invoices deduped, voids out) ──
  const monthRows = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return { month, label: MONTH.format(month), sales: 0, billed: 0, salesToDate: 0, billedToDate: 0 };
  });
  scopedOrders.forEach((order) => {
    const date = parsePortalDate(order.created_at);
    const row = monthRows.find((item) => isSameMonth(date, item.month));
    if (!row) return;
    const rev = orderRev(order);
    row.sales += rev;
    if (date.getDate() <= dayOfMonth) row.salesToDate += rev;
  });

  // Billed by calendar month, this year and last — same invoice rules as the 6-month rows.
  const thisYear = now.getFullYear();
  const billedThisYear = Array(12).fill(0);
  const billedLastYear = Array(12).fill(0);
  const countedInvoiceIds = new Set();
  const addBilling = (invoice, isHistorical) => {
    if (!invoice || invoice.status === 'void' || invoice.deleted_at) return;
    if (invoice.id && countedInvoiceIds.has(invoice.id)) return;
    if (invoice.id) countedInvoiceIds.add(invoice.id);
    if (scopedToUser) {
      const parent = !isHistorical ? orderById.get(invoice.so_id) : null;
      const repId =
        invoice.rep_id ||
        (parent ? orderRepId(parent) : customerById.get(invoice.customer_id)?.primary_rep_id);
      if (repId !== user?.id) return;
    }
    const date = parsePortalDate(invoice.date || invoice.created_at);
    if (!date) return;
    const total = Number(invoice.total) || 0;
    if (date.getFullYear() === thisYear) billedThisYear[date.getMonth()] += total;
    else if (date.getFullYear() === thisYear - 1) billedLastYear[date.getMonth()] += total;
    const row = monthRows.find((item) => isSameMonth(date, item.month));
    if (!row) return;
    row.billed += total;
    if (date.getDate() <= dayOfMonth) row.billedToDate += total;
  };
  historicalInvoices.forEach((invoice) => addBilling(invoice, true));
  invoices.forEach((invoice) => addBilling(invoice, false));

  const current = monthRows[monthRows.length - 1];
  const previous = monthRows[monthRows.length - 2];
  // Pace compares like with like: this month so far vs last month through the same day.
  const soldPace = pctChange(current.sales, previous.salesToDate);
  const billedPace = pctChange(current.billed, previous.billedToDate);

  // ── Quote pipeline ──
  const quoteStages = [
    { key: 'draft', label: 'Drafting', statuses: ['draft', 'open'], color: QUOTE_RAMP[0] },
    { key: 'sent', label: 'Sent to coach', statuses: ['sent'], color: QUOTE_RAMP[1] },
    { key: 'approved', label: 'Approved — convert', statuses: ['approved'], color: QUOTE_RAMP[2] },
  ].map((stage) => {
    const rows = scopedEstimates.filter((estimate) => stage.statuses.includes(estimate.status));
    return { ...stage, count: rows.length, value: rows.reduce((sum, e) => sum + estimateValue(e, calcMargin, orders), 0) };
  });
  const pipelineValue = quoteStages.reduce((sum, stage) => sum + stage.value, 0);
  const pipelineCount = quoteStages.reduce((sum, stage) => sum + stage.count, 0);

  const ninetyAgo = new Date(today.getTime() - 90 * DAY);
  const recentQuotes = scopedEstimates.filter((estimate) => {
    const date = parsePortalDate(estimate.created_at);
    return date && date >= ninetyAgo;
  });
  const recentWon = recentQuotes.filter((estimate) => estimate.status === 'converted').length;
  const winRate = recentQuotes.length ? Math.round((recentWon / recentQuotes.length) * 100) : null;

  const staleQuotes = scopedEstimates
    .filter((estimate) => estimate.status === 'sent')
    .map((estimate) => {
      const date = parsePortalDate(estimate.sent_at || estimate.created_at);
      return {
        estimate,
        age: date ? Math.floor((today - date) / DAY) : 0,
        value: estimateValue(estimate, calcMargin, orders),
        customer: customerById.get(estimate.customer_id),
      };
    })
    .filter((row) => row.age >= 14)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  // ── Top accounts, trailing 12 months ──
  const yearAgo = new Date(today.getTime() - 365 * DAY);
  const accountTotals = new Map();
  scopedOrders.forEach((order) => {
    const date = parsePortalDate(order.created_at);
    if (!date || date < yearAgo) return;
    const key = customerById.get(order.customer_id)?.parent_id || order.customer_id;
    const row = accountTotals.get(key) || { id: key, rev: 0, orders: 0, last: date };
    row.rev += orderRev(order);
    row.orders += 1;
    if (date > row.last) row.last = date;
    accountTotals.set(key, row);
  });
  const topAccounts = [...accountTotals.values()].sort((a, b) => b.rev - a.rev).slice(0, 6)
    .map((row) => ({ ...row, customer: customerById.get(row.id), days: Math.floor((today - row.last) / DAY) }));
  const topMax = Math.max(1, ...topAccounts.map((row) => row.rev));

  // ── Where work lives now ──
  const activeOrders = scopedOrders.filter((order) => calcStatus?.(order) !== 'complete');
  const activeJobs = scopedJobs.filter((job) => !['completed', 'shipped'].includes(job.prod_status));
  const stages = [
    { key: 'order', label: 'Needs ordering', statuses: ['booking', 'need_order', 'needs_pull'], route: 'orders' },
    { key: 'sourcing', label: 'Waiting on goods', statuses: ['waiting_receive', 'items_received'], route: 'orders' },
    { key: 'production', label: 'In production', statuses: ['in_production'], route: 'production' },
    { key: 'ready', label: 'Ready to invoice', statuses: ['ready_to_invoice'], route: 'invoices' },
  ].map((stage, index) => ({
    ...stage,
    color: STAGE_RAMP[index + 1],
    value: activeOrders.filter((order) => stage.statuses.includes(calcStatus?.(order))).length,
  }));
  const stageTotal = stages.reduce((sum, stage) => sum + stage.value, 0);

  // ── Ready to invoice: orders whose status says invoice-ready, minus what's already invoiced ──
  const invoicedBySo = new Map();
  invoices.forEach((invoice) => {
    if (!invoice || invoice.status === 'void' || invoice.deleted_at || !invoice.so_id) return;
    invoicedBySo.set(invoice.so_id, (invoicedBySo.get(invoice.so_id) || 0) + (Number(invoice.total) || 0));
  });
  const readyToInvoice = activeOrders
    .filter((order) => calcStatus?.(order) === 'ready_to_invoice')
    .map((order) => ({ order, customer: customerById.get(order.customer_id), value: Math.max(0, orderRev(order) - (invoicedBySo.get(order.id) || 0)) }))
    .filter((row) => row.value > 0.005) // already fully invoiced → nothing left to bill, don't list it
    .sort((a, b) => b.value - a.value);
  const readyTotal = readyToInvoice.reduce((sum, row) => sum + row.value, 0);

  // ── Past-due invoices: open balance past the due date (due_date, else invoice date + terms) ──
  const pastDue = invoices
    .filter((invoice) => invoice && invoice.status !== 'void' && invoice.status !== 'paid' && !invoice.deleted_at)
    .filter((invoice) => {
      if (!scopedToUser) return true;
      const parent = orderById.get(invoice.so_id);
      const repId = invoice.rep_id || (parent ? orderRepId(parent) : customerById.get(invoice.customer_id)?.primary_rep_id);
      return repId === user?.id;
    })
    .map((invoice) => {
      const customer = customerById.get(invoice.customer_id);
      const balance = (Number(invoice.total) || 0) - (Number(invoice.paid) || 0);
      const invDate = parsePortalDate(invoice.date || invoice.created_at);
      const terms = String(customer?.payment_terms || 'net30');
      const termDays = /prepay|due/i.test(terms) ? 0 : parseInt((terms.match(/\d+/) || ['30'])[0], 10) || 30;
      const due = parsePortalDate(invoice.due_date) || (invDate ? new Date(invDate.getTime() + termDays * DAY) : null);
      return { invoice, customer, balance, daysLate: due ? Math.floor((today - due) / DAY) : 0 };
    })
    .filter((row) => row.balance > 0.005 && row.daysLate > 0)
    .sort((a, b) => b.balance - a.balance);
  const pastDueTotal = pastDue.reduce((sum, row) => sum + row.balance, 0);

  // ── Chart scale ──
  const curMonth = now.getMonth();
  const yoyRows = Array.from({ length: 12 }, (_, m) => ({
    label: MONTH.format(new Date(thisYear, m, 1)),
    current: m <= curMonth ? billedThisYear[m] : null,
    last: billedLastYear[m],
  }));
  const ytdThis = billedThisYear.slice(0, curMonth + 1).reduce((a, v) => a + v, 0);
  const ytdLast = billedLastYear.slice(0, curMonth).reduce((a, v) => a + v, 0) + previousYearMonthToDate();
  function previousYearMonthToDate() {
    // last year's current month, only through today's day-of-month, so YTD compares like with like
    let sum = 0;
    const seen = new Set();
    const add = (invoice, isHistorical) => {
      if (!invoice || invoice.status === 'void' || invoice.deleted_at) return;
      if (invoice.id && seen.has(invoice.id)) return;
      if (invoice.id) seen.add(invoice.id);
      if (scopedToUser) {
        const parent = !isHistorical ? orderById.get(invoice.so_id) : null;
        const repId = invoice.rep_id || (parent ? orderRepId(parent) : customerById.get(invoice.customer_id)?.primary_rep_id);
        if (repId !== user?.id) return;
      }
      const date = parsePortalDate(invoice.date || invoice.created_at);
      if (date && date.getFullYear() === thisYear - 1 && date.getMonth() === curMonth && date.getDate() <= dayOfMonth) sum += Number(invoice.total) || 0;
    };
    historicalInvoices.forEach((invoice) => add(invoice, true));
    invoices.forEach((invoice) => add(invoice, false));
    return sum;
  }
  const ytdPace = pctChange(ytdThis, ytdLast);
  const rawMax = chartMode === 'yoy'
    ? Math.max(1, ...billedThisYear, ...billedLastYear)
    : Math.max(1, ...monthRows.flatMap((row) => [row.sales, row.billed]));
  const step = tickStep(rawMax);
  const chartMax = Math.ceil(rawMax / step) * step;
  const ticks = Array.from({ length: Math.round(chartMax / step) + 1 }, (_, i) => i * step);

  const firstName = (user?.name || 'Team').split(' ')[0];
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';
  const scopeLabel = scopedToUser ? 'Your book' : 'All of NSA';
  const openCustomer = (customer) => customer && onOpenCustomer?.(customer);

  return (
    <section className="dov2" aria-labelledby="dov2-title">
      {/* ═══ Hero ═══ */}
      <div className="dov2-hero">
        <div className="dov2-hero__top">
          <div>
            <div className="dov2-eyebrow">{FULL_DATE.format(now)} · {scopeLabel}</div>
            <h2 id="dov2-title">{greeting}, {firstName}.</h2>
          </div>
          <div className="dov2-hero__quick">
            <button type="button" onClick={() => onNavigate?.('estimates')}>Go to quotes</button>
            <button type="button" onClick={() => onNavigate?.('customers')}>Customers</button>
          </div>
        </div>
        <div className="dov2-hero__body">
          <button type="button" className="dov2-headline" onClick={() => onNavigate?.('reports')}>
            <span className="dov2-headline__label">Sold this month</span>
            <strong>{MONEY.format(current.sales)}</strong>
            <Delta value={soldPace} label="vs same point last month" />
          </button>
          <div className="dov2-hero__spark">
            <Sparkline values={monthRows.map((row) => row.sales)} />
            <span>6-month trend</span>
          </div>
        </div>
      </div>

      <div className="dov2-tiles">
        <button type="button" className="dov2-tile" onClick={() => onNavigate?.('invoices')}>
          <span className="dov2-tile__label">Billed this month</span>
          <strong>{formatCompact(current.billed)}</strong>
          <Delta value={billedPace} label="pace" />
        </button>
        <button type="button" className="dov2-tile" onClick={() => onNavigate?.('estimates')}>
          <span className="dov2-tile__label">Open quote pipeline</span>
          <strong>{formatCompact(pipelineValue)}</strong>
          <span className="dov2-tile__foot">{pipelineCount} open quote{pipelineCount === 1 ? '' : 's'}</span>
        </button>
        <button type="button" className="dov2-tile" onClick={() => onNavigate?.('reports')}>
          <span className="dov2-tile__label">Win rate · last 90 days</span>
          <strong>{winRate === null ? '—' : `${winRate}%`}</strong>
          <span className="dov2-tile__foot">{recentWon} of {recentQuotes.length} quotes became orders</span>
        </button>
        <button type="button" className={`dov2-tile ${actionCount ? 'is-alert' : ''}`} onClick={() => onNavigate?.(unreadCount && !actionCount ? 'messages' : 'dashboard')}>
          <span className="dov2-tile__label">Needs your attention</span>
          <strong>{actionCount}</strong>
          <span className="dov2-tile__foot">{unreadCount} unread message{unreadCount === 1 ? '' : 's'}</span>
        </button>
      </div>

      {/* ═══ Priority to-do (left) + money & art tabs (right) ═══ */}
      <div className="dov2-split">
        <article className="dov2-card dov2-priority" aria-labelledby="dov2-priority-title">
          <header className="dov2-card__head">
            <div>
              <span className="dov2-kicker">Start here</span>
              <h3 id="dov2-priority-title">Priority to-do</h3>
            </div>
            <span className="dov2-count">{priorityTotal ?? actionCount} open</span>
          </header>
          {priorityItems.length === 0 ? (
            <div className="dov2-empty"><span aria-hidden="true">✓</span>You’re caught up — no action items need attention.</div>
          ) : (
            <div className="dov2-priority__list">
              {priorityItems.map((item, index) => {
                const priority = item.priority ?? 2;
                const tone = priority <= 0 ? 'urgent' : priority === 1 ? 'high' : 'normal';
                const label = priority <= 0 ? 'Urgent' : priority === 1 ? 'High' : 'Next';
                return (
                  <button
                    type="button"
                    className={`dov2-priority__item is-${tone}`}
                    key={item.dismissKey || item.id || `${item.type}-${index}`}
                    onClick={() => onOpenPriority?.(item)}
                  >
                    <span className="dov2-pill">{label}</span>
                    <span className="dov2-priority__copy">
                      <span>{item.msg}</span>
                      <small>{item.detail || 'Open this item to continue.'}</small>
                    </span>
                    <span className="dov2-priority__action">{item.action || 'Open'} →</span>
                  </button>
                );
              })}
            </div>
          )}
          {(priorityTotal ?? actionCount) > priorityItems.length && (
            <div className="dov2-card__foot">{(priorityTotal ?? actionCount) - priorityItems.length} more in the full queue below ↓</div>
          )}
        </article>

        <article className="dov2-card dov2-side">
          <div className="dov2-tabs" role="tablist" aria-label="Money and art">
            {[
              ['invoice', 'Ready to invoice', readyToInvoice.length],
              ['pastdue', 'Past due', pastDue.length],
              ['art', 'Art', artItems.length],
            ].map(([key, label, n]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`dov2-tab-${key}`}
                aria-selected={sideTab === key}
                aria-controls="dov2-side-panel"
                className={sideTab === key ? 'is-on' : ''}
                onClick={() => setSideTab(key)}
              >
                {label}<span className="dov2-tabs__n">{n}</span>
              </button>
            ))}
          </div>
          <div id="dov2-side-panel" role="tabpanel" aria-labelledby={`dov2-tab-${sideTab}`}>
            {sideTab === 'invoice' && (
              <>
                <div className="dov2-side__sum"><b>{formatCompact(readyTotal)}</b> ready to bill across {readyToInvoice.length} order{readyToInvoice.length === 1 ? '' : 's'}</div>
                {readyToInvoice.length === 0 ? <div className="dov2-empty is-small">Nothing waiting to be invoiced.</div> : (
                  <div className="dov2-rows">
                    {readyToInvoice.slice(0, 6).map(({ order, customer, value }) => (
                      <button type="button" className="dov2-row" key={order.id} onClick={() => (onOpenOrder ? onOpenOrder(order) : onNavigate?.('invoices'))}>
                        <span className="dov2-row__name">{customer?.name || order.id}<small>{order.id}{order.memo ? ` · ${order.memo}` : ''}</small></span>
                        <b>{formatCompact(value)}</b>
                      </button>
                    ))}
                  </div>
                )}
                {readyToInvoice.length > 6 && <div className="dov2-card__foot"><span>{readyToInvoice.length - 6} more</span><button type="button" className="dov2-link" onClick={() => onNavigate?.('invoices')}>Invoices →</button></div>}
              </>
            )}
            {sideTab === 'pastdue' && (
              <>
                <div className="dov2-side__sum"><b>{formatCompact(pastDueTotal)}</b> past due across {pastDue.length} invoice{pastDue.length === 1 ? '' : 's'}</div>
                {pastDue.length === 0 ? <div className="dov2-empty is-small">No past-due invoices.</div> : (
                  <div className="dov2-rows">
                    {pastDue.slice(0, 6).map(({ invoice, customer, balance, daysLate }) => (
                      <button type="button" className="dov2-row" key={invoice.id} onClick={() => (onOpenInvoice ? onOpenInvoice(invoice) : onNavigate?.('invoices'))}>
                        <span className={`dov2-age ${daysLate > 30 ? 'is-old' : ''}`}>{daysLate}d</span>
                        <span className="dov2-row__name">{customer?.name || 'Unknown customer'}<small>{invoice.id}</small></span>
                        <b>{formatCompact(balance)}</b>
                      </button>
                    ))}
                  </div>
                )}
                {pastDue.length > 6 && <div className="dov2-card__foot"><span>{pastDue.length - 6} more</span><button type="button" className="dov2-link" onClick={() => onNavigate?.('reports')}>Receivables →</button></div>}
              </>
            )}
            {sideTab === 'art' && (
              <>
                <div className="dov2-side__sum"><b>{artItems.length}</b> art item{artItems.length === 1 ? '' : 's'} need you</div>
                {artItems.length === 0 ? <div className="dov2-empty is-small">No art waiting on you.</div> : (
                  <div className="dov2-rows">
                    {artItems.slice(0, 6).map((item, index) => (
                      <button type="button" className="dov2-row" key={item.dismissKey || item.id || `${item.type}-${index}`} onClick={() => onOpenPriority?.(item)}>
                        <span className="dov2-row__name">{item.msg}<small>{item.detail || ''}</small></span>
                        <span className="dov2-priority__action">{item.action || 'Open'} →</span>
                      </button>
                    ))}
                  </div>
                )}
                {artItems.length > 6 && <div className="dov2-card__foot"><span>{artItems.length - 6} more in the full queue below ↓</span></div>}
              </>
            )}
          </div>
        </article>
      </div>

      {/* ═══ Sold vs billed ═══ */}
      <div className="dov2-grid">
        <article className="dov2-card dov2-chart-card">
          <header className="dov2-card__head dov2-chart-head">
            <div>
              <span className="dov2-kicker">{chartMode === 'yoy' ? `${thisYear} vs ${thisYear - 1}` : 'Last 6 months'}</span>
              <h3>{chartMode === 'yoy' ? 'Sales vs last year' : 'Sold vs billed'}</h3>
            </div>
            <div className="dov2-seg" role="group" aria-label="Chart view">
              <button type="button" className={chartMode === 'yoy' ? 'is-on' : ''} aria-pressed={chartMode === 'yoy'} onClick={() => { setChartMode('yoy'); setHoverMonth(null); }}>vs last year</button>
              <button type="button" className={chartMode === 'sold' ? 'is-on' : ''} aria-pressed={chartMode === 'sold'} onClick={() => { setChartMode('sold'); setHoverMonth(null); }}>Sold vs billed</button>
            </div>
          </header>
          {chartMode === 'yoy' ? (
            <>
              <div className="dov2-chart-sub">
                <span><b>{formatCompact(ytdThis)}</b> sales YTD</span>
                <Delta value={ytdPace} label={`vs ${formatCompact(ytdLast)} same point last year`} />
                <div className="dov2-legend" aria-label="Legend">
                  <span><i style={{ background: SOLD }} />{thisYear}</span>
                  <span><i style={{ background: LAST_YEAR }} />{thisYear - 1}</span>
                </div>
              </div>
              <div className="dov2-chart" onMouseLeave={() => setHoverMonth(null)}>
                <div className="dov2-chart__axis" aria-hidden="true">
                  {ticks.slice().reverse().map((tick) => <span key={tick}>{tick ? formatCompact(tick) : '0'}</span>)}
                </div>
                <div className="dov2-chart__plot">
                  <div className="dov2-chart__grid" aria-hidden="true">
                    {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / chartMax) * 100}%` }} />)}
                  </div>
                  <div className="dov2-line">
                    {(() => {
                      const x = (i) => ((i + 0.5) / 12) * 100;
                      const y = (v) => 100 - (v / chartMax) * 100;
                      const path = (vals) => vals.map((v, i) => (v === null ? null : `${i === 0 || vals[i - 1] === null ? 'M' : 'L'}${x(i).toFixed(2)} ${y(v).toFixed(2)}`)).filter(Boolean).join(' ');
                      const cur = yoyRows.map((r) => r.current);
                      const curPts = cur.map((v, i) => [i, v]).filter(([, v]) => v !== null);
                      const area = curPts.length ? `${path(cur)} L${x(curPts[curPts.length - 1][0]).toFixed(2)} 100 L${x(curPts[0][0]).toFixed(2)} 100 Z` : '';
                      return (
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          {hoverMonth !== null && <line x1={x(hoverMonth)} x2={x(hoverMonth)} y1="0" y2="100" stroke="#c9d1e3" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
                          <path d={area} fill="rgba(42,74,155,.10)" />
                          <path d={path(yoyRows.map((r) => r.last))} fill="none" stroke={LAST_YEAR} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                          <path d={path(cur)} fill="none" stroke={SOLD} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                        </svg>
                      );
                    })()}
                    {yoyRows.map((row, i) => {
                      const showCur = row.current !== null && (i === curMonth || hoverMonth === i);
                      return (
                        <React.Fragment key={row.label}>
                          {hoverMonth === i && <span className="dov2-dot" style={{ left: `${((i + 0.5) / 12) * 100}%`, bottom: `${(row.last / chartMax) * 100}%`, background: LAST_YEAR }} />}
                          {showCur && <span className="dov2-dot" style={{ left: `${((i + 0.5) / 12) * 100}%`, bottom: `${(row.current / chartMax) * 100}%`, background: SOLD }} />}
                          {i === curMonth && row.current > 0 && hoverMonth !== i && (
                            <span className="dov2-end-label" style={{ left: `${((i + 0.5) / 12) * 100}%`, bottom: `${(row.current / chartMax) * 100}%` }}>{formatCompact(row.current)}</span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                  {yoyRows.map((row, i) => (
                    <div
                      key={row.label}
                      className={`dov2-chart__month ${hoverMonth === i ? 'is-active' : ''} ${i > curMonth ? 'is-future' : ''}`}
                      tabIndex={0}
                      aria-label={`${row.label}: ${thisYear} ${row.current === null ? 'not yet' : MONEY.format(row.current)}, ${thisYear - 1} ${MONEY.format(row.last)}`}
                      onMouseEnter={() => setHoverMonth(i)}
                      onFocus={() => setHoverMonth(i)}
                      onBlur={() => setHoverMonth(null)}
                    >
                      <span className="dov2-chart__label">{row.label.slice(0, 1)}<span className="dov2-chart__label-rest">{row.label.slice(1)}</span></span>
                      {hoverMonth === i && (
                        <div className={`dov2-tip ${i >= 8 ? 'is-left' : ''}`} role="presentation">
                          <strong>{row.label}{i === curMonth ? ' (month to date)' : ''}</strong>
                          <span><i style={{ background: SOLD }} />{thisYear} <b>{row.current === null ? '—' : MONEY.format(row.current)}</b></span>
                          <span><i style={{ background: LAST_YEAR }} />{thisYear - 1} <b>{MONEY.format(row.last)}</b></span>
                          {row.current !== null && i < curMonth && row.last > 0 && (
                            <span className="dov2-tip__delta"><Delta value={pctChange(row.current, row.last)} label="vs last year" /></span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <table className="dov2-sr">
                <caption>Sales by month, {thisYear} vs {thisYear - 1}</caption>
                <thead><tr><th>Month</th><th>{thisYear}</th><th>{thisYear - 1}</th></tr></thead>
                <tbody>{yoyRows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{row.current === null ? '—' : MONEY.format(row.current)}</td><td>{MONEY.format(row.last)}</td></tr>)}</tbody>
              </table>
              <div className="dov2-card__foot">
                <span>Sales = invoiced, by invoice date{historicalInvoices.length === 0 ? ' · NetSuite history still loading or unavailable' : ''}</span>
                <button type="button" className="dov2-link" onClick={() => onNavigate?.('reports')}>Full report →</button>
              </div>
            </>
          ) : (
            <>
              <div className="dov2-chart-sub">
                <span>Orders written vs invoices sent, by month</span>
                <div className="dov2-legend" aria-label="Legend">
                  <span><i style={{ background: SOLD }} />Sold</span>
                  <span><i style={{ background: BILLED }} />Billed</span>
                </div>
              </div>
            <div className="dov2-chart" onMouseLeave={() => setHoverMonth(null)}>
              <div className="dov2-chart__axis" aria-hidden="true">
                {ticks.slice().reverse().map((tick) => <span key={tick}>{tick ? formatCompact(tick) : '0'}</span>)}
              </div>
              <div className="dov2-chart__plot">
                <div className="dov2-chart__grid" aria-hidden="true">
                  {ticks.map((tick) => <span key={tick} style={{ bottom: `${(tick / chartMax) * 100}%` }} />)}
                </div>
                {monthRows.map((row, index) => {
                  const isCurrent = index === monthRows.length - 1;
                  const active = hoverMonth === index;
                  return (
                    <div
                      key={`${row.month.getFullYear()}-${row.month.getMonth()}`}
                      className={`dov2-chart__month ${active ? 'is-active' : ''}`}
                      tabIndex={0}
                      aria-label={`${row.label}: sold ${MONEY.format(row.sales)}, billed ${MONEY.format(row.billed)}`}
                      onMouseEnter={() => setHoverMonth(index)}
                      onFocus={() => setHoverMonth(index)}
                      onBlur={() => setHoverMonth(null)}
                    >
                      <div className="dov2-chart__bars">
                        <div className="dov2-chart__bar" style={{ height: `${(row.sales / chartMax) * 100}%`, background: SOLD }}>
                          {isCurrent && row.sales > 0 && <b>{formatCompact(row.sales)}</b>}
                        </div>
                        <div className="dov2-chart__bar" style={{ height: `${(row.billed / chartMax) * 100}%`, background: BILLED }} />
                      </div>
                      <span className="dov2-chart__label">{row.label}{isCurrent ? ' (MTD)' : ''}</span>
                      {active && (
                        <div className={`dov2-tip ${index >= monthRows.length - 2 ? 'is-left' : ''}`} role="presentation">
                          <strong>{row.label} {row.month.getFullYear()}</strong>
                          <span><i style={{ background: SOLD }} />Sold <b>{MONEY.format(row.sales)}</b></span>
                          <span><i style={{ background: BILLED }} />Billed <b>{MONEY.format(row.billed)}</b></span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <table className="dov2-sr">
              <caption>Sold and billed by month</caption>
              <thead><tr><th>Month</th><th>Sold</th><th>Billed</th></tr></thead>
              <tbody>{monthRows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{MONEY.format(row.sales)}</td><td>{MONEY.format(row.billed)}</td></tr>)}</tbody>
            </table>
            <div className="dov2-card__foot">
              <span>Sold = sales orders by created date · Billed = invoices by invoice date</span>
              <button type="button" className="dov2-link" onClick={() => onNavigate?.('reports')}>Full report →</button>
            </div>
            </>
          )}
        </article>

        {/* ═══ Quote pipeline ═══ */}
        <article className="dov2-card">
          <header className="dov2-card__head">
            <div>
              <span className="dov2-kicker">Money in motion</span>
              <h3>Quote pipeline</h3>
            </div>
            <strong className="dov2-head-num">{formatCompact(pipelineValue)}</strong>
          </header>
          <div className="dov2-stack" aria-hidden="true">
            {quoteStages.filter((stage) => stage.value > 0).map((stage) => (
              <span key={stage.key} style={{ flexGrow: stage.value, background: stage.color }} title={`${stage.label}: ${MONEY.format(stage.value)}`} />
            ))}
            {pipelineValue === 0 && <span className="is-empty" />}
          </div>
          <div className="dov2-rows">
            {quoteStages.map((stage) => (
              <button type="button" className="dov2-row" key={stage.key} onClick={() => onNavigate?.('estimates')}>
                <i style={{ background: stage.color }} />
                <span className="dov2-row__name">{stage.label}</span>
                <span className="dov2-row__meta">{stage.count}</span>
                <b>{formatCompact(stage.value)}</b>
              </button>
            ))}
          </div>
          <div className="dov2-subhead">
            <span>Follow up today</span>
            <small>Sent 14+ days, not yet won</small>
          </div>
          {staleQuotes.length === 0 ? (
            <div className="dov2-empty is-small">No quotes waiting on a coach for 2+ weeks.</div>
          ) : (
            <div className="dov2-rows">
              {staleQuotes.map(({ estimate, age, value, customer }) => (
                <button type="button" className="dov2-row" key={estimate.id} onClick={() => (onOpenEstimate ? onOpenEstimate(estimate) : onNavigate?.('estimates'))}>
                  <span className={`dov2-age ${age >= 30 ? 'is-old' : ''}`}>{age}d</span>
                  <span className="dov2-row__name">
                    {customer?.name || estimate.memo || estimate.id}
                    <small>{estimate.memo || estimate.id}</small>
                  </span>
                  <b>{formatCompact(value)}</b>
                </button>
              ))}
            </div>
          )}
        </article>

        {/* ═══ Top accounts ═══ */}
        <article className="dov2-card">
          <header className="dov2-card__head">
            <div>
              <span className="dov2-kicker">Last 12 months</span>
              <h3>Top accounts</h3>
            </div>
            <button type="button" className="dov2-link" onClick={() => onNavigate?.('customers')}>All customers →</button>
          </header>
          {topAccounts.length === 0 ? (
            <div className="dov2-empty is-small">No orders in the last 12 months yet.</div>
          ) : (
            <div className="dov2-bars">
              {topAccounts.map((row) => (
                <button type="button" className="dov2-hbar" key={row.id} onClick={() => openCustomer(row.customer)}>
                  <span className="dov2-hbar__name">
                    {row.customer?.name || 'Unknown customer'}
                    <small>{row.orders} order{row.orders === 1 ? '' : 's'} · last {row.days === 0 ? 'today' : `${row.days}d ago`}</small>
                  </span>
                  <span className="dov2-hbar__track">
                    <span style={{ width: `${Math.max(2, (row.rev / topMax) * 100)}%` }} />
                  </span>
                  <b>{formatCompact(row.rev)}</b>
                </button>
              ))}
            </div>
          )}
        </article>

        {/* ═══ Work in flight ═══ */}
        <article className="dov2-card">
          <header className="dov2-card__head">
            <div>
              <span className="dov2-kicker">Live</span>
              <h3>Orders in flight</h3>
            </div>
            <strong className="dov2-head-num">{activeOrders.length}</strong>
          </header>
          <div className="dov2-stack" aria-hidden="true">
            {stages.filter((stage) => stage.value > 0).map((stage) => (
              <span key={stage.key} style={{ flexGrow: stage.value, background: stage.color }} title={`${stage.label}: ${stage.value}`} />
            ))}
            {stageTotal === 0 && <span className="is-empty" />}
          </div>
          <div className="dov2-rows">
            {stages.map((stage) => (
              <button type="button" className="dov2-row" key={stage.key} onClick={() => onNavigate?.(stage.route)}>
                <i style={{ background: stage.color }} />
                <span className="dov2-row__name">{stage.label}</span>
                <b>{stage.value}</b>
              </button>
            ))}
          </div>
          <div className="dov2-card__foot">
            <span>{activeJobs.length} decoration job{activeJobs.length === 1 ? '' : 's'} not yet complete</span>
          </div>
        </article>
      </div>
    </section>
  );
}
