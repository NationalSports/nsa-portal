// Single source for the coach-facing Team Shop order status label.
// Consumed by BOTH src/teamshop/AccountPage.js (Account "Recent orders") and
// src/CoachPortal.js (Connect "Team Shop orders" card) — one mapping, no
// hand-synced mirrors (FABLE_SYSTEM_AUDIT rule). The server shape it reads is
// netlify/functions/teamshop-orders.js's `list` response: { status,
// production: null | { stage } }. Production stage — present once the order
// has converted to a Sales Order — takes priority over the raw
// 'paid'/'batched' status, same story as the tokenless tracker.
export function statusChipLabel(order) {
  if (!order) return 'Processing';
  if (order.status === 'cancelled') return 'Cancelled';
  if (order.status === 'refunded') return 'Refunded';
  if (order.status === 'pending_payment') return 'Awaiting payment';
  if (order.status === 'unpaid') return 'PO review';
  const stage = order.production && order.production.stage;
  if (stage === 'shipped') return 'Shipped';
  if (stage === 'decorated') return 'Decorated';
  if (stage === 'in production') return 'In production';
  if (stage === 'queued') return 'Queued';
  if (stage === 'received') return 'Received';
  return 'Processing';
}
