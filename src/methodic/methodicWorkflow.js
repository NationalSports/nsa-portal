export const METHODIC_STATUS = {
  pricing: {
    not_requested: 'Not requested', requested: 'Pricing requested', working: 'Pricing in progress',
    quoted: 'Quote received', approved: 'Pricing approved', declined: 'Declined', expired: 'Quote expired',
  },
  mockup: {
    not_requested: 'Not requested', requested: 'Mock requested', in_art: 'With art',
    ready_for_rep: 'Ready for rep', revisions_requested: 'Revisions requested', approved: 'Mock approved', cancelled: 'Cancelled',
  },
  sample: {
    not_requested: 'Not requested', requested: 'Sample requested', confirmed: 'Sample confirmed',
    in_production: 'Sample in production', shipped: 'Sample shipped', received: 'Sample received',
    approved: 'Sample approved', changes_requested: 'Sample changes', waived: 'Sample waived', cancelled: 'Cancelled',
  },
  order: {
    not_ordered: 'Not ordered', po_needed: 'PO needed', po_ready: 'PO ready', ordered: 'Ordered',
    confirmed: 'Order confirmed', in_production: 'In production', quality_check: 'Quality check',
    shipped: 'Shipped', delivered: 'Delivered', on_hold: 'On hold', cancelled: 'Cancelled',
  },
  billing: {
    not_ready: 'Not ready', ready: 'Ready to sync', queued: 'Queued', syncing: 'Syncing',
    partial: 'Partial sync', posted: 'Posted', verified: 'Verified', open: 'Open balance',
    paid: 'Paid', error: 'Sync error', void: 'Void',
  },
};

export const METHODIC_COLORS = {
  muted: { bg: '#f1f5f9', fg: '#64748b' },
  waiting: { bg: '#fff7ed', fg: '#c2410c' },
  active: { bg: '#eff6ff', fg: '#1d4ed8' },
  ready: { bg: '#f0fdf4', fg: '#15803d' },
  blocked: { bg: '#fef2f2', fg: '#b91c1c' },
};

export function statusTone(group, status) {
  if (!status || status === 'not_requested' || status === 'not_ordered') return 'muted';
  if (['cancelled', 'declined', 'expired', 'changes_requested', 'revisions_requested', 'on_hold'].includes(status)) return 'blocked';
  if (['approved', 'quoted', 'ready_for_rep', 'received', 'waived', 'delivered', 'shipped', 'posted', 'verified', 'paid'].includes(status)) return 'ready';
  if (['partial', 'error'].includes(status)) return 'blocked';
  if (['requested', 'po_needed'].includes(status)) return 'waiting';
  return 'active';
}

export function requestStage(request) {
  if (!request) return 'Request';
  if (['shipped', 'delivered'].includes(request.order_status)) return 'Tracking';
  if (!['not_ordered', 'po_needed', 'po_ready'].includes(request.order_status)) return 'Order';
  if (!['not_requested', 'waived', 'approved', 'cancelled'].includes(request.sample_status)) return 'Sample';
  if (!['not_requested', 'approved', 'cancelled'].includes(request.mockup_status)) return 'Art';
  if (!['not_requested', 'approved', 'declined', 'expired'].includes(request.pricing_status)) return 'Pricing';
  if (request.order_status === 'po_ready' || request.order_status === 'po_needed') return 'Purchasing';
  return 'Request';
}

const parseDay = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null;
export function daysUntil(value, now = new Date()) {
  const date = parseDay(value);
  if (!date || Number.isNaN(date.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  return Math.ceil((date - today) / 86400000);
}

export function nextDue(request) {
  const choices = [];
  const push = (date, label) => { if (date) choices.push({ date, label, days: daysUntil(date) }); };
  if (['requested', 'working'].includes(request.pricing_status)) push(request.expected_pricing_date, 'Pricing');
  if (['requested', 'in_art', 'revisions_requested'].includes(request.mockup_status)) push(request.expected_mockup_date, 'Mockup');
  if (['requested', 'confirmed', 'in_production', 'shipped'].includes(request.sample_status)) push(request.expected_sample_date, 'Sample');
  if (['ordered', 'confirmed', 'in_production', 'quality_check'].includes(request.order_status)) push(request.expected_ship_date, 'Ship');
  if (request.order_status === 'shipped') push(request.expected_arrival_date, 'Arrival');
  return choices.sort((a, b) => String(a.date).localeCompare(String(b.date)))[0] || null;
}

export function nextAction(request) {
  if (request.blocker) return request.blocker;
  if (request.pricing_status === 'requested') return 'Methodic pricing response';
  if (request.pricing_status === 'working') return 'Complete pricing';
  if (request.mockup_status === 'requested' || request.mockup_status === 'in_art') return 'Art mockup';
  if (request.mockup_status === 'ready_for_rep') return 'Rep review / send mock';
  if (request.mockup_status === 'revisions_requested') return 'Art revisions';
  if (request.sample_status === 'requested') return 'Confirm sample';
  if (['confirmed', 'in_production'].includes(request.sample_status)) return 'Complete sample';
  if (request.sample_status === 'shipped') return 'Receive sample';
  if (request.order_status === 'po_needed') return 'Create Methodic PO';
  if (request.order_status === 'po_ready') return 'Place Methodic order';
  if (['ordered', 'confirmed', 'in_production', 'quality_check'].includes(request.order_status)) return 'Methodic production';
  if (request.order_status === 'shipped') return 'Delivery';
  if (request.billing_status === 'ready') return 'Sync Methodic invoice and National bill';
  if (request.billing_status === 'syncing' || request.billing_status === 'queued') return 'Complete accounting sync';
  if (request.billing_status === 'partial' || request.billing_status === 'error') return 'Resolve accounting sync';
  if (request.billing_status === 'open') return 'Record National payment';
  return 'No open action';
}

export function billingBalanceCents(request) {
  return Math.max(0, Number(request?.billing_amount_cents || 0) - Number(request?.amount_paid_cents || 0));
}

export function isRequestOverdue(request, now = new Date()) {
  const due = nextDue(request);
  return !!due && daysUntil(due.date, now) < 0 && request.order_status !== 'delivered';
}
