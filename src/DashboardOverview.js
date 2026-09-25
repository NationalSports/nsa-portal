import React from 'react';

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'short' });
const FULL_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

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
  if (!previous) return current ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
};

const formatCompact = (value) => {
  const amount = Number(value) || 0;
  if (Math.abs(amount) >= 1000000) return `$${(amount / 1000000).toFixed(1)}m`;
  if (Math.abs(amount) >= 1000) return `$${(amount / 1000).toFixed(amount >= 10000 ? 0 : 1)}k`;
  return MONEY.format(amount);
};

// Needs-action grouping: the dashboard to-do queue mixes many generated types;
// the card filters them into a few buckets a rep recognises.
const ACTION_GROUPS = [
  { key: 'due', label: 'Due dates', color: '#b94349' },
  { key: 'art', label: 'Art', color: '#0891b2' },
  { key: 'follow', label: 'Follow-ups', color: '#7c3aed' },
  { key: 'pay', label: 'Payments', color: '#15803d' },
  { key: 'other', label: 'Other', color: '#64748b' },
];
const actionGroup = (item) => {
  const t = String(item.type || '');
  if (t === 'deadline' || t === 'firm' || t === 'booking_confirm') return 'due';
  if (/art|deco|mockup/.test(t)) return 'art';
  if (/inv|pay|deposit|credit/.test(t)) return 'pay';
  if (/follow|est|coach|quote/.test(t) || item._priorityKind === 'workspace' || item._priorityKind === 'assigned') return 'follow';
  return 'other';
};
// Strip the leading emoji / "Overdue by N days:" prefix; the tag carries that now.
const actionTitle = (msg) => String(msg || '')
  .replace(/^[^\p{L}\p{N}]+/u, '')
  .replace(/^(Overdue by \d+ days?|Due in \d+ days?|Reminder):\s*/i, '');
const actionTag = (item, today) => {
  const datedKinds = item.type === 'deadline' || item._priorityKind === 'workspace' || item._priorityKind === 'assigned';
  const due = datedKinds ? parsePortalDate(item.date) : null;
  if (due) {
    const diff = Math.round((new Date(due.getFullYear(), due.getMonth(), due.getDate()) - today) / 864e5);
    if (diff < 0) return { text: `${-diff}d late`, tone: 'late' };
    if (diff === 0) return { text: 'Today', tone: 'today' };
    return { text: `in ${diff}d`, tone: '' };
  }
  const g = ACTION_GROUPS.find((x) => x.key === actionGroup(item));
  return { text: g ? g.label.replace(/s$/, '') : 'Open', tone: (item.priority ?? 2) <= 0 ? 'late' : '' };
};

function NeedsAction({ items, total, onOpen, onViewAll }) {
  const [filter, setFilter] = React.useState('all');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const counts = {};
  items.forEach((it) => { const g = actionGroup(it); counts[g] = (counts[g] || 0) + 1; });
  const shown = items.filter((it) => filter === 'all' || actionGroup(it) === filter).slice(0, 7);
  return (
    <article className="dash-card" aria-labelledby="dash-action-title">
      <header className="dash-card__head">
        <h3 id="dash-action-title">Needs action</h3>
        <span className={`dash-card__badge${total ? ' is-red' : ''}`}>{total}</span>
        <button type="button" className="dash-card__link" onClick={onViewAll}>View all →</button>
      </header>
      {items.length > 0 && (
        <div className="dash-card__chips" role="tablist">
          <button type="button" role="tab" aria-selected={filter === 'all'} className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>All</button>
          {ACTION_GROUPS.filter((g) => counts[g.key]).map((g) => (
            <button key={g.key} type="button" role="tab" aria-selected={filter === g.key} className={filter === g.key ? 'is-on' : ''} style={{ '--c': g.color }} onClick={() => setFilter(g.key)}>
              <i />{g.label} {counts[g.key]}
            </button>
          ))}
        </div>
      )}
      <div className="dash-card__list">
        {items.length === 0 ? (
          <p className="dash-card__empty">✓ You’re caught up. Nothing needs action.</p>
        ) : shown.map((item, index) => {
          const g = ACTION_GROUPS.find((x) => x.key === actionGroup(item));
          const tag = actionTag(item, today);
          return (
            <button type="button" className="dash-row" key={item.dismissKey || item.id || `${item.type}-${index}`} style={{ '--c': g?.color }} onClick={() => onOpen?.(item)}>
              <span className="dash-row__dot" aria-hidden="true" />
              <span className="dash-row__copy"><b>{actionTitle(item.msg)}</b><small>{item.detail || item.action || ''}</small></span>
              <span className={`dash-row__tag${tag.tone ? ' is-' + tag.tone : ''}`}>{tag.text}</span>
            </button>
          );
        })}
      </div>
    </article>
  );
}

function TrendBadge({ value }) {
  const positive = value >= 0;
  return (
    <span className={`dash-overview__trend ${positive ? 'is-up' : 'is-down'}`}>
      <span aria-hidden="true">{positive ? '↗' : '↘'}</span>
      {Math.abs(value)}%
    </span>
  );
}

function RingMetric({ label, value, tone }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="dash-overview__ring-metric">
      <div
        className="dash-overview__ring"
        style={{
          '--ring-value': `${safeValue * 3.6}deg`,
          '--ring-color': tone,
        }}
        aria-label={`${label}: ${safeValue}%`}
      >
        <span>{safeValue}%</span>
      </div>
      <span className="dash-overview__ring-label">{label}</span>
    </div>
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
  afterPriority = null,
  todaySlot = null,
  inboxSlot = null,
}) {
  const now = new Date();
  const titleByView = {
    admin: 'Business pulse',
    sales: 'My book of business',
    warehouse: 'Fulfillment pulse',
    decorator: 'Artwork pulse',
    production: 'Production pulse',
    csr: 'Service pulse',
  };
  const kickerByView = {
    admin: 'Company overview',
    sales: 'Sales performance',
    warehouse: 'Warehouse operations',
    decorator: 'Creative workflow',
    production: 'Floor operations',
    csr: 'Customer support',
  };

  const customerById = new Map(customers.map((customer) => [customer.id, customer]));
  const orderById = new Map(orders.map((order) => [order.id, order]));
  const orderRepId = (order) =>
    customerById.get(order?.customer_id)?.primary_rep_id || order?.created_by || null;
  const scopedToUser = view === 'sales';
  const scopedOrders = orders.filter(
    (order) => isLiveRecord(order) && (!scopedToUser || orderRepId(order) === user?.id),
  );
  const scopedEstimates = estimates.filter(
    (estimate) =>
      isLiveRecord(estimate) && (!scopedToUser || estimate.created_by === user?.id),
  );
  const scopedJobs = jobs.filter((job) => {
    if (!scopedToUser) return true;
    const parent = orderById.get(job.so_id || job._soId);
    return parent ? orderRepId(parent) === user?.id : true;
  });

  const monthRows = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const sales = scopedOrders.reduce((sum, order) => {
      if (!isSameMonth(parsePortalDate(order.created_at), month)) return sum;
      try {
        return sum + (Number(calcMargin?.(order, orders)?.rev) || 0);
      } catch {
        return sum;
      }
    }, 0);
    return { month, label: MONTH.format(month), sales, billed: 0 };
  });

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
    const row = monthRows.find((item) => isSameMonth(date, item.month));
    if (row) row.billed += Number(invoice.total) || 0;
  };
  historicalInvoices.forEach((invoice) => addBilling(invoice, true));
  invoices.forEach((invoice) => addBilling(invoice, false));

  const current = monthRows[monthRows.length - 1] || { sales: 0, billed: 0 };
  const previous = monthRows[monthRows.length - 2] || { sales: 0, billed: 0 };
  const maxChartValue = Math.max(
    1,
    ...monthRows.flatMap((row) => [row.sales, row.billed]),
  );
  const activeOrders = scopedOrders.filter((order) => calcStatus?.(order) !== 'complete');
  const openEstimates = scopedEstimates.filter((estimate) =>
    ['draft', 'open', 'sent'].includes(estimate.status),
  );
  const openQuoteValue = openEstimates.reduce((sum, estimate) => {
    try {
      return sum + (Number(calcMargin?.(estimate, orders)?.rev) || 0);
    } catch {
      return sum;
    }
  }, 0);
  const activeJobs = scopedJobs.filter(
    (job) => !['completed', 'shipped'].includes(job.prod_status),
  );
  const completedJobs = scopedJobs.filter((job) => job.prod_status === 'completed');

  const stages = [
    {
      key: 'estimate',
      label: 'Estimate',
      detail: 'Quotes in motion',
      value: openEstimates.length,
      color: '#d7a442',
      route: 'estimates',
    },
    {
      key: 'order',
      label: 'Order',
      detail: 'Needs ordering',
      value: activeOrders.filter((order) =>
        ['booking', 'need_order', 'needs_pull'].includes(calcStatus?.(order)),
      ).length,
      color: '#b94349',
      route: 'orders',
    },
    {
      key: 'sourcing',
      label: 'Sourcing',
      detail: 'Waiting on goods',
      value: activeOrders.filter((order) =>
        ['waiting_receive', 'items_received'].includes(calcStatus?.(order)),
      ).length,
      color: '#5678b8',
      route: 'orders',
    },
    {
      key: 'production',
      label: 'Production',
      detail: 'On the floor',
      value: activeOrders.filter((order) => calcStatus?.(order) === 'in_production').length,
      color: '#7b65a8',
      route: 'production',
    },
    {
      key: 'ready',
      label: 'Ready',
      detail: 'Invoice or ship',
      value: activeOrders.filter((order) => calcStatus?.(order) === 'ready_to_invoice').length,
      color: '#3d8b69',
      route: 'invoices',
    },
  ];
  const stageTotal = Math.max(1, stages.reduce((sum, stage) => sum + stage.value, 0));

  const artReady = activeJobs.filter((job) =>
    ['art_complete', 'production_files', 'production_files_ready'].includes(job.art_status),
  ).length;
  const itemsReady = activeJobs.filter((job) => job.item_status === 'items_received').length;
  const completionRate = scopedJobs.length
    ? Math.round((completedJobs.length / scopedJobs.length) * 100)
    : 0;
  const artReadyRate = activeJobs.length ? Math.round((artReady / activeJobs.length) * 100) : 0;
  const itemsReadyRate = activeJobs.length
    ? Math.round((itemsReady / activeJobs.length) * 100)
    : 0;

  const firstName = (user?.name || 'Team').split(' ')[0];
  const greeting =
    now.getHours() < 12 ? 'Good morning' : now.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <section className="dash-overview" aria-labelledby="dashboard-overview-title">
      <div className="dash-overview__hero">
        <div className="dash-overview__hero-copy">
          <div className="dash-overview__eyebrow">{kickerByView[view] || 'Operations overview'}</div>
          <h2 id="dashboard-overview-title">{greeting}, {firstName}.</h2>
          <p>{FULL_DATE.format(now)} · Here is what is moving across the business.</p>
        </div>
        <div className="dash-overview__hero-mark" aria-hidden="true">CONNECT</div>
        <div className="dash-overview__metrics">
          <button type="button" onClick={() => onNavigate?.('reports')}>
            <span className="dash-overview__metric-label">Sales this month</span>
            <strong>{formatCompact(current.sales)}</strong>
            <span className="dash-overview__metric-foot">
              <TrendBadge value={pctChange(current.sales, previous.sales)} />
              vs last month
            </span>
          </button>
          <button type="button" onClick={() => onNavigate?.('invoices')}>
            <span className="dash-overview__metric-label">Billed this month</span>
            <strong>{formatCompact(current.billed)}</strong>
            <span className="dash-overview__metric-foot">
              <TrendBadge value={pctChange(current.billed, previous.billed)} />
              vs last month
            </span>
          </button>
          <button type="button" onClick={() => onNavigate?.('orders')}>
            <span className="dash-overview__metric-label">Active orders</span>
            <strong>{activeOrders.length}</strong>
            <span className="dash-overview__metric-foot">{activeJobs.length} live production jobs</span>
          </button>
          <button type="button" onClick={() => onNavigate?.('estimates')}>
            <span className="dash-overview__metric-label">Open quotes</span>
            <strong>{openEstimates.length}</strong>
            <span className="dash-overview__metric-foot">{formatCompact(openQuoteValue)} outstanding</span>
          </button>
        </div>
      </div>

      <div className="dash-top">
        <NeedsAction items={priorityItems} total={actionCount} onOpen={onOpenPriority} onViewAll={() => { const hub = typeof document !== 'undefined' && document.querySelector('.dash-action-hub'); if (hub) hub.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
        {todaySlot}
        {inboxSlot}
      </div>

      {afterPriority}
      <div className="dash-overview__grid">
        <article className="dash-overview__panel dash-overview__chart-panel">
          <header className="dash-overview__panel-header">
            <div>
              <span className="dash-overview__panel-kicker">6 month trend</span>
              <h3>{titleByView[view] || 'Business pulse'}</h3>
            </div>
            <div className="dash-overview__legend" aria-label="Chart legend">
              <span><i className="is-sales" />Sold</span>
              <span><i className="is-billed" />Billed</span>
            </div>
          </header>
          <div className="dash-overview__chart" role="img" aria-label="Sales and billings for the last six months">
            <div className="dash-overview__chart-grid" aria-hidden="true">
              <span /><span /><span /><span />
            </div>
            {monthRows.map((row) => (
              <div className="dash-overview__month" key={`${row.month.getFullYear()}-${row.month.getMonth()}`}>
                <div className="dash-overview__bars">
                  <div
                    className="dash-overview__bar is-sales"
                    style={{ height: `${Math.max(row.sales ? 4 : 0, (row.sales / maxChartValue) * 100)}%` }}
                    title={`${row.label} sold: ${MONEY.format(row.sales)}`}
                  />
                  <div
                    className="dash-overview__bar is-billed"
                    style={{ height: `${Math.max(row.billed ? 4 : 0, (row.billed / maxChartValue) * 100)}%` }}
                    title={`${row.label} billed: ${MONEY.format(row.billed)}`}
                  />
                </div>
                <span>{row.label}</span>
              </div>
            ))}
          </div>
          <div className="dash-overview__chart-summary">
            <span>Current sold <strong>{formatCompact(current.sales)}</strong></span>
            <span>Current billed <strong>{formatCompact(current.billed)}</strong></span>
            <button type="button" onClick={() => onNavigate?.('reports')}>Open reports <span aria-hidden="true">→</span></button>
          </div>
        </article>

        <article className="dash-overview__panel dash-overview__flow-panel">
          <header className="dash-overview__panel-header">
            <div>
              <span className="dash-overview__panel-kicker">Live workflow</span>
              <h3>Where work lives now</h3>
            </div>
            <span className="dash-overview__live"><i />Live</span>
          </header>
          <div className="dash-overview__flow-bar" aria-label="Current work distribution">
            {stages.map((stage) => (
              <span
                key={stage.key}
                style={{ width: `${Math.max(stage.value ? 7 : 0, (stage.value / stageTotal) * 100)}%`, background: stage.color }}
                title={`${stage.label}: ${stage.value}`}
              />
            ))}
          </div>
          <div className="dash-overview__stage-list">
            {stages.map((stage) => (
              <button type="button" key={stage.key} onClick={() => onNavigate?.(stage.route)}>
                <i style={{ background: stage.color }} />
                <span>
                  <strong>{stage.label}</strong>
                  <small>{stage.detail}</small>
                </span>
                <b>{stage.value}</b>
                <span className="dash-overview__stage-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
          <div className="dash-overview__rings">
            <RingMetric label="Jobs complete" value={completionRate} tone="#3d8b69" />
            <RingMetric label="Art ready" value={artReadyRate} tone="#b94349" />
            <RingMetric label="Items in" value={itemsReadyRate} tone="#5678b8" />
          </div>
        </article>
      </div>
    </section>
  );
}
