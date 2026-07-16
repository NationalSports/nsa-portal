/* eslint-disable */
// Single source for the coach-facing Team Shop order status label.
// Consumed by src/teamshop/AccountPage.js (Account "Recent orders"),
// src/CoachPortal.js (Connect "Team Shop orders" card), the chat widget's
// order card (ChatWidget.js), AND the Netlify function runtime
// (netlify/functions/teamshop-assistant.js labels tool results with it;
// ships in the bundle via netlify.toml included_files) — one mapping, no
// hand-synced mirrors (FABLE_SYSTEM_AUDIT rule). Dual-consumer CJS, same
// pattern as src/lib/decoPricing.js — keep this file dependency-free
// CommonJS (no import/export keywords, or webpack treats it as ESM and
// drops module.exports).
//
// The server shape it reads is netlify/functions/teamshop-orders.js's `list`
// response: { status, production: null | { stage } }. Production stage —
// present once the order has converted to a Sales Order — takes priority
// over the raw 'paid'/'batched' status, same story as the tokenless tracker.
function statusChipLabel(order) {
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

module.exports = { statusChipLabel };
