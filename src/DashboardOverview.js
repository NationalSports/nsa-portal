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
      const repId = parent
        ? orderRepId(parent)
        : customerById.get(invoice.customer_id)?.primary_rep_id;
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
          <button type="button" onClick={() => onNavigate?.(unreadCount ? 'messages' : 'dashboard')}>
            <span className="dash-overview__metric-label">Needs attention</span>
            <strong>{actionCount}</strong>
            <span className="dash-overview__metric-foot">{unreadCount} unread messages</span>
          </button>
        </div>
      </div>

      <article className="dash-overview__priority" aria-labelledby="dashboard-priority-title">
        <header className="dash-overview__priority-header">
          <div>
            <span className="dash-overview__panel-kicker">Start here</span>
            <h3 id="dashboard-priority-title">Priority to-do</h3>
          </div>
          <div className="dash-overview__priority-count">
            <strong>{actionCount}</strong>
            <span>open item{actionCount === 1 ? '' : 's'}</span>
          </div>
        </header>
        <div className="dash-overview__priority-list">
          {priorityItems.length === 0 ? (
            <div className="dash-overview__priority-empty">
              <span aria-hidden="true">✓</span>
              <div><strong>You’re caught up</strong><small>No action items need attention.</small></div>
            </div>
          ) : priorityItems.map((item, index) => {
            const priority = item.priority ?? 2;
            const tone = priority <= 0 ? 'urgent' : priority === 1 ? 'high' : 'normal';
            const label = priority <= 0 ? 'Urgent' : priority === 1 ? 'High' : 'Next';
            return (
              <button
                type="button"
                className={`dash-overview__priority-item is-${tone}`}
                key={item.dismissKey || item.id || `${item.type}-${index}`}
                onClick={() => onOpenPriority?.(item)}
              >
                <span className="dash-overview__priority-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="dash-overview__priority-copy">
                  <span><b>{label}</b>{item.msg}</span>
                  <small>{item.detail || 'Open this item to continue.'}</small>
                </span>
                <span className="dash-overview__priority-action">{item.action || 'Open'} <i aria-hidden="true">→</i></span>
              </button>
            );
          })}
        </div>
        {actionCount > priorityItems.length && (
          <button type="button" className="dash-overview__priority-all" onClick={() => onNavigate?.('dashboard')}>
            {actionCount - priorityItems.length} more in the full queue below <span aria-hidden="true">↓</span>
          </button>
        )}
      </article>

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
